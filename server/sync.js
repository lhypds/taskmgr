// Receiving end of taskmgrd (taskmgrd.js): the daemon on the machine that has the tasks pushes its
// taskmgr.json and the task files of every work and repository here, and they are kept under data/,
// laid out like the origins tree of taskmgr.json:
//
//   data/
//     taskmgr.json                    the pushed configs, merged
//     origins/
//       <origin>/                     "_" for the works without an origin
//         <work>/
//           tasks/                    the work's common tasks (its tasks_path), the task folders as they are
//             202508142100 Buy apple/task.txt
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
//       merges the config into data/taskmgr.json (an invalid one is refused; see mergeConfigs) and
//       removes, under data/origins/, the origins, works and repositories that are not in it.
//   PUT /api/sync/space   { origin, work, repository, entries }  -> { ok, files, dirs }
//       replaces one space's folder with the snapshot: entries are [{ path, content }] for task files
//       and [{ path, dir: true }] for a task folder without one, paths relative to the space's folder.
//
// Files are written into data/.sync-tmp/ first and swapped in, so a space is never half written.
// data/.sync-state.json remembers the hashes GET answers with.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseConfig, upgradeRaw } = require('./config');

const CONFIG_FILE = 'taskmgr.json';
const ORIGINS_DIR = 'origins';
const NO_ORIGIN_DIR = '_';
const WORK_TASKS_DIR = 'tasks';
const REPOSITORIES_DIR = 'repositories';
const TMP_DIR = '.sync-tmp';
const STATE_FILE = '.sync-state.json';
const BODY_LIMIT = '50mb';

class SyncError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

// One snapshot entry checked: a relative path of plain names, and content or dir: true.
function checkEntry(e, i) {
  if (!e || typeof e !== 'object' || typeof e.path !== 'string' || !e.path) throw new SyncError(400, `entries[${i}]: missing path.`);
  const parts = e.path.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.includes('\0'))) throw new SyncError(400, `entries[${i}]: invalid path "${e.path}".`);
  if (e.dir === true) return { rel: path.join(...parts), dir: true };
  if (typeof e.content !== 'string') throw new SyncError(400, `entries[${i}]: missing content.`);
  return { rel: path.join(...parts), content: e.content };
}

// Replace `target` with the entries: they are written in a fresh folder under data/.sync-tmp/, which
// then takes the target's place.
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
        fs.writeFileSync(abs, e.content, 'utf8');
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

// The taskmgr.json here, raw and in the "origins" form; null when there is none or it is invalid
// (a push then takes its place).
function readConfigHere(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    parseConfig(text, CONFIG_FILE);
    return upgradeRaw(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

// Constant-time comparison, as for passwords (see server/auth.js).
function tokensMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Mounts the sync routes. Mount it before the login guard: a push is authorized by the token, not a
// session. `token` is TASKMGRD_TOKEN; with none, every push is refused.
function createSyncApp({ dataDir, token }) {
  const app = express();
  const enabled = typeof token === 'string' && token.trim() !== '';
  const statePath = path.join(dataDir, STATE_FILE);

  // Whatever a crash left half written.
  fs.rmSync(path.join(dataDir, TMP_DIR), { recursive: true, force: true });

  function readState() {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return { config: typeof s.config === 'string' ? s.config : null, spaces: s.spaces && typeof s.spaces === 'object' ? s.spaces : {} };
    } catch (e) {
      return { config: null, spaces: {} };
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
    const configHere = fs.existsSync(path.join(dataDir, CONFIG_FILE));
    res.json({ ok: true, config: configHere ? state.config : null, spaces });
  });

  app.put('/api/sync/config', json, (req, res) => {
    const text = (req.body || {}).text;
    if (typeof text !== 'string') throw new SyncError(400, 'Missing text.');
    try {
      parseConfig(text, CONFIG_FILE);
    } catch (e) {
      throw new SyncError(400, e.message);
    }
    const file = path.join(dataDir, CONFIG_FILE);
    const here = readConfigHere(file);
    const pushed = upgradeRaw(JSON.parse(text));
    const mergedText = JSON.stringify(here ? mergeConfigs(here, pushed) : pushed, null, 2) + '\n';
    let parsed;
    try {
      parsed = parseConfig(mergedText, CONFIG_FILE);
    } catch (e) {
      throw new SyncError(409, `Cannot merge with the taskmgr.json here: ${e.message}`);
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, mergedText);
    const pruned = pruneOrigins(dataDir, parsed.works);
    const state = readState();
    state.config = sha1(text);
    const keys = new Set();
    for (const w of parsed.works) {
      if (w.root) keys.add(spaceKey({ origin: w.origin, work: w.work, repository: '' }));
      for (const p of w.repositories) keys.add(spaceKey({ origin: w.origin, work: w.work, repository: p.name }));
    }
    for (const k of Object.keys(state.spaces)) if (!keys.has(k)) delete state.spaces[k];
    writeState(state);
    res.json({ ok: true, pruned });
  });

  app.put('/api/sync/space', json, (req, res) => {
    const { origin = '', work, repository = '', entries } = req.body || {};
    if (typeof origin !== 'string' || typeof repository !== 'string') throw new SyncError(400, 'origin and repository must be strings.');
    const target = spaceDir(dataDir, { origin, work, repository });
    if (!Array.isArray(entries)) throw new SyncError(400, '"entries" must be an array.');
    const list = entries.map(checkEntry);
    const { files, dirs } = writeSnapshot(dataDir, target, list);
    const state = readState();
    state.spaces[spaceKey({ origin: origin.trim(), work: work.trim(), repository: repository.trim() })] = sha1(JSON.stringify(entries));
    writeState(state);
    res.json({ ok: true, files, dirs });
  });

  return app;
}

module.exports = { createSyncApp, spaceKey, sha1 };
