#!/usr/bin/env node
// taskmgrd: the sync daemon. It watches taskmgr.json and the tasks folder of every work and
// repository listed there, and pushes what changes to a remote tm server with push.js (what `tm push`
// runs once by hand; it has the .env settings and what a push sends).
//
//   node taskmgrd.js          ./taskmgrd.sh runs it under pm2
//
// taskmgr.json is pushed when it changes; an invalid one is not pushed, and the folders of the last
// good one stay watched. A tasks folder is pushed whenever anything in it changes. A tasks folder that
// does not exist is looked for until it appears. At startup taskmgr.json is pushed once; then, and
// every few minutes after that, the daemon asks the server what it has and pushes what differs; so a
// change missed by the file system, or a server that lost its data, is put right. A push that fails
// is retried, with growing waits, until the server answers again.
const fs = require('fs');
const path = require('path');
const { spaceKey } = require('./server/sync');
const { SERVER, CONFIG_PATH, log, warn, die, syncLog, logTo, readConfig, spacesOf, label, snapshot, isDir, serverState, pushConfig, pushSpace } = require('./push');

// The daemon's pushes are logged apart from those made by hand (`tm push`, `tm pull`: logs/taskmgr.log).
logTo(path.join(__dirname, 'logs', 'taskmgrd.log'));

const DEBOUNCE_MS = 10 * 1000;          // a change waits this long, and each new one restarts the wait
const RESCAN_MS = 5 * 60 * 1000;        // how often the server is asked what it has, and everything compared
const MISSING_POLL_MS = 30 * 1000;      // how often a missing tasks folder is looked for
const RETRY_MS = [5000, 15000, 60000];  // waits before retrying after a failed push, the last one repeating

// What the server has: the hash of its config and of each space's snapshot. Kept up to date with
// every push, and asked again at each rescan.
let onServer = { config: null, spaces: {} };

// ---------- the push queue ----------

// One job per key ("config", or a space's key), the latest replacing an older one still waiting.
// Jobs go out one at a time, the config first since the server prunes by it. After a failure the
// queue waits and tries again from the start.
const queue = new Map();
let draining = false;
let failures = 0;
let retryTimer = null;

function enqueue(job) {
  queue.delete(job.key);
  queue.set(job.key, job);
}

// Push one job; resolves to the line to log about it.
async function pushJob(job) {
  if (job.key === 'config') {
    const done = await pushConfig(job.text);
    onServer.config = job.hash;
    return done;
  }
  const done = await pushSpace(job.space, job);
  onServer.spaces[job.key] = job.hash;
  return done;
}

async function drain() {
  if (draining) return;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  draining = true;
  const name = (job) => (job.key === 'config' ? 'taskmgr.json' : label(job.space));
  let pushed = 0;
  try {
    if (queue.size) syncLog('info', `pushing ${[...queue.values()].map(name).join(', ')}`);
    while (queue.size) {
      const job = queue.has('config') ? queue.get('config') : queue.values().next().value;
      let done;
      try {
        done = await pushJob(job);
      } catch (e) {
        failures++;
        const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
        syncLog(false, `${name(job)}: ${e.message}; trying again in ${wait / 1000}s`);
        warn(`${name(job)}: ${e.message}; trying again in ${wait / 1000}s`);
        retryTimer = setTimeout(() => { retryTimer = null; drain(); }, wait);
        return;
      }
      if (failures) log(`${SERVER} answers again`);
      failures = 0;
      log(done);
      syncLog(true, done);
      pushed++;
      if (queue.get(job.key) === job) queue.delete(job.key);  // a newer one may have replaced it meanwhile
    }
    if (pushed) syncLog('info', 'push finished');
  } finally {
    draining = false;
  }
}

// ---------- watching ----------

let current = null;        // the last good config: { text, hash, works }
const roots = new Map();   // tasks folder -> { root, spaces, watcher, timer, pollTimer, missing }

// Compare a tasks folder with what the server has and queue the spaces that differ. A folder that
// is not there is looked for from time to time instead.
async function scanRoot(root) {
  const r = roots.get(root);
  if (!r) return;
  if (!isDir(root)) {
    if (!r.missing) {
      warn(`${root}: folder not found (${r.spaces.map(label).join(', ')}); waiting for it`);
      r.missing = true;
    }
    stopWatching(r);
    if (!r.pollTimer) r.pollTimer = setTimeout(() => { r.pollTimer = null; scanRoot(root); }, MISSING_POLL_MS);
    return;
  }
  if (r.missing) {
    log(`${root}: folder found`);
    r.missing = false;
  }
  if (!r.watcher) watchRoot(r);
  // A newer scan of the same folder started meanwhile, or the folder was dropped: this one's result
  // is left out.
  const seq = r.scanSeq = (r.scanSeq || 0) + 1;
  let snap;
  try {
    snap = await snapshot(root);
  } catch (e) {
    warn(`${root}: ${e.message}`);
    return;
  }
  if (roots.get(root) !== r || r.scanSeq !== seq) return;
  const { entries, blobs, hash } = snap;
  let queued = 0;
  for (const s of r.spaces) {
    const key = spaceKey(s);
    if (onServer.spaces[key] !== hash) { enqueue({ key, space: s, entries, blobs, hash }); queued++; }
  }
  syncLog('info', `checked ${root}: ${queued ? `${queued === r.spaces.length ? '' : `${queued} of ${r.spaces.length} `}to push` : 'same as on the server'}`);
  drain();
}

function scheduleScan(root) {
  const r = roots.get(root);
  if (!r) return;
  if (r.timer) clearTimeout(r.timer);
  r.timer = setTimeout(() => { r.timer = null; scanRoot(root); }, DEBOUNCE_MS);
}

function watchRoot(r) {
  try {
    r.watcher = fs.watch(r.root, { recursive: true }, () => scheduleScan(r.root));
  } catch (e) {
    // No recursive watching here (an older Linux): look at the folder every so often instead.
    r.watcher = { close() { clearInterval(this.id); }, id: setInterval(() => scheduleScan(r.root), MISSING_POLL_MS) };
    warn(`${r.root}: cannot watch (${e.code || e.message}); checking it every ${MISSING_POLL_MS / 1000}s instead`);
    return;
  }
  // The folder went away, or was replaced: the next scan finds out and watches again.
  r.watcher.on('error', () => { stopWatching(r); scheduleScan(r.root); });
}

function stopWatching(r) {
  if (r.watcher) {
    try { r.watcher.close(); } catch (e) { /* already closed */ }
    r.watcher = null;
  }
}

function forgetRoot(r) {
  stopWatching(r);
  if (r.timer) clearTimeout(r.timer);
  if (r.pollTimer) clearTimeout(r.pollTimer);
  roots.delete(r.root);
}

// Read taskmgr.json again: push it when the server has another one, watch the tasks folders it
// lists (and no longer the ones gone), and compare every folder with the server.
function reconcile() {
  const c = readConfig();
  if (c) {
    if (current && c.hash !== current.hash) log('taskmgr.json changed');
    current = c;
  }
  if (!current) return;  // nothing good read yet
  if (onServer.config !== current.hash) enqueue({ key: 'config', text: current.text, hash: current.hash });

  const byRoot = new Map();
  for (const s of spacesOf(current.works)) {
    if (!byRoot.has(s.root)) byRoot.set(s.root, []);
    byRoot.get(s.root).push(s);
  }
  for (const r of [...roots.values()]) if (!byRoot.has(r.root)) forgetRoot(r);
  for (const [root, spaces] of byRoot) {
    const r = roots.get(root);
    if (r) r.spaces = spaces;
    else roots.set(root, { root, spaces, watcher: null, timer: null, pollTimer: null, missing: false });
  }
  // Spaces no longer in the file are pruned by the server when the config arrives.
  const keys = new Set([...byRoot.values()].flat().map(spaceKey));
  for (const k of Object.keys(onServer.spaces)) if (!keys.has(k)) delete onServer.spaces[k];
  for (const root of byRoot.keys()) scanRoot(root);
  drain();
}

let configTimer = null;
function watchConfig() {
  // The file itself is often replaced by an editor, so its folder is watched. Hash comparison
  // (onServer.config) stops a change from being pushed twice.
  const dir = path.dirname(CONFIG_PATH);
  const name = path.basename(CONFIG_PATH);
  fs.watch(dir, (eventType, filename) => {
    if (filename && filename !== name) return;
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(() => { configTimer = null; reconcile(); }, DEBOUNCE_MS);
  });
}

// Ask the server what it has, then compare everything with it. Run at startup and every RESCAN_MS.
// The first time, taskmgr.json is pushed whatever the server has.
let startup = true;
async function rescan() {
  syncLog('info', `polling ${SERVER}`);
  try {
    const state = await serverState();
    onServer = { config: startup ? null : state.config, spaces: state.spaces };
    startup = false;
    if (failures) log(`${SERVER} answers again`);
    failures = 0;
    syncLog('info', `polled ${SERVER}: ${Object.keys(state.spaces).length} tasks folder${Object.keys(state.spaces).length === 1 ? '' : 's'} there`);
  } catch (e) {
    failures++;
    const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
    syncLog(false, `${e.message}; trying again in ${wait / 1000}s`);
    warn(`${e.message}; trying again in ${wait / 1000}s`);
    setTimeout(rescan, wait);
    return;
  }
  reconcile();
}

// ---------- main ----------

log('taskmgrd');
syncLog('info', `taskmgrd started (server ${SERVER})`);
log(`  config     : ${CONFIG_PATH}`);
log(`  server     : ${SERVER}`);

const first = readConfig();
if (!first) die(`${CONFIG_PATH} could not be read, or is invalid (see above).`);
current = first;
for (const s of spacesOf(first.works)) log(`  ${s.repository ? 'repository' : 'work      '} : ${label(s)}  ${s.root}`);

watchConfig();
rescan();
setInterval(rescan, RESCAN_MS);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const r of [...roots.values()]) forgetRoot(r);
    log('taskmgrd stopped');
    syncLog('info', 'taskmgrd stopped');
    process.exit(0);
  });
}
