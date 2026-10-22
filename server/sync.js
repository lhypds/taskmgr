// Receiving end of taskmgrd (taskmgrd.js): the daemon on the machine that has the tasks pushes its
// taskmgr.json and the tasks folder of every work and repository here, whole: task files,
// attachments and every other file in it. The config is merged into this server's own taskmgr.json,
// each pushed work and repository pointing at its copy of the tasks, which is kept under data/, laid
// out like the origins tree of taskmgr.json:
//
//   data/
//     origins/
//       <origin>/                     "_" for the works without an origin
//         <work>/
//           tasks/                    the work's common tasks (its tasks_path), the folder as it is
//             202508142100 Buy apple/task.txt
//             202508142100 Buy apple/receipt.pdf
//             done/202508142000 Buy orange/task.txt
//           repositories/
//             <repository>/           the repository's tasks (its tasks_path, or the "tasks" folder of its source)
//               202508142200 Fix mail/task.txt
//
// Every request carries `Authorization: Bearer <TASKMGRD_TOKEN>`: the same secret is TASKMGRD_TOKEN
// in both .env files. Without TASKMGRD_TOKEN in this server's .env, pushes are refused (503).
//
//   GET /api/sync                                            -> { ok, config, spaces }
//       what is here: the sha1 of the last pushed config, and of each space's last snapshot
//       ("origin/work/repository" -> sha1), so the daemon pushes only what differs.
//   PUT /api/sync/config  { text }                           -> { ok, pruned }
//       merges the config into this server's taskmgr.json (an invalid one is refused; see
//       mergeConfigs), with the pushed tasks_path set to the copies under data/origins/ (see
//       toMirror), and removes, under data/origins/, the origins, works and repositories not in it.
//   POST /api/sync/blobs  { blobs: [sha1] }                  -> { ok, missing }
//       which of these files the server does not have yet (see the blob store below).
//   PUT /api/sync/blob/<sha1>   (the raw file)               -> { ok }
//       stores one file by the sha1 of its content; refused when the content does not hash to it.
//   PUT /api/sync/space   { origin, work, repository, entries }  -> { ok, files, dirs }
//       replaces one space's folder with the snapshot: entries are [{ path, content }] for task
//       files (text), [{ path, blob: sha1 }] for every other file, taken from the blob store, and
//       [{ path, dir: true }] for an empty folder, paths relative to the space's folder. When a blob
//       is not in the store, nothing is written and the answer is 409 MISSING_BLOBS { missing }.
//
// Attachments go through the blob store, data/.sync-blobs/<sha1>, so that a file the server already
// has (unchanged since the last push, or the same file under a renamed task) is never sent again:
// the daemon asks which blobs are missing, uploads those, then pushes the snapshot, which hard-links
// (or copies) each blob into place. A blob that no space's last snapshot refers to any more is
// removed once it is an hour old (never sooner, so a blob uploaded for a snapshot still on its way
// stays).
//
// Files are written into data/.sync-tmp/ first and swapped in, so a space is never half written.
// data/.sync-state.json remembers the hashes GET answers with, and the blobs each space refers to.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseConfig, upgradeRaw } = require('./config');

const ORIGINS_DIR = 'origins';
const NO_ORIGIN_DIR = '_';
const WORK_TASKS_DIR = 'tasks';
const REPOSITORIES_DIR = 'repositories';
const TMP_DIR = '.sync-tmp';
const BLOBS_DIR = '.sync-blobs';
const STATE_FILE = '.sync-state.json';
const BODY_LIMIT = '50mb';           // a snapshot: task texts and the hashes of the other files
const BLOB_LIMIT = '1gb';            // one attachment
const BLOB_KEEP_MS = 60 * 60 * 1000; // how long an unreferenced blob is kept before it is removed
const BLOB_RE = /^[0-9a-f]{40}$/;

class SyncError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra || {}); }
}

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// The key of a space in the state: names never contain "/" (see server/config.js), so the three
// parts can always be told apart. "" for no origin / the work's common tasks.
function spaceKey({ origin, work, repository }) {
  return [origin || '', work, repository || ''].join('/');
}

// A folder name of the mirror: an origin, work or repository name as it is, refused when it is not
// a plain name. (Whether the names stay inside data/origins/ is checked on the whole path, below.)
function segment(name, what) {
  if (typeof name !== 'string' || !name.trim()) throw new SyncError(400, `Missing ${what}.`);
  const s = name.trim();
  if (s === '.' || s === '..' || /[/\0]/.test(s)) throw new SyncError(400, `Invalid ${what} "${name}".`);
  return s;
}

// Does `abs` lie inside the folder `dir`?
const inside = (dir, abs) => abs.startsWith(dir + path.sep);

// Is the folder `abs` one of the copies kept here for taskmgrd, under data/origins/?
const isMirrored = (dataDir, abs) => !!abs && inside(path.join(dataDir, ORIGINS_DIR), path.resolve(abs));

// Where a space is kept: a work's common tasks, or one of its repositories. Always under
// data/origins/, whatever the names are (a "\" is a separator on Windows).
function spaceDir(dataDir, { origin, work, repository }) {
  const parts = [segment(origin || NO_ORIGIN_DIR, 'origin'), segment(work, 'work')];
  if (repository) parts.push(REPOSITORIES_DIR, segment(repository, 'repository'));
  else parts.push(WORK_TASKS_DIR);
  const originsDir = path.join(dataDir, ORIGINS_DIR);
  const target = path.resolve(originsDir, ...parts);
  if (!inside(originsDir, target)) throw new SyncError(400, 'The names must stay inside the data folder.');
  return target;
}

// One snapshot entry checked: a relative path of plain names, and content, blob or dir: true.
function checkEntry(e, i) {
  if (!e || typeof e !== 'object' || typeof e.path !== 'string' || !e.path) throw new SyncError(400, `entries[${i}]: missing path.`);
  const parts = e.path.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.includes('\0'))) throw new SyncError(400, `entries[${i}]: invalid path "${e.path}".`);
  if (e.dir === true) return { rel: path.join(...parts), dir: true };
  if (typeof e.blob === 'string') {
    if (!BLOB_RE.test(e.blob)) throw new SyncError(400, `entries[${i}]: invalid blob "${e.blob}".`);
    return { rel: path.join(...parts), blob: e.blob };
  }
  if (typeof e.content !== 'string') throw new SyncError(400, `entries[${i}]: missing content.`);
  return { rel: path.join(...parts), content: e.content };
}

const blobPath = (dataDir, sha) => path.join(dataDir, BLOBS_DIR, sha);

// A blob put in place: a hard link to the store when the file system allows, a copy otherwise.
function placeBlob(from, to) {
  try {
    fs.linkSync(from, to);
  } catch (e) {
    fs.copyFileSync(from, to);
  }
}

// Replace `target` with the entries: they are written in a fresh folder under data/.sync-tmp/, which
// then takes the target's place. Nothing is written when a blob is not in the store (409).
function writeSnapshot(dataDir, target, entries) {
  const tmpRoot = path.join(dataDir, TMP_DIR);
  const id = crypto.randomBytes(6).toString('hex');
  const tmp = path.join(tmpRoot, id);
  const old = path.join(tmpRoot, `${id}.old`);
  // Every path resolved and checked to stay inside, before anything is written.
  const list = entries.map(e => {
    const abs = path.resolve(tmp, e.rel);
    if (!inside(tmp, abs)) throw new SyncError(400, `Path "${e.rel}" leaves the folder.`);
    return { ...e, abs };
  });
  const missing = [...new Set(list.filter(e => e.blob && !fs.existsSync(blobPath(dataDir, e.blob))).map(e => e.blob))];
  if (missing.length) throw new SyncError(409, `${missing.length} file${missing.length === 1 ? ' is' : 's are'} not on the server yet.`, { code: 'MISSING_BLOBS', missing });
  let files = 0;
  let dirs = 0;
  try {
    fs.mkdirSync(tmp, { recursive: true });
    for (const e of list) {
      const abs = e.abs;
      if (e.dir) {
        fs.mkdirSync(abs, { recursive: true });
        dirs++;
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (e.blob) placeBlob(blobPath(dataDir, e.blob), abs);
        else fs.writeFileSync(abs, e.content, 'utf8');
        files++;
      }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const had = fs.existsSync(target);
    if (had) fs.renameSync(target, old);
    try {
      fs.renameSync(tmp, target);
    } catch (e) {
      if (had) fs.renameSync(old, target);  // the previous copy goes back
      throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { files, dirs };
}

// Remove, under data/origins/, what the pushed config does not have any more: an origin, a work, the
// tasks folder of a work that has none now, a repository. Returns what was removed (relative to data/).
function pruneOrigins(dataDir, works) {
  const expected = new Map();  // origin folder -> work -> { tasks, repositories }
  for (const w of works) {
    const o = w.origin || NO_ORIGIN_DIR;
    if (!expected.has(o)) expected.set(o, new Map());
    expected.get(o).set(w.work, { tasks: !!w.root, repositories: new Set(w.repositories.map(p => p.name)) });
  }
  const subdirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
      return [];
    }
  };
  const pruned = [];
  const remove = (abs) => {
    fs.rmSync(abs, { recursive: true, force: true });
    pruned.push(path.relative(dataDir, abs).split(path.sep).join('/'));
  };
  const originsDir = path.join(dataDir, ORIGINS_DIR);
  for (const o of subdirs(originsDir)) {
    const worksOf = expected.get(o);
    if (!worksOf) { remove(path.join(originsDir, o)); continue; }
    for (const w of subdirs(path.join(originsDir, o))) {
      const spec = worksOf.get(w);
      const workDir = path.join(originsDir, o, w);
      if (!spec) { remove(workDir); continue; }
      if (!spec.tasks && fs.existsSync(path.join(workDir, WORK_TASKS_DIR))) remove(path.join(workDir, WORK_TASKS_DIR));
      for (const r of subdirs(path.join(workDir, REPOSITORIES_DIR))) {
        if (!spec.repositories.has(r)) remove(path.join(workDir, REPOSITORIES_DIR, r));
      }
    }
  }
  return pruned;
}

// The pushed config (raw, "origins" form) with its folders turned into the copies here: a work with
// common tasks gets the folder of its copy as tasks_path, and so does every repository, whose
// source_path (a folder on the other machine) is left out.
function toMirror(dataDir, pushed) {
  const name = (v, key) => (v && typeof v[key] === 'string' ? v[key].trim() : '');
  for (const g of pushed.origins) {
    const origin = name(g, 'origin');
    for (const w of g.works || []) {
      const work = name(w, 'work');
      if (name(w, 'tasks_path')) w.tasks_path = spaceDir(dataDir, { origin, work, repository: '' });
      else delete w.tasks_path;
      for (const p of w.repositories || []) {
        delete p.source_path;
        p.tasks_path = spaceDir(dataDir, { origin, work, repository: name(p, 'repository') });
      }
    }
  }
  return pushed;
}

// The pushed config merged into the one here, both raw and in the "origins" form: an origin, work
// or repository that is only here is kept, one that is only pushed is added. A work in both (by
// name, in the same origin) takes the pushed fields, with its repositories merged the same way (a
// repository in both is the pushed one). A work pushed under another origin than here moves there,
// as work names are unique across origins. Returns the merged raw config.
function mergeConfigs(here, pushed) {
  const name = (v, key) => (v && typeof v[key] === 'string' ? v[key].trim() : '');
  const merged = { ...here, ...pushed, origins: (here.origins || []).map(g => ({ ...g, works: [...(g.works || [])] })) };
  for (const g of pushed.origins) {
    const origin = name(g, 'origin');
    let target = merged.origins.find(o => name(o, 'origin') === origin);
    if (!target) {
      target = { ...g, works: [] };
      merged.origins.push(target);
    } else if (g.income !== undefined) {
      target.income = g.income;
    }
    for (const w of g.works || []) {
      const work = name(w, 'work');
      for (const o of merged.origins) {
        if (o !== target) o.works = o.works.filter(x => name(x, 'work') !== work);
      }
      const i = target.works.findIndex(x => name(x, 'work') === work);
      if (i < 0) { target.works.push(w); continue; }
      const repositories = [...(target.works[i].repositories || [])];
      for (const p of w.repositories || []) {
        const j = repositories.findIndex(x => name(x, 'repository') === name(p, 'repository'));
        if (j < 0) repositories.push(p);
        else repositories[j] = p;
      }
      target.works[i] = { ...target.works[i], ...w, repositories };
    }
  }
  return merged;
}

// Constant-time comparison, as for passwords (see server/auth.js).
function tokensMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Mounts the sync routes. Mount it before the login guard: a push is authorized by the token, not a
// session. `token` is TASKMGRD_TOKEN; with none, every push is refused. `readConfig` and
// `writeConfig` read and replace this server's taskmgr.json (see server/config.js).
function createSyncApp({ dataDir, token, readConfig, writeConfig }) {
  const app = express();
  const enabled = typeof token === 'string' && token.trim() !== '';
  const statePath = path.join(dataDir, STATE_FILE);

  // Whatever a crash left half written: the snapshot folders, and the uploads not yet renamed.
  fs.rmSync(path.join(dataDir, TMP_DIR), { recursive: true, force: true });
  try {
    for (const name of fs.readdirSync(path.join(dataDir, BLOBS_DIR))) {
      if (!BLOB_RE.test(name)) fs.rmSync(path.join(dataDir, BLOBS_DIR, name), { force: true });
    }
  } catch (e) { /* no store yet */ }

  function readState() {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return {
        config: typeof s.config === 'string' ? s.config : null,
        spaces: s.spaces && typeof s.spaces === 'object' ? s.spaces : {},
        blobs: s.blobs && typeof s.blobs === 'object' ? s.blobs : {}  // space key -> the blobs of its snapshot
      };
    } catch (e) {
      return { config: null, spaces: {}, blobs: {} };
    }
  }

  // Remove the blobs no space refers to any more, once they are old enough (see BLOB_KEEP_MS).
  function pruneBlobs(state) {
    const used = new Set(Object.values(state.blobs).flat());
    const dir = path.join(dataDir, BLOBS_DIR);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    const now = Date.now();
    for (const name of names) {
      if (!BLOB_RE.test(name) || used.has(name)) continue;  // an upload on its way is left alone
      const abs = path.join(dir, name);
      try {
        if (now - fs.statSync(abs).mtimeMs > BLOB_KEEP_MS) fs.rmSync(abs, { force: true });
      } catch (e) { /* gone meanwhile */ }
    }
  }

  function writeState(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  }

  app.use('/api/sync', (req, res, next) => {
    if (!enabled) return res.status(503).json({ error: 'Sync is off on this server: set TASKMGRD_TOKEN in its .env.', code: 'SYNC_OFF' });
    const m = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || ''));
    if (!m || !tokensMatch(m[1].trim(), token.trim())) return res.status(401).json({ error: 'Wrong sync token.', code: 'INVALID_TOKEN' });
    next();
  });

  const json = express.json({ limit: BODY_LIMIT });

  // What is here, so the daemon can push only what differs. A space whose folder is gone is left out.
  app.get('/api/sync', (req, res) => {
    const state = readState();
    const spaces = {};
    for (const [key, hash] of Object.entries(state.spaces)) {
      const [origin, work, repository] = key.split('/');
      try {
        if (fs.existsSync(spaceDir(dataDir, { origin, work, repository }))) spaces[key] = hash;
      } catch (e) { /* a key that is not a space: left out */ }
    }
    res.json({ ok: true, config: state.config, spaces });
  });

  app.put('/api/sync/config', json, (req, res) => {
    const text = (req.body || {}).text;
    if (typeof text !== 'string') throw new SyncError(400, 'Missing text.');
    try {
      parseConfig(text, 'the pushed taskmgr.json');
    } catch (e) {
      throw new SyncError(400, e.message);
    }
    const pushed = toMirror(dataDir, upgradeRaw(JSON.parse(text)));
    const mergedText = JSON.stringify(mergeConfigs(upgradeRaw(JSON.parse(readConfig())), pushed), null, 2) + '\n';
    let parsed;
    try {
      parsed = parseConfig(mergedText, 'taskmgr.json');
      writeConfig(mergedText);
    } catch (e) {
      throw new SyncError(409, `Cannot merge with the taskmgr.json here: ${e.message}`);
    }
    const pruned = pruneOrigins(dataDir, parsed.works);
    const state = readState();
    state.config = sha1(text);
    const keys = new Set();
    for (const w of parsed.works) {
      if (w.root) keys.add(spaceKey({ origin: w.origin, work: w.work, repository: '' }));
      for (const p of w.repositories) keys.add(spaceKey({ origin: w.origin, work: w.work, repository: p.name }));
    }
    for (const k of Object.keys(state.spaces)) if (!keys.has(k)) { delete state.spaces[k]; delete state.blobs[k]; }
    writeState(state);
    pruneBlobs(state);
    res.json({ ok: true, pruned });
  });

  // Which of these blobs are not here yet.
  app.post('/api/sync/blobs', json, (req, res) => {
    const { blobs } = req.body || {};
    if (!Array.isArray(blobs) || blobs.some(b => typeof b !== 'string' || !BLOB_RE.test(b))) throw new SyncError(400, '"blobs" must be an array of sha1 hashes.');
    const missing = [...new Set(blobs)].filter(b => !fs.existsSync(blobPath(dataDir, b)));
    res.json({ ok: true, missing });
  });

  // One file into the blob store, named by the sha1 of its content.
  app.put('/api/sync/blob/:sha', express.raw({ type: () => true, limit: BLOB_LIMIT }), (req, res) => {
    const sha = String(req.params.sha || '');
    if (!BLOB_RE.test(sha)) throw new SyncError(400, `Invalid blob "${sha}".`);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (crypto.createHash('sha1').update(body).digest('hex') !== sha) throw new SyncError(400, 'The content does not hash to the given sha1.');
    const dir = path.join(dataDir, BLOBS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${sha}.${crypto.randomBytes(4).toString('hex')}`);
    try {
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, blobPath(dataDir, sha));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    res.json({ ok: true });
  });

  app.put('/api/sync/space', json, (req, res) => {
    const { origin = '', work, repository = '', entries } = req.body || {};
    if (typeof origin !== 'string' || typeof repository !== 'string') throw new SyncError(400, 'origin and repository must be strings.');
    const target = spaceDir(dataDir, { origin, work, repository });
    if (!Array.isArray(entries)) throw new SyncError(400, '"entries" must be an array.');
    const list = entries.map(checkEntry);
    const { files, dirs } = writeSnapshot(dataDir, target, list);
    const state = readState();
    const key = spaceKey({ origin: origin.trim(), work: work.trim(), repository: repository.trim() });
    state.spaces[key] = sha1(JSON.stringify(entries));
    state.blobs[key] = [...new Set(list.filter(e => e.blob).map(e => e.blob))];
    writeState(state);
    pruneBlobs(state);
    res.json({ ok: true, files, dirs });
  });

  // A refused request answers with its code (and, for MISSING_BLOBS, the blobs to upload).
  app.use('/api/sync', (err, req, res, next) => {
    if (!(err instanceof SyncError)) return next(err);
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.missing ? { missing: err.missing } : {}) });
  });

  return app;
}

module.exports = { createSyncApp, isMirrored, spaceKey, sha1 };
