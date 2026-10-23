#!/usr/bin/env node
// tm push: send taskmgr.json and the tasks folder of every work and repository listed there to a
// remote tm server, which keeps a copy under its data/ folder laid out like the origins tree
// (server/sync.js has the layout and the API). Run by hand it pushes what differs once and exits;
// taskmgrd.js, the sync daemon, uses the same functions to push whenever something changes.
//
//   node push.js      (what `tm push` runs)
//
// .env (next to this file):
//   TASKMGRD_SERVER=https://tm.example.com   the server to push to: the URL of its web UI
//   TASKMGRD_TOKEN=...                        the same value as TASKMGRD_TOKEN in that server's .env
//
// taskmgr.json is pushed whole; an invalid one is not pushed. A tasks folder is pushed as a snapshot
// of everything in it: every file (task.txt files as text, the others, attachments included, by the
// sha1 of their content, the server asked first which of them it does not have yet and those
// uploaded) and every empty folder; the server brings its copy to the snapshot, so after a push its
// copy is the folder as it is here, and a renamed, moved or deleted task or attachment is mirrored
// too. Only .DS_Store files are left out, and files over 5 MB and folders over 10 MB (never the tasks
// folder itself) are not pushed. A tasks folder that does not exist is left as it is on the server.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadDotenv, parseConfig, DEFAULT_CONFIG_PATH } = require('./server/config');
const { spaceKey } = require('./server/sync');
const syncState = require('./server/syncstate');
const { TASK_FILE } = require('./utils/taskUtils');

const REQUEST_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;  // one attachment
const MAX_FILE_BYTES = 5 * 1024 * 1024;     // a larger file is not pushed
const MAX_FOLDER_BYTES = 10 * 1024 * 1024;  // a folder (inside a tasks folder) whose content is larger is not pushed
const SKIPPED_FILES = new Set(['.DS_Store']);  // never pushed: Finder rewrites it all the time

loadDotenv();
const SERVER = String(process.env.TASKMGRD_SERVER || '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.TASKMGRD_TOKEN || '').trim();
const CONFIG_PATH = DEFAULT_CONFIG_PATH;

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const log = (...args) => console.log(...args);
const warn = (...args) => console.error(...args);

// One line per file sync attempt, appended to logs/taskmgrd/taskmgrd.log: SUCCESS, FAILED, or
// WARNING for something left out on purpose (success is true, false or 'warning').
const SYNC_LOG = path.join(__dirname, 'logs', 'taskmgrd', 'taskmgrd.log');
function syncLog(success, message) {
  const level = success === 'warning' ? 'WARNING' : success ? 'SUCCESS' : 'FAILED ';
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(SYNC_LOG), { recursive: true });
    fs.appendFileSync(SYNC_LOG, line);
  } catch (e) {
    console.error(`cannot write ${SYNC_LOG}: ${e.message}`);
  }
}

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

// The sha1 of a file's content, read in chunks; remembered by size and mtime, so the attachments
// are not read again at every scan.
const hashCache = new Map();  // abs -> { size, mtimeMs, sha1 }
function fileHash(abs, stat) {
  const c = hashCache.get(abs);
  if (c && c.size === stat.size && c.mtimeMs === stat.mtimeMs) return c.sha1;
  const hash = crypto.createHash('sha1');
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (let n = fs.readSync(fd, buf); n > 0; n = fs.readSync(fd, buf)) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  const sha = hash.digest('hex');
  hashCache.set(abs, { size: stat.size, mtimeMs: stat.mtimeMs, sha1: sha });
  return sha;
}

// The total size of the files under a folder, links followed; stops counting once past `limit`.
function dirSize(dir, limit) {
  let total = 0;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return 0;
  }
  for (const name of names) {
    if (SKIPPED_FILES.has(name)) continue;
    let stat;
    try {
      stat = fs.statSync(path.join(dir, name));
    } catch (e) {
      continue;
    }
    if (stat.isDirectory()) total += dirSize(path.join(dir, name), limit - total);
    else if (stat.isFile()) total += stat.size;
    if (total > limit) break;
  }
  return total;
}

// Everything under a tasks folder, as the server mirrors it: every file, relative to the folder, a
// task.txt as text and any other file (attachments, whatever else is there) by the sha1 of its
// content, which the server fetches from its blob store (see pushSpace); an empty folder as a bare
// folder. Symbolic links are followed; .DS_Store files are left out. Sorted, so the same folder
// always gives the same hash. `blobs` maps each sha1 to one file that has it, for the upload.
function snapshot(root) {
  const entries = [];
  const blobs = new Map();
  const seen = new Set();
  const walk = (dir, rel, inTask) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    // Only a folder inside a task can be skipped for its size; the task's own folder (and done/,
    // pending/ and the like around it) always goes, minus whatever is too large in it.
    inTask = inTask || names.includes(TASK_FILE);
    let count = 0;
    for (const name of names) {
      if (SKIPPED_FILES.has(name)) continue;
      const abs = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(abs);  // through a symbolic link
      } catch (e) {
        continue;  // a broken link, or gone meanwhile
      }
      const entryRel = rel ? `${rel}/${name}` : name;
      if (stat.isDirectory()) {
        if (inTask && !fs.existsSync(path.join(abs, TASK_FILE)) && dirSize(abs, MAX_FOLDER_BYTES) > MAX_FOLDER_BYTES) {
          syncLog('warning', `skipped folder ${abs}: larger than 10 MB`);
          continue;
        }
        walk(abs, entryRel, inTask);
      } else if (stat.isFile()) {
        if (stat.size > MAX_FILE_BYTES) {
          syncLog('warning', `skipped file ${abs}: larger than 5 MB`);
          continue;
        }
        if (name === TASK_FILE) {
          try {
            entries.push({ path: entryRel, content: fs.readFileSync(abs, 'utf8') });
          } catch (e) {
            continue;
          }
        } else {
          let sha;
          try {
            sha = fileHash(abs, stat);
          } catch (e) {
            continue;
          }
          seen.add(abs);
          entries.push({ path: entryRel, blob: sha });
          if (!blobs.has(sha)) blobs.set(sha, abs);
        }
      } else {
        continue;  // a socket, a device: not a file to mirror
      }
      count++;
    }
    if (!count && rel) entries.push({ path: rel, dir: true });
  };
  walk(root, '', false);
  for (const abs of hashCache.keys()) if (!seen.has(abs) && abs.startsWith(root + path.sep)) hashCache.delete(abs);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, blobs, hash: sha1(JSON.stringify(entries)) };
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

// ---------- the server ----------

// One request to the server: `body` is sent as JSON, or as it is when it is a Buffer (a file). A
// refused request throws an error carrying the server's `code` and `missing` (see server/sync.js).
async function request(method, route, body, { timeout = REQUEST_TIMEOUT_MS } = {}) {
  const raw = Buffer.isBuffer(body);
  let res;
  try {
    res = await fetch(`${SERVER}${route}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no answer in time' : (e.cause && e.cause.code) || e.cause?.message || e.message;
    throw new Error(`cannot reach ${SERVER} (${why})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${SERVER} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
    err.code = data.code;
    err.missing = data.missing;
    throw err;
  }
  return data;
}

// What the server has: { config, spaces }, the hash of its config and of each space's last snapshot.
async function serverState() {
  const state = await request('GET', '/api/sync');
  return { config: state.config || null, spaces: state.spaces || {} };
}

// Push taskmgr.json; resolves to the line to log about it.
async function pushConfig(text) {
  const { pruned } = await request('PUT', '/api/sync/config', { text });
  return `pushed taskmgr.json${pruned.length ? ` (removed on the server: ${pruned.join(', ')})` : ''}`;
}

// Push one space's snapshot (see snapshot); resolves to the line to log about it.
async function pushSpace(space, { entries, blobs }) {
  // The attachments the server does not have yet go first, one by one; then the snapshot. Should
  // the server lose one meanwhile, it says which (MISSING_BLOBS) and those are sent once more.
  let uploaded = 0;
  const upload = async (shas) => {
    for (const sha of shas) {
      const abs = blobs.get(sha);
      if (!abs) throw new Error(`${label(space)}: no file for blob ${sha}`);
      let content;
      try {
        content = fs.readFileSync(abs);
      } catch (e) {
        throw new Error(`${abs}: ${e.message}`);
      }
      await request('PUT', `/api/sync/blob/${sha}`, content, { timeout: UPLOAD_TIMEOUT_MS });
      uploaded++;
    }
  };
  if (blobs.size) {
    const { missing } = await request('POST', '/api/sync/blobs', { blobs: [...blobs.keys()] });
    await upload(missing);
  }
  const body = { origin: space.origin, work: space.work, repository: space.repository, entries };
  let result;
  try {
    result = await request('PUT', '/api/sync/space', body);
  } catch (e) {
    if (e.code !== 'MISSING_BLOBS' || !Array.isArray(e.missing)) throw e;
    await upload(e.missing);
    result = await request('PUT', '/api/sync/space', body);
  }
  const { files, dirs } = result;
  try { syncState.set(spaceKey(space), syncState.manifestOf(entries)); } catch (e) { warn(`could not record the sync state: ${e.message}`); }
  const n = (count, what) => `${count} ${what}${count === 1 ? '' : 's'}`;
  return `pushed ${label(space)} (${n(files, 'file')}${dirs ? `, ${n(dirs, 'empty folder')}` : ''}${uploaded ? `, ${n(uploaded, 'attachment')} uploaded` : ''})`;
}

module.exports = { SERVER, CONFIG_PATH, log, warn, die, syncLog, readConfig, spacesOf, label, snapshot, isDir, serverState, pushConfig, pushSpace };

// ---------- tm push ----------

// Push taskmgr.json, then every tasks folder whose snapshot the server does not have; exit with an
// error at the first push that fails.
async function main() {
  log('tm push');
  log(`  config     : ${CONFIG_PATH}`);
  log(`  server     : ${SERVER}`);
  const config = readConfig();
  if (!config) die(`${CONFIG_PATH} could not be read, or is invalid (see above).`);
  let state;
  try {
    state = await serverState();
  } catch (e) {
    die(e.message);
  }
  const push = async (what, run) => {
    try {
      const done = await run();
      log(done);
      syncLog(true, done);
    } catch (e) {
      syncLog(false, `${what}: ${e.message}`);
      die(`${what}: ${e.message}`);
    }
  };
  let pushed = 0;
  // taskmgr.json always goes first: the server prunes by it.
  await push('taskmgr.json', () => pushConfig(config.text));
  pushed++;
  const byRoot = new Map();
  for (const s of spacesOf(config.works)) {
    if (!byRoot.has(s.root)) byRoot.set(s.root, []);
    byRoot.get(s.root).push(s);
  }
  for (const [root, spaces] of byRoot) {
    if (!isDir(root)) {
      warn(`${root}: folder not found (${spaces.map(label).join(', ')})`);
      continue;
    }
    const snap = snapshot(root);
    for (const s of spaces) {
      if (state.spaces[spaceKey(s)] === snap.hash) continue;
      await push(label(s), () => pushSpace(s, snap));
      pushed++;
    }
  }
  log(pushed > 1 ? 'done' : 'done: every tasks folder was already up to date');
}

if (require.main === module) main().catch((e) => die(e.message));
