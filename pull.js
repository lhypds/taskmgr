#!/usr/bin/env node
// tm pull: fetch taskmgr.json, every task.txt and every other file (attachments, files in folders)
// from the server taskmgrd pushes to (what `tm push` sends), and put them here. Nothing local is
// deleted unless it is a task the server deleted since the last sync (see server/syncstate.js): a file or folder
// that exists is updated when it differs, one that does not is added.
//
//   node pull.js      (what `tm pull` runs; TASKMGRD_SERVER and TASKMGRD_TOKEN in .env, as for taskmgrd)
//
// taskmgr.json is merged, not replaced, and only for what is already here: an origin, work or
// repository here keeps its own tasks_path and source_path (the server's are folders on the server)
// and takes the server's other fields; one only on the server is not pulled, nor its files; one only
// here stays. Then the tasks folder of every work and repository here that the server also has is filled.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const syncState = require('./server/syncstate');
const { spaceKey, moveTasks } = require('./server/sync');
const { loadDotenv, parseConfig, upgradeRaw, DEFAULT_CONFIG_PATH } = require('./server/config');

const REQUEST_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;  // one attachment

loadDotenv();
const SERVER = String(process.env.TASKMGRD_SERVER || '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.TASKMGRD_TOKEN || '').trim();

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!SERVER) die('TASKMGRD_SERVER is not set in .env (the tm server to pull from, e.g. https://tm.example.com).');
if (!/^https?:\/\//.test(SERVER)) die(`TASKMGRD_SERVER must be an http(s) URL, not "${SERVER}".`);
if (!TOKEN) die('TASKMGRD_TOKEN is not set in .env (the same value as in the remote server\'s .env).');

// One GET; `raw` answers the body as a Buffer, otherwise the JSON.
async function get(route, query, { raw = false, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  let res;
  try {
    res = await fetch(`${SERVER}/api/sync/pull/${route}${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no answer in time' : (e.cause && e.cause.code) || e.cause?.message || e.message;
    throw new Error(`cannot reach ${SERVER} (${why})`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`${SERVER} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
const name = (v, key) => (v && typeof v[key] === 'string' ? v[key].trim() : '');
const label = (s) => `${s.origin ? `${s.origin} / ` : ''}${s.work}${s.repository ? ` / ${s.repository}` : ''}`;

// taskmgr.json here (raw, "origins" form) with the server's fields merged into what is already
// here: an origin, work or repository only on the server is not added, and nothing here is removed.
// A work or repository keeps its own tasks_path and source_path (the server's are folders there).
function mergeFromServer(here, server) {
  const merged = { ...here, origins: (here.origins || []).map(g => ({ ...g, works: (g.works || []).map(w => ({ ...w })) })) };
  for (const g of server.origins || []) {
    const origin = name(g, 'origin');
    const target = merged.origins.find(o => name(o, 'origin') === origin);
    if (target) {
      const { works, ...rest } = g;
      Object.assign(target, rest);
    }
    for (const w of g.works || []) {
      // Work names are unique across origins: a work here stays in its own origin.
      const work = name(w, 'work');
      const mine = merged.origins.flatMap(o => o.works).find(x => name(x, 'work') === work);
      if (!mine) continue;
      const { tasks_path, repositories, ...fields } = w;
      Object.assign(mine, fields);
      for (const p of repositories || []) {
        const mineRepo = (mine.repositories || []).find(x => name(x, 'repository') === name(p, 'repository'));
        if (!mineRepo) continue;
        const { tasks_path: _t, source_path: _s, ...pf } = p;
        Object.assign(mineRepo, pf);
      }
    }
  }
  return merged;
}

// One path of the server's listing, checked: plain names only, so nothing lands outside the folder.
function safeJoin(root, rel) {
  const parts = String(rel).split('/');
  if (!rel || parts.some(s => !s || s === '.' || s === '..' || s.includes('\0') || /[\\:]/.test(s))) throw new Error(`invalid path "${rel}"`);
  const abs = path.resolve(root, ...parts);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(`path "${rel}" leaves the folder`);
  return abs;
}

function writeFileAtomic(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, abs);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const readIf = (abs) => {
  try {
    return fs.statSync(abs).isFile() ? fs.readFileSync(abs) : null;
  } catch (e) {
    return null;
  }
};

async function pullSpace(s, root, stats) {
  const query = { origin: s.origin, work: s.work, repository: s.repository };
  const key = spaceKey(s);
  const known = syncState.get(key) || {};  // what both sides had at the last push or pull
  const { entries } = await get('space', query);
  const onServer = syncState.manifestOf(entries);
  const failedBefore = stats.failed;
  fs.mkdirSync(root, { recursive: true });
  // A task the server has under another status folder than here is moved, not pulled as a second copy.
  moveTasks(root, entries, {
    onMove: () => { stats.updated++; },
    onError: (p, err) => { stats.failed++; console.error(`${label(s)}: ${p}: ${err.message}`); }
  });

  // A task deleted on the server since the last sync (its task.txt known, now gone there) is deleted
  // here too, with its folder, unless its task.txt was edited here since or a subtask is still in it.
  // Any other file missing on the server is left alone: it may only be one taskmgrd did not push
  // (too large), not a deleted one.
  const hasTask = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some(d => d.isDirectory() ? hasTask(path.join(dir, d.name)) : d.name === 'task.txt');
  const gone = Object.keys(known).filter(p => !(p in onServer) && p.split('/').pop() === 'task.txt').sort((a, b) => b.length - a.length);
  for (const p of gone) {
    try {
      const abs = safeJoin(root, p);
      const have = readIf(abs);
      if (!have) continue;
      if (sha1(have) !== known[p]) {
        console.error(`${label(s)}: ${p}: deleted on the server but changed here, kept`);
        continue;
      }
      const dir = path.dirname(abs);
      if (dir === path.resolve(root)) fs.rmSync(abs);
      else if (fs.readdirSync(dir, { withFileTypes: true }).some(d => d.isDirectory() && hasTask(path.join(dir, d.name)))) fs.rmSync(abs);  // a subtask stays
      else fs.rmSync(dir, { recursive: true, force: true });
      stats.updated++;
    } catch (err) {
      stats.failed++;
      console.error(`${label(s)}: ${p}: ${err.message}`);
    }
  }

  for (const e of entries) {
    try {
      const abs = safeJoin(root, e.path);
      if (e.dir === true) {
        if (!fs.existsSync(abs)) { fs.mkdirSync(abs, { recursive: true }); stats.added++; }
        continue;
      }
      const have = readIf(abs);
      if (typeof e.content === 'string') {
        if (have && have.toString('utf8') === e.content) continue;
        writeFileAtomic(abs, e.content);
      } else if (typeof e.blob === 'string') {
        if (have && sha1(have) === e.blob) continue;
        const data = await get('file', { ...query, path: e.path }, { raw: true, timeout: DOWNLOAD_TIMEOUT_MS });
        if (sha1(data) !== e.blob) throw new Error('the download does not match its sha1');
        writeFileAtomic(abs, data);
      } else {
        continue;
      }
      stats[have ? 'updated' : 'added']++;
    } catch (err) {
      stats.failed++;
      console.error(`${label(s)}: ${e.path}: ${err.message}`);
    }
  }
  // Remembered only when the whole space went through; what was left out stays as it was known.
  if (stats.failed === failedBefore) {
    for (const p of Object.keys(known)) if (!(p in onServer) && fs.existsSync(safeJoin(root, p))) onServer[p] = known[p];  // kept here: still known
    syncState.set(key, onServer);
  }
}

(async () => {
  console.log('tm pull');
  console.log(`  server     : ${SERVER}`);
  let serverText;
  try {
    serverText = (await get('config')).text;
  } catch (e) {
    die(e.message);
  }
  let serverRaw;
  let serverWorks;
  try {
    serverWorks = parseConfig(serverText, 'the server\'s taskmgr.json').works;
    serverRaw = upgradeRaw(JSON.parse(serverText));
  } catch (e) {
    die(e.message);
  }
  const serverSpaces = new Set();
  for (const w of serverWorks) {
    if (w.root) serverSpaces.add([w.origin || '', w.work, ''].join('/'));
    for (const p of w.repositories) serverSpaces.add([w.origin || '', w.work, p.name].join('/'));
  }

  let here;
  let hereText;
  try {
    hereText = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
  } catch (e) {
    die(e.code === 'ENOENT' ? `${DEFAULT_CONFIG_PATH} does not exist: tm pull only updates the origins, works and repositories listed there.` : `could not read ${DEFAULT_CONFIG_PATH}: ${e.message}`);
  }
  try {
    parseConfig(hereText, DEFAULT_CONFIG_PATH);
    here = upgradeRaw(JSON.parse(hereText));
  } catch (e) {
    die(`${e.message} (fix it first; nothing was pulled)`);
  }
  const mergedText = JSON.stringify(mergeFromServer(here, serverRaw), null, 2) + '\n';
  let merged;
  try {
    merged = parseConfig(mergedText, 'the merged taskmgr.json');
  } catch (e) {
    die(`cannot merge the server's taskmgr.json with the one here: ${e.message}`);
  }
  const changed = JSON.stringify(JSON.parse(hereText)) !== JSON.stringify(JSON.parse(mergedText));
  if (changed) {
    fs.writeFileSync(DEFAULT_CONFIG_PATH, mergedText);
    console.log(`pulled taskmgr.json`);
  }

  const stats = { added: 0, updated: 0, failed: 0 };
  for (const w of merged.works) {
    const spaces = [];
    if (w.root) spaces.push({ origin: w.origin || '', work: w.work, repository: '', root: w.root });
    for (const p of w.repositories) spaces.push({ origin: w.origin || '', work: w.work, repository: p.name, root: p.root });
    for (const s of spaces) {
      if (!serverSpaces.has([s.origin, s.work, s.repository].join('/'))) continue;
      const before = { ...stats };
      try {
        await pullSpace(s, s.root, stats);
      } catch (e) {
        stats.failed++;
        console.error(`${label(s)}: ${e.message}`);
        continue;
      }
      const a = stats.added - before.added;
      const u = stats.updated - before.updated;
      if (a || u) console.log(`pulled ${label(s)} (${a} added, ${u} updated)`);
    }
  }
  console.log(stats.added || stats.updated || changed ? `done: ${stats.added} added, ${stats.updated} updated${changed ? ', taskmgr.json merged' : ''}` : 'nothing to pull, everything is up to date');
  if (stats.failed) die(`${stats.failed} file${stats.failed === 1 ? '' : 's'} could not be pulled (see above)`);
})().catch((e) => die(e.message));
