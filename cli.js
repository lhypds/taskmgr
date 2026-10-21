#!/usr/bin/env node
const blessed = require('blessed');

const { isCJKChar } = require('./utils/cjkUtils');
const {
  createTask,
  markTask,
  updateLastEdit,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  readTasks,
  hasSubtask,
  compareIdsDesc
} = require('./utils/taskUtils');
const { clearScreen } = require('./utils/screenUtils');
const { getEditor, getEditorInfo, getEditorCommand } = require('./utils/editorUtils');

// load .env
const path = require('path');
const fs = require('fs');
(function loadDotenv() {
  try {
    // require dotenv only if available so this script still works without the package
    let dotenv = null;
    try { dotenv = require('dotenv'); } catch (e) { /* dotenv not installed */ }
    if (!dotenv) return;

    // try common locations in order: cwd (where user runs the CLI), script dir (project root), then parent
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(__dirname, '.env'),
      path.resolve(__dirname, '..', '.env')
    ];

    for (const dotenvPath of candidates) {
      if (fs.existsSync(dotenvPath)) {
        dotenv.config({ path: dotenvPath });
        break;
      }
    }
  } catch (e) { /* dotenv optional or not installed; ignore */ }
})();

function formatOriginForDisplay(s, width) {
  s = (s || '').toString().trim();
  let out = '';
  let cur = 0;
  for (const ch of s) {
    const w = isCJKChar(ch) ? 2 : 1;
    if (cur + w > width) break; // don't exceed target width
    out += ch;
    cur += w;
  }
  if (cur < width) out += ' '.repeat(width - cur);
  return out;
}

function renderList(screen, list, tasks, selected) {
  const lines = tasks.map((t, i) => {
    // determine status display: done/pending/todo (with subtask marker)
    const statusRaw = (t.status || '').toLowerCase();
    let check;
    if (statusRaw === 'done') {
      check = '[x]';
    } else if (statusRaw === 'pending') {
      check = '[p]';
    } else {
      // todo or other: show [+] if it has subtasks
      const taskDir = t.path ? path.dirname(t.path) : '';
      let sub = false;
      try { sub = hasSubtask(taskDir); } catch (e) { sub = false; }
      check = sub ? '[+]' : '[ ]';
    }

    const detailsRaw = t.details || '';
    let title;
    // find the first non-empty row in details and use that as the title
    const detailLines = detailsRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (detailLines.length > 0) {
      const firstLine = detailLines[0];
      const words = firstLine.split(/\s+/).filter(Boolean);
      if (words.length > 3) {
        title = words.slice(0, 3).join(' ');
      } else {
        title = firstLine;
      }
    } else {
      title = '(empty)';
    }

    // format origin to exact display width 5, counting CJK chars as width 2
    const origin = formatOriginForDisplay(t.origin || '', 8);

    const last = t.last_edit || '';
    return `${check}  ${t.id}  ${origin}  ${last}  ${title}`;
  });
  list.setItems(lines);
  list.select(selected);
  screen.render();
}

function main() {
  // Allow changing cwd when navigating into task folders
  // Check if a path argument was provided
  const args = process.argv.slice(2);
  let cwd = process.cwd();

  if (args.length > 0) {
    const providedPath = args[0];
    // Resolve the path (handles relative paths)
    const resolvedPath = path.resolve(providedPath);

    // Check if the path exists and is a directory
    try {
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        cwd = resolvedPath;
      } else {
        console.error(`Error: "${providedPath}" is not a valid directory.`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: Cannot access "${providedPath}": ${error.message}`);
      process.exit(1);
    }
  }

  const initialRoot = cwd; // do not allow navigating above this directory

  // Create the screen
  const screen = blessed.screen({ smartCSR: true, title: 'taskmgr', fullUnicode: true, mouse: true });

  // Header row (always visible)
  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, height: 1, width: '100%',
    content: '     id            origin    edit_at       task'
  });

  // Claude-like orange for the selected row (blessed maps hex to the nearest terminal color)
  const selectedStyle = { bg: '#DA7756', fg: 'white', bold: true };

  const list = blessed.list({
    parent: screen,
    top: 1, left: 0, width: '100%', height: '100%-1',
    keys: true, vi: true, mouse: true,
    style: { selected: selectedStyle }
  });

  const statusBarStyle = (process.platform === 'win32')
    ? { bg: 'green', fg: 'white' }
    : { bg: 'gray', fg: 'black' };

  // status bar shown at the bottom of the screen
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, height: 1, width: '100%',
    content: '',
    input: true, // keyable: receives keypresses while in command mode
    style: statusBarStyle
  });

  let isCommandMode = false;

  function updateStatusBar(tasks) {
    if (isCommandMode) return; // keep the typed command visible
    const ts = tasks || list.tasksData || [];
    const total = ts.length;

    // Show: <counters> `path-to-task-folder` <editor>
    const editor = getEditor();

    // counters for statuses: todo (including empty), done, pending
    let todoCount = 0, doneCount = 0, pendingCount = 0;
    for (const item of ts) {
      const st = (item.status || '').toLowerCase();
      if (st === 'done') doneCount++;
      else if (st === 'pending') pendingCount++;
      else todoCount++;
    }

    const counterString = `todo:${todoCount} done:${doneCount} pending:${pendingCount}`;
    const pathString = ' ' + '`' + cwd + '`';
    const { missing } = getEditorInfo();
    const editorString = ' ' + editor + (missing ? ` (EDITOR=${missing} not found)` : '');
    statusBar.setContent(counterString + pathString + editorString);
    try { screen.render(); } catch (e) { }
  }

  // persistent no-tasks box (hidden by default)
  const noTasksBox = blessed.box({
    parent: screen,
    top: 'center', left: 'center', width: 'shrink', height: 'shrink',
    content: 'No tasks found. Press `a` to add a task, or `q` to quit.',
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    hidden: true
  });

  function refresh(selectedIndex = 0) {
    const tasks = readTasks(cwd);

    if (tasks.length === 0) {
      list.clearItems();

      // If we're at the initial root directory, show the no-tasks box; otherwise show an empty list
      if (cwd === initialRoot) {
        try { header.hide(); } catch (e) { }
        try { list.hide(); } catch (e) { }
        try { noTasksBox.show(); } catch (e) { }
      } else {
        try { noTasksBox.hide(); } catch (e) { }
        try { header.show(); } catch (e) { }
        try { list.show(); } catch (e) { }
      }

      screen.render();

      // update status bar to show no tasks
      updateStatusBar([]);
      return;
    }

    // tasks exist: ensure header and list visible and no-tasks box hidden
    try { noTasksBox.hide(); } catch (e) { }
    try { header.show(); } catch (e) { }
    try { list.show(); } catch (e) { }

    // reorder tasks: todo (top), done (middle), pending (bottom)
    const statusOrder = (s) => {
      const st = (s || '').toLowerCase();
      if (st === 'todo' || st === '') return 0;
      if (st === 'done') return 1;
      if (st === 'pending') return 2;
      return 0;
    };

    tasks.sort((a, b) => {
      const sa = statusOrder(a.status);
      const sb = statusOrder(b.status);
      if (sa !== sb) return sa - sb;
      // within same status, sort by id descending (newest first)
      return compareIdsDesc(a, b);
    });

    renderList(screen, list, tasks, selectedIndex);
    list.tasksData = tasks; // attach

    // Update the status bar
    updateStatusBar(tasks);
  }
  refresh(0);

  // Open a task file in the editor, suspending the TUI while it runs.
  // Returns false (and shows a message) if the editor could not be started.
  function openInEditor(taskPath) {
    const { spawnSync } = require('child_process');
    const { cmd, args } = getEditorCommand(taskPath);
    try { screen.leave(); } catch (e) { }
    const result = spawnSync(cmd, args, { stdio: 'inherit' });
    // re-enter blessed / alternate screen (be defensive about APIs)
    try {
      if (typeof screen.enter === 'function') screen.enter();
      else if (screen.program && typeof screen.program.enter === 'function') screen.program.enter();
    } catch (e) { }
    if (result.error) {
      try { screen.render(); } catch (e) { }
      statusBar.setContent(`Cannot start editor "${cmd}": ${result.error.code || result.error.message}`);
      try { screen.render(); } catch (e) { }
      return false;
    }
    updateLastEdit(taskPath);
    renameTaskByFirstLine(taskPath);
    return true;
  }

  // Shortcuts
  // 1. Exit the application
  screen.key(['q', 'C-c'], () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    try { screen.destroy(); } catch (e) { }
    clearScreen();
    process.exit(0);
  });

  // 2. Refresh the task list
  screen.key('l', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    refresh(list.selected);
  });

  // 3. Refresh the task list
  screen.key('r', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const sel = (typeof list.selected === 'number') ? list.selected : 0;
    // Re-render the blessed UI and refresh the list — do NOT clear the raw terminal buffer
    try { refresh(sel); } catch (e) { try { screen.render(); } catch (err) { /* ignore */ } }
  });

  // 4. Add a new task (or open the existing task for the current minute)
  screen.key('a', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const taskPath = createTask(cwd);
    const ok = openInEditor(taskPath);
    // restore focus and refresh tasks after editor exits
    try { list.focus(); } catch (e) { }
    if (ok) refresh();
  });

  // 5. Edit a task
  screen.key('e', () => {
    // Close preview if it's open
    if (isPreviewing) {
      closePreview()
    }

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) {
      const ok = openInEditor(t.path);
      try { list.focus(); } catch (e) { }
      if (ok) refresh(list.selected);
    }
  });
  screen.key('i', () => {
    // Close preview if it's open
    if (isPreviewing) {
      closePreview()
    }

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) {
      const ok = openInEditor(t.path);
      try { list.focus(); } catch (e) { }
      if (ok) refresh(list.selected);
    }
  });

  // 6. Preview task content on space (previously toggled done)
  let previewBox = null;
  let isPreviewing = false;

  // Close preview
  function closePreview() {
    if (previewBox) {
      try { previewBox.hide(); } catch (e) { }
      try { previewBox.destroy(); } catch (e) { }
      previewBox = null;
      isPreviewing = false;
      try { list.focus(); } catch (e) { }
      try { screen.render(); } catch (e) { }
    }
  }

  // 6.1. Help modal (opened from command mode with :h / :help)
  const HELP_TEXT = [
    ' taskmgr shortcuts',
    '',
    '  j / k, up / down   move between tasks',
    '  h / l, left/right  go to parent / into subtasks',
    '  a                  add a task (opens editor)',
    '  e / i              edit the selected task',
    '  space              preview task details',
    '  enter              open the task folder',
    '  x                  mark done / undone',
    '  p                  mark pending / todo',
    '  d                  delete the selected task',
    '  r                  refresh the task list',
    '  :                  command mode  (:h or :help shows this)',
    '  q                  quit',
    '',
    ' press q, esc or enter to close'
  ].join('\n');

  function showHelp() {
    if (isPreviewing) closePreview();
    const helpLines = HELP_TEXT.split('\n');
    const helpWidth = Math.max(...helpLines.map(l => l.length)) + 4; // text + border + padding
    previewBox = blessed.box({
      parent: screen,
      top: 'center', left: 'center',
      width: Math.min(helpWidth, screen.width - 2),
      height: Math.min(helpLines.length + 2, screen.height - 2),
      content: HELP_TEXT,
      padding: { left: 1, right: 1 },
      scrollable: true, alwaysScroll: true,
      border: { type: 'line' },
      keys: true, mouse: true,
      style: { fg: 'white', bg: 'black', border: { fg: 'blue' } }
    });
    isPreviewing = true; // reuse the preview guards so other shortcuts stay inactive
    previewBox.key(['q', 'escape', 'enter', 'space'], closePreview);
    try { list.blur(); } catch (e) { }
    try { previewBox.focus(); } catch (e) { }
    try { screen.render(); } catch (e) { }
  }

  // 6.2. Command mode, vim style: ':' turns the status bar into a command line.
  // Keys are read directly (no textbox) and the buffer is drawn in the status bar.
  let cmdBuffer = '';

  function drawCommandLine() {
    statusBar.setContent(':' + cmdBuffer);
    try { screen.render(); } catch (e) { }
    // put the terminal cursor right after the typed text
    try {
      let col = 1;
      for (const ch of cmdBuffer) col += isCJKChar(ch) ? 2 : 1;
      screen.program.cup(screen.height - 1, col);
      screen.program.showCursor();
    } catch (e) { }
  }

  function enterCommandMode() {
    isCommandMode = true;
    cmdBuffer = '';
    screen.grabKeys = true; // suppress all screen-level shortcuts
    try { statusBar.focus(); } catch (e) { }
    drawCommandLine();
  }

  function exitCommandMode() {
    isCommandMode = false;
    cmdBuffer = '';
    screen.grabKeys = false;
    try { screen.program.hideCursor(); } catch (e) { }
    try { list.focus(); } catch (e) { }
    updateStatusBar();
  }

  function runCommand(raw) {
    const cmd = (raw || '').trim();
    if (!cmd) return;
    if (cmd === 'h' || cmd === 'help') {
      showHelp();
      return;
    }
    // unknown command: show a short message in the status bar until the next refresh
    statusBar.setContent(`Not a command: ${cmd}`);
    try { screen.render(); } catch (e) { }
  }

  statusBar.on('keypress', (ch, key) => {
    if (!isCommandMode) return;
    const name = (key && key.name) || '';
    if (name === 'return') return; // blessed emits 'return' and 'enter' for the same key
    if (name === 'escape' || (key && key.ctrl && name === 'c')) { exitCommandMode(); return; }
    if (name === 'enter') {
      const cmd = cmdBuffer;
      exitCommandMode();
      runCommand(cmd);
      return;
    }
    if (name === 'backspace') {
      if (!cmdBuffer) { exitCommandMode(); return; } // like vim: backspace on empty leaves
      cmdBuffer = cmdBuffer.slice(0, -1);
      drawCommandLine();
      return;
    }
    if (key && (key.ctrl || key.meta)) return;
    if (ch && !/^[\x00-\x1f\x7f]$/.test(ch)) {
      cmdBuffer += ch;
      drawCommandLine();
    }
  });

  screen.key(':', () => {
    if (isPreviewing || isCommandMode) return;
    enterCommandMode();
  });

  screen.key('space', () => {
    // If a preview is open, close it (toggle behavior)
    if (isPreviewing && previewBox) {
      closePreview();
    }

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (!t) return;

    // Show only the Details field in the preview (do not show full file)
    const detailsRaw = (t.details || '').toString();

    // Remove the first and last empty lines, not the middle ones
    const details = (() => {
      const lines = detailsRaw.split('\n');
      let start = 0;
      let end = lines.length;

      // skip leading empty lines
      while (start < end && lines[start].trim() === '') start++;

      // skip trailing empty lines
      while (end > start && lines[end - 1].trim() === '') end--;
      return lines.slice(start, end).map(line => line.trim()).join('\n');
    })();
    const previewContent = details.trim() ? details : '';

    previewBox = blessed.box({
      parent: screen,
      top: 'center', left: 'center', width: '80%', height: '70%',
      content: previewContent,
      border: { type: 'line' },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'white' } },
      style: { fg: 'white', bg: 'black', border: { fg: 'blue' } }
    });
    // mark preview as active
    isPreviewing = true;

    // Close preview with common keys and restore focus
    previewBox.key(['q', 'escape', 'enter', 'space'], () => {
      try { previewBox.hide(); } catch (e) { }
      try { previewBox.destroy(); } catch (e) { }
      previewBox = null;
      isPreviewing = false;
      try { list.focus(); } catch (e) { }
      try { screen.render(); } catch (e) { }
    });

    // Ensure list doesn't capture keys while preview is open
    try { list.blur(); } catch (e) { }
    try { previewBox.focus(); } catch (e) { }
    try { screen.render(); } catch (e) { }
  });

  // 6.5. Toggle pending status with 'p' — mark pending/todo and refresh ordering
  screen.key('p', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const tasks = list.tasksData || readTasks(cwd);
    const cur = (typeof list.selected === 'number') ? list.selected : 0;
    const t = tasks[cur];
    if (!t) return;
    const id = t.id;

    if ((t.status || '').toLowerCase() !== 'pending') {
      markTask(t, 'pending');
    } else {
      markTask(t, 'todo');
    }

    // refresh list and re-select the same task by id in new ordering
    refresh();
    const newTasks = list.tasksData || readTasks(cwd);
    const idx = newTasks.findIndex(x => x.id === id);
    const sel = idx >= 0 ? idx : Math.min(cur, newTasks.length - 1);
    try { list.select(sel); } catch (e) { }
    try { screen.render(); } catch (e) { }
  });

  // 7. Open current task folder
  screen.key('enter', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) { openTask(t); }
  });

  // 8. Delete a task
  screen.key('d', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) {
      deleteTask(t);
      refresh(Math.max(0, list.selected - 1));
    }
  });

  // 8.5. Mark task as done
  screen.key('x', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const tasks = list.tasksData || readTasks(cwd);
    const cur = (typeof list.selected === 'number') ? list.selected : 0;
    const t = tasks[cur];
    if (!t) return;
    const id = t.id;

    if ((t.status || '').toLowerCase() !== 'done') {
      markTask(t, 'done');
    } else {
      markTask(t, 'todo');
    }

    // refresh list and re-select the same task by id in new ordering
    refresh();
    const newTasks = list.tasksData || readTasks(cwd);
    const idx = newTasks.findIndex(x => x.id === id);
    const sel = idx >= 0 ? idx : Math.min(cur, newTasks.length - 1);
    try { list.select(sel); } catch (e) { }
    try { screen.render(); } catch (e) { }
  });

  // 9. Change current working directory
  // - Right arrow: change cwd into the selected task's folder (the directory containing the task file)
  // - Left arrow: go up to the parent directory
  screen.key(['right'], () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    try {
      const tasks = list.tasksData || readTasks(cwd);
      const t = tasks[list.selected];
      if (!t || !t.path) return;
      const newCwd = path.dirname(t.path);
      if (!newCwd || newCwd === cwd) return;
      cwd = newCwd;
      refresh(0);
    } catch (e) { /* ignore */ }
  });
  screen.key(['l'], () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    try {
      const tasks = list.tasksData || readTasks(cwd);
      const t = tasks[list.selected];
      if (!t || !t.path) return;
      const newCwd = path.dirname(t.path);
      if (!newCwd || newCwd === cwd) return;
      cwd = newCwd;
      refresh(0);
    } catch (e) { /* ignore */ }
  });

  screen.key(['left'], () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    try {
      const parent = path.dirname(cwd);
      if (!parent || parent === cwd) return;
      // prevent moving above the initial root directory where the program started
      const rel = path.relative(initialRoot, parent);
      if (rel === '' || (!rel.startsWith('..'))) {
        // parent is inside or equal to initialRoot -> allow
        cwd = parent;
        refresh(0);
      } else {
        // parent would be outside initialRoot -> ignore
      }
    } catch (e) { /* ignore */ }
  });
  screen.key(['h'], () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    try {
      const parent = path.dirname(cwd);
      if (!parent || parent === cwd) return;
      // prevent moving above the initial root directory where the program started
      const rel = path.relative(initialRoot, parent);
      if (rel === '' || (!rel.startsWith('..'))) {
        // parent is inside or equal to initialRoot -> allow
        cwd = parent;
        refresh(0);
      } else {
        // parent would be outside initialRoot -> ignore
      }
    } catch (e) { /* ignore */ }
  });

  // Gestures
  // Support mouse wheel to move between tasks
  function moveSelection(delta) {
    const tasks = list.tasksData || readTasks(cwd);
    if (!tasks || tasks.length === 0) return;
    const max = tasks.length - 1;
    const cur = (typeof list.selected === 'number') ? list.selected : 0;
    const next = Math.max(0, Math.min(max, cur + delta));
    if (next !== cur) {
      list.select(next);
      screen.render();
    }
  }

  // Handle mouse wheel events on both screen and list (covers more terminals, incl. some Windows hosts)
  function onMouseWheel(data) {
    if (!data) return;
    const action = data.action || data.type || '';
    const button = data.button || '';
    // common names: 'wheelup' / 'wheeldown', also some terminals use button values
    if (action === 'wheelup' || button === 'wheelup') {
      moveSelection(-1);
    } else if (action === 'wheeldown' || button === 'wheeldown') {
      moveSelection(1);
    }
  }

  screen.on('mouse', onMouseWheel);
  list.on('mouse', onMouseWheel);

  list.focus();
  screen.render();
}

main();
