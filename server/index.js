#!/usr/bin/env node
// taskmgr web UI server: an Express app exposing the task folders as a JSON API
// and serving the React frontend (Vite in dev, the prebuilt dist/ in production).
//
//   node server/index.js
//
// The works and repositories (each a folder of tasks) come from taskmgr.json, see server/config.js.
const fs = require('fs');
const path = require('path');
const express = require('express');

const {
  TASK_FILE,
  STATUS_DIRS,
  listDirOf,
  isTaskFolder,
  readTaskDir,
  ensureTaskFile,
  createTask,
  saveTask,
  markTask,
  normalizeTaskFile,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  openFolder,
  readTasks,
  hasSubtask,
  compareIdsDesc
} = require('../utils/taskUtils');
const { getEditor } = require('../utils/editorUtils');
const { resolveConfig } = require('./config');
const { createAuthApp } = require('./auth');
const { createSyncApp, isMirrored } = require('./sync');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
// Dev (Vite middleware, hot reload) when NODE_ENV=development, or when nothing is built yet;
// otherwise the prebuilt dist/ is served, so `taskmgr-web` works without any env set.
const DEV = process.env.NODE_ENV === 'development'
  || (process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(DIST_DIR, 'index.html')));

let config;
try {
  config = resolveConfig();
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A space is one folder of tasks: the common tasks of a work, or one of its repositories.
// Looked up from the query string / body of every task request as ?work=&repository=.
function findSpace(work, repository) {
  const w = config.getWorks().find(x => x.work === work);
  if (!w) return null;
  if (!repository) return { work: w.work, repository: '', root: w.root };
  const p = w.repositories.find(x => x.name === repository);
  if (!p) return null;
  return { work: w.work, repository: p.name, root: p.root };
}

function spaceFrom(params) {
  const work = String(params.work || '');
  const repository = String(params.repository || '');
  if (!work) throw new HttpError(400, 'Missing work.');
  const space = findSpace(work, repository);
  if (!space) throw new HttpError(404, repository ? `Unknown repository "${repository}" in "${work}".` : `Unknown work "${work}".`);
  if (!space.root) throw new HttpError(404, `"${work}" has no tasks folder of its own.`);
  if (!fs.existsSync(space.root) || !fs.statSync(space.root).isDirectory()) {
    throw new HttpError(404, `Folder not found: ${space.root}`);
  }
  return space;
}

// Resolve a path relative to a space's root and make sure it stays inside it.
function resolveInsideRoot(root, rel) {
  const abs = path.resolve(root, rel || '');
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new HttpError(400, 'Path is outside the tasks root.');
  }
  return abs;
}

function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function resolveDir(root, rel) {
  const abs = resolveInsideRoot(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new HttpError(404, 'Directory not found.');
  }
  return abs;
}

function resolveTaskDir(root, rel) {
  if (!rel) throw new HttpError(400, 'Missing task path.');
  const abs = resolveDir(root, rel);
  if (!isTaskFolder(abs)) {
    throw new HttpError(404, 'Task not found.');
  }
  return abs;
}

// A task folder without a task file still reads as a task (see readTaskDir).
const taskFromDir = readTaskDir;

function firstDetailLine(details) {
  return (details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || '';
}

// Same ordering as the CLI: todo first, then done, then pending; newest id first within a group.
function statusOrder(s) {
  const st = (s || '').toLowerCase();
  if (st === 'done') return 1;
  if (st === 'pending') return 2;
  return 0;
}

function sortTasks(tasks) {
  tasks.sort((a, b) => {
    const sa = statusOrder(a.status);
    const sb = statusOrder(b.status);
    if (sa !== sb) return sa - sb;
    return compareIdsDesc(a, b);
  });
  return tasks;
}

function normalizeStatus(s) {
  const st = String(s || '').toLowerCase();
  return st === 'done' ? 'done' : (st === 'pending' ? 'pending' : 'todo');
}

function serializeTask(root, t) {
  const taskDir = path.dirname(t.path);
  let sub = false;
  try { sub = hasSubtask(taskDir); } catch (e) { sub = false; }
  return {
    id: t.id,
    rel: toRel(root, taskDir),
    folder: path.basename(taskDir),
    status: normalizeStatus(t.status),
    title: firstDetailLine(t.details),
    details: t.details || '',
    hasSubtask: sub
  };
}

// Breadcrumb from the space's root down to `abs`: every task folder on the way (the "done" and
// "pending" folders between them are skipped).
function crumbsFor(root, abs) {
  const crumbs = [];
  let cur = abs;
  while (cur !== root) {
    let title = path.basename(cur);
    if (isTaskFolder(cur)) {
      try { title = firstDetailLine(readTaskDir(cur).details) || title; } catch (e) { /* keep folder name */ }
    }
    crumbs.unshift({ rel: toRel(root, cur), title });
    cur = isTaskFolder(cur) ? listDirOf(cur) : path.dirname(cur);
  }
  return crumbs;
}

function countTasks(tasks) {
  const counts = { todo: 0, done: 0, pending: 0 };
  for (const t of tasks) counts[normalizeStatus(t.status)]++;
  return counts;
}

function listDir(space, rel) {
  const root = space.root;
  const abs = resolveDir(root, rel);
  const tasks = sortTasks(readTasks(abs)).map(t => serializeTask(root, t));
  const isRoot = abs === root;
  const parent = isRoot ? null : toRel(root, isTaskFolder(abs) ? listDirOf(abs) : path.dirname(abs));
  return {
    work: space.work,
    repository: space.repository,
    dir: toRel(root, abs),
    absDir: abs,
    remote: isMirrored(config.dataDir, root),
    isRoot,
    parent,
    crumbs: crumbsFor(root, abs),
    tasks,
    counts: countTasks(tasks)
  };
}

// The top-level tasks of several spaces in one list, each task saying which space it lives in
// (its rel is relative to that space's root). Spaces whose folder is missing (or that have none)
// are skipped.
function listSpacesTasks(spaces, absDir) {
  const tasks = [];
  for (const s of spaces) {
    if (!fs.existsSync(s.root) || !fs.statSync(s.root).isDirectory()) continue;
    for (const t of readTasks(s.root)) tasks.push({ ...serializeTask(s.root, t), work: s.work, repository: s.repository });
  }
  sortTasks(tasks);
  return { dir: '', absDir, remote: isMirrored(config.dataDir, absDir), isRoot: true, parent: null, crumbs: [], tasks, counts: countTasks(tasks) };
}

// A work's common tasks and those of all its repositories.
function workSpaces(w) {
  return [
    { work: w.work, repository: '', root: w.root },
    ...w.repositories.map(p => ({ work: w.work, repository: p.name, root: p.root }))
  ];
}

// The works/repositories list with, for each folder, whether it exists and whether it is a copy
// pushed by taskmgrd (remote). A work without a tasks folder of its own (root "") is not missing one.
function listSpaces() {
  const describe = (root) => ({
    root,
    exists: !root || (fs.existsSync(root) && fs.statSync(root).isDirectory()),
    remote: isMirrored(config.dataDir, root)
  });
  return config.getWorks().map(w => ({
    work: w.work,
    origin: w.origin,
    income: w.income,
    hidden: w.hidden,
    shownPath: w.shownPath,
    ...describe(w.root),
    repositories: w.repositories.map(p => ({ name: p.name, sourcePath: p.sourcePath, shownPath: p.shownPath, paths: p.paths, ...describe(p.root) }))
  }));
}

// What every change to taskmgr.json answers with: the works and the named origins ({ origin,
// income }, an origin possibly without works yet).
function spacesBody() {
  return { works: listSpaces(), origins: config.getOrigins() };
}

function listFiles(root, taskDirAbs) {
  const entries = fs.readdirSync(taskDirAbs, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name === TASK_FILE) continue;
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory() && STATUS_DIRS.includes(e.name)) continue;  // holds done / pending subtasks
    const abs = path.join(taskDirAbs, e.name);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (err) { /* ignore */ }
    files.push({
      name: e.name,
      rel: toRel(root, abs),
      isDir: e.isDirectory(),
      isSubtask: e.isDirectory() && isTaskFolder(abs),
      size
    });
  }
  files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return files;
}

// Write a task's details (and status, which moves its folder) and rename its folder after the title.
function writeTaskFields(taskDirAbs, fields) {
  const task = taskFromDir(taskDirAbs);
  if (fields.details !== undefined) task.details = String(fields.details).replace(/\r\n/g, '\n');
  saveTask(task);
  task.path = renameTaskByFirstLine(task.path);
  if (fields.status !== undefined) markTask(task, normalizeStatus(fields.status));
  return path.dirname(task.path);
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Pushes from taskmgrd on another machine (see server/sync.js): authorized by a shared token, not a
// login, and larger than the UI's requests, so mounted before the body limit and the login guard.
const syncToken = process.env.TASKMGRD_TOKEN;
app.use(createSyncApp({ dataDir: config.dataDir, token: syncToken, readConfig: config.readText, writeConfig: config.writeText }));

app.use(express.json({ limit: '10mb' }));

// Login first: everything under /api below needs a session (see server/auth.js).
app.use(createAuthApp({ usersPath: config.usersPath }));

app.get('/api/settings', (req, res) => {
  res.json({ configPath: config.configPath, editor: getEditor() });
});

// The raw taskmgr.json, to edit the works and repositories from the web UI.
app.get('/api/config', (req, res) => {
  res.json({ configPath: config.configPath, text: config.readText() });
});

app.put('/api/config', (req, res) => {
  const text = (req.body || {}).text;
  if (typeof text !== 'string') throw new HttpError(400, 'Missing text.');
  try {
    config.writeText(text);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Add a work to taskmgr.json.
app.post('/api/work', (req, res) => {
  const { name, origin = '', tasksPath = '', income = null } = req.body || {};
  if (typeof name !== 'string' || typeof origin !== 'string' || typeof tasksPath !== 'string') throw new HttpError(400, 'Missing name.');
  try {
    config.addWork({ name, origin, tasksPath, income });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.status(201).json(spacesBody());
});

// Set the name, income (null clears it) and, when given, the tasks folder and whether it is hidden,
// of one work in taskmgr.json.
app.put('/api/work', (req, res) => {
  const { work, name, income, hidden, tasksPath } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string' || income === undefined) throw new HttpError(400, 'Missing work, name or income.');
  if (hidden !== undefined && typeof hidden !== 'boolean') throw new HttpError(400, '"hidden" must be true or false.');
  if (tasksPath !== undefined && typeof tasksPath !== 'string') throw new HttpError(400, '"tasksPath" must be a string.');
  try {
    config.updateWork(work, { name, income, hidden, tasksPath });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Set the name and income (null clears it) of one origin in taskmgr.json.
app.put('/api/origin', (req, res) => {
  const { origin, name, income } = req.body || {};
  if (typeof origin !== 'string' || typeof name !== 'string' || income === undefined) throw new HttpError(400, 'Missing origin, name or income.');
  try {
    config.updateOrigin(origin, { name, income });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Set the name, source folder and tasks folder of one repository of a work in taskmgr.json.
app.put('/api/repository', (req, res) => {
  const { work, name, newName, tasksPath = '', sourcePath = '' } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string' || typeof newName !== 'string' || typeof tasksPath !== 'string' || typeof sourcePath !== 'string') {
    throw new HttpError(400, 'Missing work, name or newName.');
  }
  try {
    config.updateRepository(work, name, { name: newName, tasksPath, sourcePath });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Remove one origin, with its works, from taskmgr.json; their folders are kept.
app.delete('/api/origin', (req, res) => {
  const origin = String(req.query.origin || '');
  try {
    config.removeOrigin(origin);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Remove one work from taskmgr.json; its folders are kept.
app.delete('/api/work', (req, res) => {
  const work = String(req.query.work || '');
  try {
    config.removeWork(work);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Remove one repository of a work from taskmgr.json; its folders are kept.
app.delete('/api/repository', (req, res) => {
  const work = String(req.query.work || '');
  const name = String(req.query.name || '');
  try {
    config.removeRepository(work, name);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Add an origin (with no works yet) to taskmgr.json.
app.post('/api/origin', (req, res) => {
  const { name, income = null } = req.body || {};
  if (typeof name !== 'string') throw new HttpError(400, 'Missing name.');
  try {
    config.addOrigin({ name, income });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.status(201).json(spacesBody());
});

// Add a repository to a work in taskmgr.json.
app.post('/api/repository', (req, res) => {
  const { work, name, tasksPath = '', sourcePath = '' } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string' || typeof tasksPath !== 'string' || typeof sourcePath !== 'string') {
    throw new HttpError(400, 'Missing work or name.');
  }
  try {
    config.addRepository({ work, name, tasksPath, sourcePath });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.status(201).json(spacesBody());
});

// Open the folder a tree row shows with the OS file manager: a work's tasks folder, or a
// repository's source code folder (its tasks folder when it has none).
app.post('/api/space/open', (req, res) => {
  const work = String(req.body?.work || '');
  const repository = String(req.body?.repository || '');
  const w = config.getWorks().find(x => x.work === work);
  const p = repository ? w?.repositories.find(x => x.name === repository) : null;
  if (!w || (repository && !p)) throw new HttpError(404, repository ? `Unknown repository "${repository}" in "${work}".` : `Unknown work "${work}".`);
  const dir = p ? p.sourcePath || p.root : w.root;
  if (!dir) throw new HttpError(404, `"${work}" has no tasks folder of its own.`);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, `Folder not found: ${dir}`);
  openFolder(dir);
  res.json({ ok: true });
});

// Create the missing tasks folder of a work or a repository.
app.post('/api/space/create', (req, res) => {
  const space = findSpace(String(req.body?.work || ''), String(req.body?.repository || ''));
  if (!space) throw new HttpError(404, 'Unknown work or repository.');
  if (!space.root) throw new HttpError(400, `"${space.work}" has no tasks folder of its own.`);
  fs.mkdirSync(space.root, { recursive: true });
  res.status(201).json(spacesBody());
});

app.get('/api/spaces', (req, res) => {
  res.json(spacesBody());
});

app.get('/api/tasks', (req, res) => {
  res.json(listDir(spaceFrom(req.query), String(req.query.dir || '')));
});

// Every task of every work (?all=1), of an origin (?origin=: all its works and their
// repositories) or of one work (?work=: its common tasks and its repositories'), in one list.
app.get('/api/tasks/all', (req, res) => {
  const origin = String(req.query.origin || '');
  const work = String(req.query.work || '');
  if (req.query.all) return res.json(listSpacesTasks(config.getWorks().flatMap(workSpaces), ''));
  if (origin) {
    if (!config.getOrigins().some(o => o.origin === origin)) throw new HttpError(404, `Unknown origin "${origin}".`);
    const works = config.getWorks().filter(w => w.origin === origin);
    return res.json(listSpacesTasks(works.flatMap(workSpaces), ''));
  }
  const w = config.getWorks().find(x => x.work === work);
  if (!w) throw new HttpError(404, `Unknown work "${work}".`);
  res.json(listSpacesTasks(workSpaces(w), w.root));
});

// Create a task in `dir` with the given fields. Ids are the creation minute; a second
// task in the same minute gets the next free minute as its id (see createTask).
app.post('/api/tasks', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const dirAbs = resolveDir(root, body.dir || '');
  const taskPath = createTask(dirAbs);
  const taskDir = writeTaskFields(path.dirname(taskPath), body);
  res.status(201).json({ task: serializeTask(root, taskFromDir(taskDir)) });
});

app.get('/api/task', (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  res.json({ task: serializeTask(root, taskFromDir(taskDir)), files: listFiles(root, taskDir) });
});

app.put('/api/task', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = writeTaskFields(resolveTaskDir(root, body.rel), body);
  res.json({ task: serializeTask(root, taskFromDir(taskDir)) });
});

app.post('/api/task/status', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  const status = String(body.status || '').toLowerCase();
  if (!['todo', 'done', 'pending'].includes(status)) throw new HttpError(400, 'Invalid status.');
  const task = taskFromDir(taskDir);
  markTask(task, status);
  res.json({ task: serializeTask(root, taskFromDir(path.dirname(task.path))) });
});

// The task file as text, for the web editor (the terminal opens the same file in $EDITOR).
app.get('/api/task/text', (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  const taskPath = ensureTaskFile(path.join(taskDir, TASK_FILE));
  res.json({ text: fs.readFileSync(taskPath, 'utf8') });
});

// Write the task file as typed, then do what the terminal does after the editor closes:
// tidy the file and rename the folder after the first line of the details.
function writeTaskText(root, taskDir, text) {
  const taskPath = path.join(taskDir, TASK_FILE);
  fs.writeFileSync(taskPath, String(text || '').replace(/\r\n/g, '\n'), 'utf8');
  normalizeTaskFile(taskPath);
  const newPath = renameTaskByFirstLine(taskPath);
  return serializeTask(root, taskFromDir(path.dirname(newPath)));
}

app.put('/api/task/text', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  res.json({ task: writeTaskText(root, taskDir, body.text) });
});

// Create a task in `dir` from the typed task file text.
app.post('/api/tasks/text', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const dirAbs = resolveDir(root, body.dir || '');
  const taskDir = path.dirname(createTask(dirAbs));
  res.status(201).json({ task: writeTaskText(root, taskDir, body.text) });
});

// Open the task folder with the OS file manager (only meaningful when the browser runs on the same machine).
app.post('/api/task/open', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  openTask(taskFromDir(taskDir));
  res.json({ ok: true });
});

app.delete('/api/task', (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  deleteTask(taskFromDir(taskDir));
  res.json({ ok: true });
});

// Serve an attachment that lives inside a task folder.
app.get('/api/file', (req, res) => {
  const { root } = spaceFrom(req.query);
  const abs = resolveInsideRoot(root, String(req.query.rel || ''));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'File not found.');
  res.set('Cache-Control', 'no-store');
  if (req.query.download === '1') return res.download(abs);
  res.sendFile(abs);
});

// A file name for an attachment: a plain name, never the task file or a hidden file.
function attachmentName(raw) {
  const name = path.basename(String(raw || '').replace(/\\/g, '/')).trim();
  if (!name || name === '.' || name === '..' || name.startsWith('.') || name === TASK_FILE) {
    throw new HttpError(400, 'Invalid file name.');
  }
  return name;
}

// "name.ext", or "name (1).ext", "name (2).ext", ... when that is taken.
function freeFileName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

// Upload an attachment into a task folder. The body is the raw file; space, task and file name
// are in the query, so no multipart parser is needed.
app.post('/api/task/file', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  const name = freeFileName(taskDir, attachmentName(req.query.name));
  fs.writeFileSync(path.join(taskDir, name), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  res.status(201).json({ files: listFiles(root, taskDir) });
});

// Delete one attachment (a file directly inside a task folder, not the task file).
app.delete('/api/file', (req, res) => {
  const { root } = spaceFrom(req.query);
  const abs = resolveInsideRoot(root, String(req.query.rel || ''));
  const taskDir = path.dirname(abs);
  if (!isTaskFolder(taskDir) || path.basename(abs) === TASK_FILE) throw new HttpError(400, 'Not an attachment.');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'File not found.');
  fs.unlinkSync(abs);
  res.json({ files: listFiles(root, taskDir) });
});

app.use('/api', (req, res) => { throw new HttpError(404, 'Unknown API route.'); });

// Frontend. Dev: Vite runs in middleware mode so the API and the app share one port.
// Prod: the prebuilt dist/ is served as static files.
async function mountFrontend() {
  if (DEV) {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: PROJECT_ROOT, server: { middlewareMode: true }, appType: 'custom' });
    app.use(vite.middlewares);
    app.use(asyncRoute(async (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      try {
        const template = await fs.promises.readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
        res.status(200).set({ 'Content-Type': 'text/html' }).end(await vite.transformIndexHtml(req.originalUrl, template));
      } catch (err) {
        vite.ssrFixStacktrace(err);
        next(err);
      }
    }));
  } else {
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      console.error('dist/ not found. Run `pnpm run build` (or ./setup.sh) first.');
      process.exit(1);
    }
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => { if (err) next(); });
    });
  }
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = (err instanceof HttpError) ? err.status : (err.status || 500);
  if (status === 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: err.message || 'Internal error' });
});

mountFrontend().then(() => {
  const server = app.listen(config.port, config.host, () => {
    console.log('taskmgr web UI' + (DEV ? ' (dev)' : ''));
    console.log(`  config     : ${config.configPath}`);
    console.log(`  users      : ${config.usersPath}`);
    console.log(`  sync       : ${syncToken && syncToken.trim() ? `receiving from taskmgrd into ${path.join(config.dataDir, 'origins')}` : 'off (set TASKMGRD_TOKEN in .env to receive pushes from taskmgrd)'}`);
    for (const w of config.getWorks()) {
      console.log(`  work       : ${w.work}${w.origin ? ` (${w.origin})` : ''}  ${w.root || '(no tasks folder)'}`);
      for (const p of w.repositories) console.log(`    repository : ${p.name}  ${p.root}${p.sourcePath ? `  (source: ${p.sourcePath})` : ''}`);
    }
    console.log(`  url        : http://${config.host}:${config.port}/`);
    console.log('Press Ctrl+C to stop.');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Error: port ${config.port} is already in use. Set PORT in .env.`);
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  });
});
