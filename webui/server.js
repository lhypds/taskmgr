#!/usr/bin/env node
// taskmgr web UI: a localhost server exposing the same task operations as the CLI.
//
//   node webui/server.js [tasks-root]
//
// Tasks root is resolved by webui/config.js (argument > TASKS_ROOT in .env > webui/settings.json > cwd).
const http = require('http');
const fs = require('fs');
const path = require('path');

const {
  createTask,
  markTask,
  updateLastEdit,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  parseTask,
  readTasks,
  hasSubtask
} = require('../utils/taskUtils');
const { resolveConfig } = require('./config');
const { getEditor } = require('../utils/editorUtils');

const TASK_FILE = 'task.txt';
const PUBLIC_DIR = path.join(__dirname, 'public');

let config;
try {
  config = resolveConfig(process.argv.slice(2));
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
const ROOT = config.root;

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Resolve a path relative to ROOT and make sure it stays inside ROOT.
function resolveInsideRoot(rel) {
  const abs = path.resolve(ROOT, rel || '');
  const relToRoot = path.relative(ROOT, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new HttpError(400, 'Path is outside the tasks root.');
  }
  return abs;
}

function toRel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function resolveDir(rel) {
  const abs = resolveInsideRoot(rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new HttpError(404, 'Directory not found.');
  }
  return abs;
}

function resolveTaskDir(rel) {
  if (!rel) throw new HttpError(400, 'Missing task path.');
  const abs = resolveDir(rel);
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
    const ai = parseInt(a.id, 10) || 0;
    const bi = parseInt(b.id, 10) || 0;
    return bi - ai;
  });
  return tasks;
}

function serializeTask(t) {
  const taskDir = path.dirname(t.path);
  const status = (t.status || '').toLowerCase();
  let sub = false;
  try { sub = hasSubtask(taskDir); } catch (e) { sub = false; }
  return {
    id: t.id,
    rel: toRel(taskDir),
    folder: path.basename(taskDir),
    status: status === 'done' ? 'done' : (status === 'pending' ? 'pending' : 'todo'),
    labels: t.labels || '',
    origin: t.origin || '',
    last_edit: t.last_edit || '',
    title: firstDetailLine(t.details) || '(empty)',
    details: t.details || '',
    hasSubtask: sub
  };
}

function listDir(rel) {
  const abs = resolveDir(rel);
  const tasks = sortTasks(readTasks(abs)).map(serializeTask);
  const isRoot = abs === ROOT;
  const parent = isRoot ? null : toRel(path.dirname(abs));
  const counts = { todo: 0, done: 0, pending: 0 };
  for (const t of tasks) counts[t.status]++;
  return { dir: toRel(abs), absDir: abs, isRoot, parent, tasks, counts };
}

function listFiles(taskDirAbs) {
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
      rel: toRel(abs),
      isDir: e.isDirectory(),
      isSubtask: e.isDirectory() && fs.existsSync(path.join(abs, TASK_FILE)),
      size
    });
  }
  files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return files;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 10 * 1024 * 1024) { reject(new HttpError(413, 'Body too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new HttpError(400, 'Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

function sendFile(res, abs, download) {
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(abs);
  const headers = { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store' };
  if (download || !MIME[ext]) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(abs).pipe(res);
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;

  switch (route) {
    case 'GET /api/settings':
      return sendJson(res, 200, { root: ROOT, rootSource: config.rootSource, editor: getEditor() });

    case 'GET /api/tasks':
      return sendJson(res, 200, listDir(q.get('dir') || ''));

    case 'POST /api/tasks': {
      // Create a new task in the given directory (like `a` in the CLI) and return its raw content for editing.
      const body = await readBody(req);
      const dirAbs = resolveDir(body.dir || '');
      let taskPath;
      try {
        taskPath = createTask(dirAbs);
      } catch (e) {
        if (e && e.code === 'EEXIST') throw new HttpError(409, 'A task with the same id (current minute) already exists. Try again in a minute.');
        throw e;
      }
      const taskDir = path.dirname(taskPath);
      return sendJson(res, 201, {
        task: serializeTask(taskFromDir(taskDir)),
        content: fs.readFileSync(taskPath, 'utf8')
      });
    }

    case 'GET /api/task': {
      const taskDir = resolveTaskDir(q.get('rel'));
      return sendJson(res, 200, {
        task: serializeTask(taskFromDir(taskDir)),
        content: fs.readFileSync(path.join(taskDir, TASK_FILE), 'utf8'),
        files: listFiles(taskDir)
      });
    }

    case 'PUT /api/task': {
      // Save raw task.txt content (like finishing an editor session in the CLI).
      const body = await readBody(req);
      const taskDir = resolveTaskDir(body.rel);
      if (typeof body.content !== 'string') throw new HttpError(400, 'Missing content.');
      let taskPath = path.join(taskDir, TASK_FILE);
      fs.writeFileSync(taskPath, body.content, 'utf8');
      updateLastEdit(taskPath);
      taskPath = renameTaskByFirstLine(taskPath);
      return sendJson(res, 200, { task: serializeTask(taskFromDir(path.dirname(taskPath))) });
    }

    case 'POST /api/task/status': {
      // Mark a task as done / pending / todo (like `x` and `p` in the CLI).
      const body = await readBody(req);
      const taskDir = resolveTaskDir(body.rel);
      const status = String(body.status || '').toLowerCase();
      if (!['todo', 'done', 'pending'].includes(status)) throw new HttpError(400, 'Invalid status.');
      const task = taskFromDir(taskDir);
      markTask(task, status);
      return sendJson(res, 200, { task: serializeTask(taskFromDir(taskDir)) });
    }

    case 'POST /api/task/open': {
      // Open the task folder with the OS file manager (like Enter in the CLI).
      const body = await readBody(req);
      const taskDir = resolveTaskDir(body.rel);
      openTask(taskFromDir(taskDir));
      return sendJson(res, 200, { ok: true });
    }

    case 'DELETE /api/task': {
      const taskDir = resolveTaskDir(q.get('rel'));
      deleteTask(taskFromDir(taskDir));
      return sendJson(res, 200, { ok: true });
    }

    case 'GET /api/file': {
      // Serve an attachment that lives inside a task folder.
      const abs = resolveInsideRoot(q.get('rel') || '');
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'File not found.');
      return sendFile(res, abs, q.get('download') === '1');
    }

    case 'POST /api/quit': {
      // Quit like `q` in the CLI: reply, then shut the server down.
      sendJson(res, 200, { ok: true });
      res.on('finish', () => {
        console.log('Quit requested from the web UI. Stopping.');
        server.close();
        setTimeout(() => process.exit(0), 100).unref();
      });
      return;
    }

    default:
      throw new HttpError(404, 'Unknown API route.');
  }
}

// ---------- static ----------

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const abs = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'Not found.');
  sendFile(res, abs, false);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      handleStatic(req, res, url);
    }
  } catch (e) {
    const status = (e instanceof HttpError) ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || 'Internal error' });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`taskmgr web UI`);
  console.log(`  tasks root : ${ROOT}  (from ${config.rootSource})`);
  console.log(`  url        : http://${config.host}:${config.port}/`);
  console.log(`Press Ctrl+C to stop.`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Error: port ${config.port} is already in use. Set PORT in .env or "port" in webui/settings.json.`);
  } else {
    console.error(`Error: ${e.message}`);
  }
  process.exit(1);
});
