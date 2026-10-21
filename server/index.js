#!/usr/bin/env node
// taskmgr web UI server: an Express app exposing the task folders as a JSON API
// and serving the React frontend (Vite in dev, the prebuilt dist/ in production).
//
//   node server/index.js [tasks-root]
//
// The works and projects (each a folder of tasks) come from taskmgr.json, see server/config.js:
//   node server/index.js [path/to/taskmgr.json]
const fs = require('fs');
const path = require('path');
const express = require('express');

const {
  createTask,
  saveTask,
  markTask,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  parseTask,
  readTasks,
  hasSubtask,
  compareIdsDesc
} = require('../utils/taskUtils');
const { formatDate } = require('../utils/dateUtils');
const { getEditor } = require('../utils/editorUtils');
const { resolveConfig } = require('./config');

const TASK_FILE = 'task.txt';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
// Dev (Vite middleware, hot reload) when NODE_ENV=development, or when nothing is built yet;
// otherwise the prebuilt dist/ is served, so `taskmgr-web` works without any env set.
const DEV = process.env.NODE_ENV === 'development'
  || (process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(DIST_DIR, 'index.html')));

let config;
try {
  config = resolveConfig(process.argv.slice(2));
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A space is one folder of tasks: the common tasks of a work, or one of its projects.
// Looked up from the query string / body of every task request as ?work=&project=.
function findSpace(work, project) {
  const w = config.getWorks().find(x => x.work === work);
  if (!w) return null;
  if (!project) return { work: w.work, project: '', root: w.root };
  const p = w.projects.find(x => x.name === project);
  if (!p) return null;
  return { work: w.work, project: p.name, root: p.root };
}

function spaceFrom(params) {
  const work = String(params.work || '');
  const project = String(params.project || '');
  if (!work) throw new HttpError(400, 'Missing work.');
  const space = findSpace(work, project);
  if (!space) throw new HttpError(404, project ? `Unknown project "${project}" in "${work}".` : `Unknown work "${work}".`);
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
  if (!fs.existsSync(path.join(abs, TASK_FILE))) {
    throw new HttpError(404, 'Task not found.');
  }
  return abs;
}

function taskFromDir(taskDirAbs) {
  const taskPath = path.join(taskDirAbs, TASK_FILE);
  const parsed = parseTask(fs.readFileSync(taskPath, 'utf8'));
  parsed.id = path.basename(taskDirAbs).split(' ')[0];
  parsed.path = taskPath;
  return parsed;
}

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
    labels: t.labels || '',
    origin: t.origin || '',
    last_edit: t.last_edit || '',
    title: firstDetailLine(t.details),
    details: t.details || '',
    hasSubtask: sub
  };
}

// Breadcrumb from the space's root down to `abs`: every ancestor that is itself a task folder.
function crumbsFor(root, abs) {
  const crumbs = [];
  let cur = abs;
  while (cur !== root) {
    const taskPath = path.join(cur, TASK_FILE);
    let title = path.basename(cur);
    if (fs.existsSync(taskPath)) {
      try { title = firstDetailLine(parseTask(fs.readFileSync(taskPath, 'utf8')).details) || title; } catch (e) { /* keep folder name */ }
    }
    crumbs.unshift({ rel: toRel(root, cur), title });
    cur = path.dirname(cur);
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
  const parent = isRoot ? null : toRel(root, path.dirname(abs));
  return {
    work: space.work,
    project: space.project,
    dir: toRel(root, abs),
    absDir: abs,
    isRoot,
    parent,
    crumbs: crumbsFor(root, abs),
    tasks,
    counts: countTasks(tasks)
  };
}

// The works/projects tree with, for each folder, whether it exists and its task counts.
function listSpaces() {
  const describe = (root) => {
    const exists = fs.existsSync(root) && fs.statSync(root).isDirectory();
    let counts = null;
    if (exists) {
      try { counts = countTasks(readTasks(root)); } catch (e) { counts = null; }
    }
    return { root, exists, counts };
  };
  return config.getWorks().map(w => ({
    work: w.work,
    ...describe(w.root),
    projects: w.projects.map(p => ({ name: p.name, ...describe(p.root) }))
  }));
}

function listFiles(root, taskDirAbs) {
  const entries = fs.readdirSync(taskDirAbs, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name === TASK_FILE) continue;
    if (e.name.startsWith('.')) continue;
    const abs = path.join(taskDirAbs, e.name);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (err) { /* ignore */ }
    files.push({
      name: e.name,
      rel: toRel(root, abs),
      isDir: e.isDirectory(),
      isSubtask: e.isDirectory() && fs.existsSync(path.join(abs, TASK_FILE)),
      size
    });
  }
  files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return files;
}

// Write the editable fields of a task (everything but the id) and rename its folder after the title.
function writeTaskFields(taskDirAbs, fields) {
  const task = taskFromDir(taskDirAbs);
  if (fields.status !== undefined) task.status = normalizeStatus(fields.status);
  if (fields.labels !== undefined) task.labels = String(fields.labels).trim();
  if (fields.origin !== undefined) task.origin = String(fields.origin).trim();
  if (fields.details !== undefined) task.details = String(fields.details).replace(/\r\n/g, '\n');
  task.last_edit = formatDate(new Date());
  saveTask(task);
  const newPath = renameTaskByFirstLine(task.path);
  return path.dirname(newPath);
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/settings', (req, res) => {
  res.json({ configPath: config.configPath, editor: getEditor() });
});

app.get('/api/spaces', (req, res) => {
  res.json({ works: listSpaces() });
});

app.get('/api/tasks', (req, res) => {
  res.json(listDir(spaceFrom(req.query), String(req.query.dir || '')));
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
  markTask(taskFromDir(taskDir), status);
  res.json({ task: serializeTask(root, taskFromDir(taskDir)) });
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
    console.log(`  config     : ${config.configPath}  (from ${config.configSource})`);
    for (const w of config.getWorks()) {
      console.log(`  work       : ${w.work}  ${w.root}`);
      for (const p of w.projects) console.log(`    project  : ${p.name}  ${p.root}`);
    }
    console.log(`  url        : http://${config.host}:${config.port}/`);
    console.log('Press Ctrl+C to stop.');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Error: port ${config.port} is already in use. Set PORT in .env or "port" in taskmgr.json.`);
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  });
});
