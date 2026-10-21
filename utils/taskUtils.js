const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { formatDate } = require('./dateUtils');

const TASK_FILE = 'task.txt';

function parseTask(text) {
  const out = { status: '', labels: '', origin: '', last_edit: '', details: '' };
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const fmLines = fmMatch[1].split(/\r?\n/);
    for (const l of fmLines) {
      const m = l.match(/^([^:]+):\s*(.*)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    }
    out.details = fmMatch[2].replace(/^\n/, '');
  } else {
    // legacy format fallback
    const lines = text.split(/\r?\n/);
    let detailsMode = false;
    const details = [];
    for (const l of lines) {
      if (detailsMode) { details.push(l); continue; }
      if (/^Details:\s*$/.test(l)) { detailsMode = true; continue; }
      const m = l.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        const key = m[1].trim().toLowerCase().replace(/ /g, '_');
        out[key] = m[2].trim();
      }
    }
    out.details = details.join('\n');
    if (out['last_edit_at']) { out.last_edit = out['last_edit_at']; }
  }
  return out;
}

// Folder names that are tasks by name alone: a 12-digit creation minute,
// optionally followed by a space and a title ("202610191522 fix mail").
const TASK_FOLDER_RE = /^\d{12}( |$)/;

// A directory is a task folder when its name has the time prefix, or (for
// folders named some other way) when it contains a task file.
function isTaskFolder(dirAbs) {
  try {
    if (!fs.statSync(dirAbs).isDirectory()) return false;
  } catch (e) {
    return false;
  }
  return TASK_FOLDER_RE.test(path.basename(dirAbs)) || fs.existsSync(path.join(dirAbs, TASK_FILE));
}

// Read the task of a task folder. A folder without a task file (one made by
// hand, or just "<id> title") is still a task: todo, titled after the folder
// name, with the folder's modification time as last_edit.
function readTaskDir(dirAbs) {
  const name = path.basename(dirAbs);
  const taskPath = path.join(dirAbs, TASK_FILE);
  let parsed;
  if (fs.existsSync(taskPath)) {
    parsed = parseTask(fs.readFileSync(taskPath, 'utf8'));
  } else {
    let lastEdit = '';
    try { lastEdit = formatDate(fs.statSync(dirAbs).mtime); } catch (e) { /* ignore */ }
    parsed = { status: 'todo', labels: '', origin: '', last_edit: lastEdit, details: folderTitle(name) };
  }
  parsed.id = folderId(name);  // only the id prefix
  parsed.path = taskPath;
  return parsed;
}

// Make sure the task file of a task folder exists, so an editor or a write
// finds a well-formed file. Returns the task file path.
function ensureTaskFile(taskPath) {
  if (!fs.existsSync(taskPath)) {
    const task = readTaskDir(path.dirname(taskPath));
    task.last_edit = formatDate(new Date());
    saveTask(task);
  }
  return taskPath;
}

function readTasks(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const tasks = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dirAbs = path.join(dir, e.name);
    if (isTaskFolder(dirAbs)) tasks.push(readTaskDir(dirAbs));
  }

  // sort by id descending (newest first)
  tasks.sort(compareIdsDesc);
  return tasks;
}

// Determine whether a task directory contains any subtasks (task folders).
function hasSubtask(taskDir) {
  try {
    if (!taskDir) return false;
    if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) return false;
    const entries = fs.readdirSync(taskDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && isTaskFolder(path.join(taskDir, e.name)));
  } catch (e) {
    return false;
  }
}

function formatTaskId(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}`;
}

// Task folders are named "<id>" or "<id> <title>": the id is the first
// space-separated token of the folder name.
function folderId(name) {
  return name.split(' ')[0];
}

// The title part of a task folder name ("" for a bare id).
function folderTitle(name) {
  const i = name.indexOf(' ');
  return i < 0 ? '' : name.slice(i + 1).trim();
}

// Turn a task title into the folder-name suffix: drop characters that are
// unsafe in folder names and cap the length.
function folderSuffix(title) {
  return (title || '').replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 80);
}

// Folder name for a task: "<id>" or "<id> <title>" when a title is given.
function taskFolderName(id, title) {
  const suffix = folderSuffix(title);
  return suffix ? `${id} ${suffix}` : id;
}

// Whether any folder in dir already uses this id, bare or with a title suffix.
// Folders without a task file count too: the id must stay unique in the folder.
function isTaskIdTaken(dir, id) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && folderId(e.name) === id);
  } catch (e) {
    return false;
  }
}

// Compare two task ids (digit strings), newest first.
// Ids are zero-padded timestamps, so string order equals time order.
function compareIdsDesc(a, b) {
  return String(b.id).localeCompare(String(a.id));
}

// Return the first free task id in dir starting from `now` (YYYYMMDDHHmm).
// If a task with that id already exists (bare or renamed "<id> title"), the
// minute is bumped by one until an unused id is found, so two tasks created in
// the same minute get distinct folders. Date arithmetic handles hour/day rollover.
function nextFreeTaskId(dir, now) {
  const d = new Date(now.getTime());
  let id = formatTaskId(d);
  while (isTaskIdTaken(dir, id)) {
    d.setMinutes(d.getMinutes() + 1);
    id = formatTaskId(d);
  }
  return id;
}

// The task title is the first non-empty line of its details.
function firstDetailLine(details) {
  return (details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || '';
}

// Create a task folder in dir and return the path of its task file.
// The folder is "<id>" or, when details start with a title line, "<id> <title>".
function createTask(dir, labels = '', origin = '', status = 'todo', details = '') {
  const now = new Date();
  // task id is the creation time as YYYYMMDDHHmm (local time), bumped by a
  // minute per collision so a second task in the same minute never reuses
  // (or opens) the first one's folder.
  const id = nextFreeTaskId(dir, now);
  const taskDir = path.join(dir, taskFolderName(id, firstDetailLine(details)));
  fs.mkdirSync(taskDir);
  const taskPath = path.join(taskDir, TASK_FILE);
  const nowStr = formatDate(now);
  const template = `---\nstatus: ${status}\nlabels: ${labels}\norigin: ${origin}\nlast_edit: ${nowStr}\n---\n\n\n${details}`;
  fs.writeFileSync(taskPath, template, 'utf8');

  // return path to let caller open editor while screen is suspended
  return taskPath;
}

function saveTask(task) {
  const fm = `---\nstatus: ${task.status || ''}\nlabels: ${task.labels || ''}\norigin: ${task.origin || ''}\nlast_edit: ${task.last_edit || ''}\n---\n\n${task.details || ''}`;
  fs.writeFileSync(task.path, fm, 'utf8');
}

function markTask(task, status) {
  if (!task) return;
  task.status = status;
  task.last_edit = formatDate(new Date());
  saveTask(task);
}

function updateLastEdit(taskPath) {
  try {
    const content = fs.readFileSync(taskPath, 'utf8');
    const task = parseTask(content);
    task.path = taskPath;
    task.last_edit = formatDate(new Date());
    saveTask(task);
  } catch (e) { /* ignore */ }
}

function deleteTask(task) {
  const taskDir = path.dirname(task.path);  // use actual path, folder may have suffix
  fs.rmSync(taskDir, { recursive: true, force: true });
}

// After creating/editing a task, rename its folder to "<id> <first detail line>".
// Returns the new task path (or original if nothing to rename).
function renameTaskByFirstLine(taskPath) {
  try {
    const content = fs.readFileSync(taskPath, 'utf8');
    const parsed = parseTask(content);
    const firstLine = firstDetailLine(parsed.details);
    if (!firstLine) return taskPath;
    const taskDir = path.dirname(taskPath);
    const parentDir = path.dirname(taskDir);
    const oldName = path.basename(taskDir);
    // keep the id, replace any existing title suffix
    const newName = taskFolderName(folderId(oldName), firstLine);
    if (oldName === newName) return taskPath;
    const newDir = path.join(parentDir, newName);
    fs.renameSync(taskDir, newDir);
    return path.join(newDir, path.basename(taskPath));
  } catch (e) {
    return taskPath;
  }
}

function openTask(task) {
  if (!task) return;
  const dir = path.dirname(task.path);
  if (process.platform === 'win32') {
    const winPath = dir.replace(/\//g, '\\');
    spawnSync('explorer', [winPath], { stdio: 'ignore' });
  } else {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawnSync(opener, [dir], { stdio: 'ignore' });
  }
}

module.exports = {
  TASK_FILE,
  isTaskFolder,
  readTaskDir,
  ensureTaskFile,
  createTask,
  saveTask,
  markTask,
  updateLastEdit,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  parseTask,
  readTasks,
  hasSubtask,
  compareIdsDesc
};
