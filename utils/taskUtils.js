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

function readTasks(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const tasks = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const id = e.name;
      const taskPath = path.join(dir, id, TASK_FILE);
      if (fs.existsSync(taskPath)) {
        const content = fs.readFileSync(taskPath, 'utf8');
        const parsed = parseTask(content);
        parsed.id = e.name.split(' ')[0];  // only the id prefix
        parsed.path = taskPath;
        tasks.push(parsed);
      }
    }
  }

  // sort by id descending (newest first)
  tasks.sort(compareIdsDesc);
  return tasks;
}

// Determine whether a task directory contains any subtasks.
// A subtask is a subdirectory that contains a task.txt file.
function hasSubtask(taskDir) {
  try {
    if (!taskDir) return false;
    if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) return false;
    const entries = fs.readdirSync(taskDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const subTaskPath = path.join(taskDir, e.name, TASK_FILE);
        if (fs.existsSync(subTaskPath)) return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function formatTaskId(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}`;
}

// Find the directory of the task with the given id inside dir, or null.
// Matches both the bare id folder and a renamed "<id> title" folder.
function findTaskDirById(dir, id) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.split(' ')[0] !== id) continue;
      const candidate = path.join(dir, e.name);
      if (fs.existsSync(path.join(candidate, TASK_FILE))) return candidate;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// Compare two task ids (digit strings), newest first.
// Ids are zero-padded timestamps, so string order equals time order.
function compareIdsDesc(a, b) {
  return String(b.id).localeCompare(String(a.id));
}

function createTask(dir, labels = '', origin = '', status = 'todo', details = '') {
  const now = new Date();
  // task id is the creation time as YYYYMMDDHHmm (local time).
  // If a task with this id already exists (bare or renamed "<id> title"),
  // return its path so the caller opens it instead of creating a duplicate.
  const id = formatTaskId(now);
  const existingDir = findTaskDirById(dir, id);
  if (existingDir) return path.join(existingDir, TASK_FILE);
  const taskDir = path.join(dir, id);
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
    const firstLine = (parsed.details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || '';
    if (!firstLine) return taskPath;
    const taskDir = path.dirname(taskPath);
    const parentDir = path.dirname(taskDir);
    const oldName = path.basename(taskDir);
    // strip any existing suffix (keep only the datetime prefix)
    const idPart = oldName.split(' ')[0];
    // sanitize: remove characters unsafe for folder names
    const suffix = firstLine.replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 80);
    const newName = `${idPart} ${suffix}`;
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
