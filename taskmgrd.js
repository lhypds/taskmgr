#!/usr/bin/env node
// taskmgrd: the sync daemon. It watches taskmgr.json and the tasks folder of every work and
// repository listed there, and pushes what changes to a remote tm server, which keeps a copy under
// its data/ folder laid out like the origins tree (server/sync.js has the layout and the API).
//
//   node taskmgrd.js          ./taskmgrd.sh runs it under pm2
//
// .env (next to this file):
//   TASKMGRD_SERVER=https://tm.example.com   the server to push to: the URL of its web UI
//   TASKMGRD_TOKEN=...                        the same value as TASKMGRD_TOKEN in that server's .env
//
// taskmgr.json is pushed whole when it changes; an invalid one is not pushed, and the folders of
// the last good one stay watched. A tasks folder is pushed as a snapshot of its task files, every
// task.txt with the folder it is in (done / pending folders and subtasks included; a task folder
// without a task.txt as a bare folder), whenever anything in it changes; the server replaces its
// copy with the snapshot, so a renamed, moved or deleted task is mirrored too. Attachments are not
// pushed. A tasks folder that does not exist is left as it is on the server and looked for until it
// appears. At startup, and every few minutes after that, the daemon asks the server what it has and
// pushes what differs; so a change missed by the file system, or a server that lost its data, is
// put right. A push that fails is retried, with growing waits, until the server answers again.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadDotenv, parseConfig, DEFAULT_CONFIG_PATH } = require('./server/config');
const { spaceKey } = require('./server/sync');
const { TASK_FILE, STATUS_DIRS, isTaskFolder } = require('./utils/taskUtils');

const DEBOUNCE_MS = 1500;               // changes within this window go out together
const RESCAN_MS = 5 * 60 * 1000;        // how often the server is asked what it has, and everything compared
const MISSING_POLL_MS = 30 * 1000;      // how often a missing tasks folder is looked for
const RETRY_MS = [5000, 15000, 60000];  // waits before retrying after a failed push, the last one repeating
const REQUEST_TIMEOUT_MS = 30 * 1000;

loadDotenv();
const SERVER = String(process.env.TASKMGRD_SERVER || '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.TASKMGRD_TOKEN || '').trim();
const CONFIG_PATH = DEFAULT_CONFIG_PATH;

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const log = (...args) => console.log(...args);
const warn = (...args) => console.error(...args);

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!SERVER) die('TASKMGRD_SERVER is not set in .env (the tm server to push to, e.g. https://tm.example.com).');
if (!/^https?:\/\//.test(SERVER)) die(`TASKMGRD_SERVER must be an http(s) URL, not "${SERVER}".`);
if (!TOKEN) die('TASKMGRD_TOKEN is not set in .env (the same value as in the remote server\'s .env).');

// ---------- what to push ----------

// taskmgr.json read and checked: { text, hash, works }, or null (with a warning) when it cannot be
// read or is invalid, in which case the caller keeps the last good one.
function readConfig() {
  let text;
  try {
    text = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    warn(`Warning: could not read ${CONFIG_PATH}: ${e.message}`);
    return null;
  }
  try {
    return { text, hash: sha1(text), works: parseConfig(text, CONFIG_PATH).works };
  } catch (e) {
    warn(`Warning: ${e.message} (not pushed; the previous configuration stays)`);
    return null;
  }
}

// Every folder of tasks in the config: a work's common tasks, and each of its repositories.
function spacesOf(works) {
  const spaces = [];
  for (const w of works) {
    if (w.root) spaces.push({ origin: w.origin, work: w.work, repository: '', root: w.root });
    for (const p of w.repositories) spaces.push({ origin: w.origin, work: w.work, repository: p.name, root: p.root });
  }
  return spaces;
}

const label = (s) => `${s.origin ? `${s.origin} / ` : ''}${s.work}${s.repository ? ` / ${s.repository}` : ''}`;

// The task files under a tasks folder, as the server mirrors them: every task.txt, with the folder
// it is in (done / pending folders and subtasks on the way) relative to the tasks folder, and a
// task folder without a task.txt as a bare folder. Other files, attachments included, are left out.
// Sorted, so the same tasks always give the same hash.
function snapshot(root) {
  const entries = [];
  const walk = (dir, rel) => {
    for (const status of ['', ...STATUS_DIRS]) {
      const listDir = status ? path.join(dir, status) : dir;
      let names;
      try {
        names = fs.readdirSync(listDir, { withFileTypes: true });
      } catch (e) {
        continue;
      }
      for (const e of names) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue;
        const abs = path.join(listDir, e.name);
        if (!isTaskFolder(abs)) continue;
        const taskRel = [rel, status, e.name].filter(Boolean).join('/');
        let content = null;
        try {
          content = fs.readFileSync(path.join(abs, TASK_FILE), 'utf8');
        } catch (err) { /* a task folder without a task file */ }
        if (content === null) entries.push({ path: taskRel, dir: true });
        else entries.push({ path: `${taskRel}/${TASK_FILE}`, content });
        walk(abs, taskRel);
      }
    }
  };
  walk(root, '');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, hash: sha1(JSON.stringify(entries)) };
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

// ---------- the server ----------

async function request(method, route, body) {
  let res;
  try {
    res = await fetch(`${SERVER}${route}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no answer in time' : (e.cause && e.cause.code) || e.cause?.message || e.message;
    throw new Error(`cannot reach ${SERVER} (${why})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${SERVER} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
  return data;
}

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
    const { pruned } = await request('PUT', '/api/sync/config', { text: job.text });
    onServer.config = job.hash;
    return `pushed taskmgr.json${pruned.length ? ` (removed on the server: ${pruned.join(', ')})` : ''}`;
  }
  const { files, dirs } = await request('PUT', '/api/sync/space', {
    origin: job.space.origin, work: job.space.work, repository: job.space.repository, entries: job.entries
  });
  onServer.spaces[job.key] = job.hash;
  return `pushed ${label(job.space)} (${files} task file${files === 1 ? '' : 's'}${dirs ? `, ${dirs} bare folder${dirs === 1 ? '' : 's'}` : ''})`;
}

async function drain() {
  if (draining) return;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  draining = true;
  try {
    while (queue.size) {
      const job = queue.has('config') ? queue.get('config') : queue.values().next().value;
      let done;
      try {
        done = await pushJob(job);
      } catch (e) {
        failures++;
        const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
        warn(`${job.key === 'config' ? 'taskmgr.json' : label(job.space)}: ${e.message}; trying again in ${wait / 1000}s`);
        retryTimer = setTimeout(() => { retryTimer = null; drain(); }, wait);
        return;
      }
      if (failures) log(`${SERVER} answers again`);
      failures = 0;
      log(done);
      if (queue.get(job.key) === job) queue.delete(job.key);  // a newer one may have replaced it meanwhile
    }
  } finally {
    draining = false;
  }
}

// ---------- watching ----------

let current = null;        // the last good config: { text, hash, works }
const roots = new Map();   // tasks folder -> { root, spaces, watcher, timer, pollTimer, missing }

// Compare a tasks folder with what the server has and queue the spaces that differ. A folder that
// is not there is looked for from time to time instead.
function scanRoot(root) {
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
  const { entries, hash } = snapshot(root);
  for (const s of r.spaces) {
    const key = spaceKey(s);
    if (onServer.spaces[key] !== hash) enqueue({ key, space: s, entries, hash });
  }
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
async function rescan() {
  try {
    const state = await request('GET', '/api/sync');
    onServer = { config: state.config || null, spaces: state.spaces || {} };
    if (failures) log(`${SERVER} answers again`);
    failures = 0;
  } catch (e) {
    failures++;
    const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
    warn(`${e.message}; trying again in ${wait / 1000}s`);
    setTimeout(rescan, wait);
    return;
  }
  reconcile();
}

// ---------- main ----------

log('taskmgrd');
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
    process.exit(0);
  });
}
