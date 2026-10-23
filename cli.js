#!/usr/bin/env node
const blessed = require('blessed');

const { isCJKChar } = require('./utils/cjkUtils');
const {
  createTask,
  ensureTaskFile,
  markTask,
  listDirOf,
  normalizeTaskFile,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  readTasks,
  hasSubtask,
  compareIdsDesc
} = require('./utils/taskUtils');
const { clearScreen } = require('./utils/screenUtils');
const { getEditor, getEditorInfo, getEditorCommand } = require('./utils/editorUtils');
const { resolveConfig, DEFAULT_CONFIG_PATH, EXAMPLE_CONFIG_PATH } = require('./server/config');

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

// Cut or pad a string to exactly `width` terminal cells (CJK characters take two).
function padToWidth(s, width) {
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

    return `${check}  ${t.id}  ${title}`;
  });
  list.setItems(lines);
  list.select(selected);
  screen.render();
}

// Width of a string in terminal cells (CJK characters take two).
function displayWidth(s) {
  let w = 0;
  for (const ch of (s || '').toString()) w += isCJKChar(ch) ? 2 : 1;
  return w;
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function countTasks(dir) {
  const counts = { todo: 0, done: 0, pending: 0 };
  for (const t of readTasks(dir)) {
    const st = (t.status || '').toLowerCase();
    if (st === 'done') counts.done++;
    else if (st === 'pending') counts.pending++;
    else counts.todo++;
  }
  return counts;
}

// Claude-like orange for the selected row (blessed maps hex to the nearest terminal color)
const SELECTED_STYLE = { bg: '#DA7756', fg: 'white', bold: true };
const MODAL_BORDER_COLOR = '#DA7756';
const STATUS_BAR_STYLE = (process.platform === 'win32')
  ? { bg: 'green', fg: 'white' }
  : { bg: 'gray', fg: 'black' };

function createScreen() {
  return blessed.screen({ smartCSR: true, title: 'taskmgr', fullUnicode: true, mouse: true });
}

function quit(screen) {
  try { screen.destroy(); } catch (e) { }
  clearScreen();
  process.exit(0);
}

// Vim-style command line in a status bar (created with `input: true`): enter() turns the bar
// into a ':' prompt. Keys are read directly (no textbox) and the buffer is drawn in the bar.
// Enter runs onRun(cmd), which returns false for an unknown command; esc, ctrl-c or backspace
// on empty leave. onExit restores the focus and the bar's usual content.
function createCommandLine(screen, statusBar, { onRun, onExit }) {
  let active = false;
  let buffer = '';

  function draw() {
    statusBar.setContent(':' + buffer);
    try { screen.render(); } catch (e) { }
    // put the terminal cursor right after the typed text
    try {
      let col = 1;
      for (const ch of buffer) col += isCJKChar(ch) ? 2 : 1;
      screen.program.cup(screen.height - 1, col);
      screen.program.showCursor();
    } catch (e) { }
  }

  function enter() {
    active = true;
    buffer = '';
    screen.grabKeys = true; // suppress all screen-level shortcuts
    try { statusBar.focus(); } catch (e) { }
    draw();
  }

  function exit() {
    active = false;
    buffer = '';
    screen.grabKeys = false;
    try { screen.program.hideCursor(); } catch (e) { }
    onExit();
  }

  statusBar.on('keypress', (ch, key) => {
    if (!active) return;
    const name = (key && key.name) || '';
    if (name === 'return') return; // blessed emits 'return' and 'enter' for the same key
    if (name === 'escape' || (key && key.ctrl && name === 'c')) { exit(); return; }
    if (name === 'enter') {
      const cmd = buffer.trim();
      exit();
      if (cmd && onRun(cmd) === false) {
        // unknown command: show a short message in the status bar until the next refresh
        statusBar.setContent(`Not a command: ${cmd}`);
        try { screen.render(); } catch (e) { }
      }
      return;
    }
    if (name === 'backspace') {
      if (!buffer) { exit(); return; } // like vim: backspace on empty leaves
      buffer = buffer.slice(0, -1);
      draw();
      return;
    }
    if (key && (key.ctrl || key.meta)) return;
    if (ch && !/^[\x00-\x1f\x7f]$/.test(ch)) {
      buffer += ch;
      draw();
    }
  });

  return { enter, isActive: () => active };
}

// Centered help popup, focused; q, esc, enter or space call onClose, which destroys it.
function createHelpBox(screen, text, onClose) {
  const lines = text.split('\n');
  const width = Math.max(...lines.map(l => l.length)) + 4; // text + border + padding
  const box = blessed.box({
    parent: screen,
    top: 'center', left: 'center',
    width: Math.min(width, screen.width - 2),
    height: Math.min(lines.length + 2, screen.height - 2),
    content: text,
    padding: { left: 1, right: 1 },
    scrollable: true, alwaysScroll: true,
    border: { type: 'line' },
    keys: true, mouse: true,
    style: { fg: 'white', bg: 'black', border: { fg: MODAL_BORDER_COLOR } }
  });
  box.key(['q', 'escape', 'enter', 'space'], onClose);
  try { box.focus(); } catch (e) { }
  try { screen.render(); } catch (e) { }
  return box;
}

// One wheel notch moves the selection one row (blessed's list moves two).
function wheelOneRow(list) {
  list.removeAllListeners('element wheeldown');
  list.removeAllListeners('element wheelup');
  const step = (delta) => {
    const next = Math.max(0, Math.min(list.items.length - 1, list.selected + delta));
    if (next === list.selected) return;
    list.select(next);
    list.screen.render();
  };
  list.on('element wheeldown', () => step(1));
  list.on('element wheelup', () => step(-1));
}

// A left click on a row opens it, like enter, rather than only selecting it.
function clickToOpen(list, onOpen) {
  list.on('element click', (item, data) => {
    if (data.button !== 'left') return;
    const i = list.items.indexOf(item);
    if (i < 0) return;
    list.select(i);
    onOpen();
  });
}

// Work / repository tree shown by a bare `tm`: every work of taskmgr.json with its repositories
// nested beneath it, each row being one folder of tasks. onPick({ label, root }) opens one.
function createWorkPicker(screen, config, onPick) {
  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, height: 1, width: '100%',
    content: '', hidden: true
  });
  const list = blessed.list({
    parent: screen,
    top: 1, left: 0, width: '100%', height: '100%-2',
    keys: true, vi: true, mouse: true,
    style: { selected: SELECTED_STYLE },
    hidden: true
  });
  wheelOneRow(list);
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, height: 1, width: '100%',
    content: '',
    input: true, // keyable: receives keypresses while in command mode
    style: STATUS_BAR_STYLE, hidden: true
  });

  let entries = [];     // one per list row: { name, label, root }
  let lastSelected = 0;

  function describe(root) {
    if (!root || !isDirectory(root)) return '';
    try {
      const c = countTasks(root);
      return `todo:${c.todo} done:${c.done} pending:${c.pending}`;
    } catch (e) { return ''; }
  }

  // Flatten the tree into rows, as in the web UI: each origin, its works beneath it, and each
  // work's repositories beneath that, drawn with tree glyphs; works without an origin come last,
  // at the top level. An origin row has no folder of its own (root is null).
  function buildEntries(works, origins) {
    const groups = new Map((origins || []).map(o => [o.origin, []]));
    for (const w of works) {
      const origin = w.origin || '';
      if (!groups.has(origin)) groups.set(origin, []);
      groups.get(origin).push(w);
    }
    const named = [...groups].filter(([origin]) => origin);
    const rows = [];
    const addWork = (w, prefix, glyph) => {
      rows.push({ name: prefix + glyph + w.work, label: w.work, root: w.root, work: w.work });
      const inner = prefix + (glyph === '├─ ' ? '│  ' : glyph ? '   ' : '');
      w.repositories.forEach((p, i) => {
        const g = (i === w.repositories.length - 1) ? '└─ ' : '├─ ';
        rows.push({ name: inner + g + p.name, label: `${w.work} / ${p.name}`, root: p.root, work: w.work, repository: p.name });
      });
    };
    for (const [origin, list] of named) {
      rows.push({ name: origin, label: origin, root: null, origin, works: list.length });
      list.forEach((w, i) => addWork(w, '', (i === list.length - 1) ? '└─ ' : '├─ '));
    }
    for (const w of groups.get('') || []) addWork(w, '', '');
    return rows;
  }

  function render() {
    entries = buildEntries(config.getWorks(), config.getOrigins());
    header.setContent('  Origins');
    const infos = entries.map(e => describe(e.root));
    const nameWidth = Math.max(4, ...entries.map(e => displayWidth(e.name)));
    const infoWidth = Math.max(4, ...infos.map(displayWidth));
    list.setItems(entries.map((e, i) =>
      `  ${padToWidth(e.name, nameWidth)}  ${padToWidth(infos[i], infoWidth)}  ${e.origin ? '' : e.root || '(no tasks folder)'}`));
    list.select(Math.min(lastSelected, Math.max(0, entries.length - 1)));
    showStatus();
  }

  function showStatus() {
    statusBar.setContent(`enter: open  d: remove  e: edit config  r: refresh  :h help  :q quit  \`${config.configPath}\``);
    screen.render();
  }

  function show() {
    header.show(); list.show(); statusBar.show();
    render();
    try { list.focus(); } catch (e) { }
    screen.render();
  }

  function hide() {
    lastSelected = (typeof list.selected === 'number') ? list.selected : 0;
    header.hide(); list.hide(); statusBar.hide();
    screen.render();
  }

  function openSelected() {
    const e = entries[list.selected];
    if (!e) return;
    if (!e.root) {
      statusBar.setContent(e.origin
        ? `${e.label} is an origin: pick one of its works or repositories.`
        : `${e.label} has no tasks folder of its own.`);
      screen.render();
      return;
    }
    if (!isDirectory(e.root)) {
      statusBar.setContent(`Folder not found: ${e.root}`);
      screen.render();
      return;
    }
    hide();
    onPick({ label: e.label, root: e.root });
  }

  list.key(['enter', 'l', 'right'], openSelected);
  clickToOpen(list, openSelected);

  // d: remove the selected origin, work or repository from taskmgr.json once confirmed with y.
  // Its folders are left as they are, as in the web UI.
  let confirmBox = null;
  function closeConfirm() {
    if (!confirmBox) return;
    try { confirmBox.destroy(); } catch (e) { }
    confirmBox = null;
    try { list.focus(); } catch (e) { }
    screen.render();
  }

  list.key('d', () => {
    const e = entries[list.selected];
    if (!e || confirmBox) return;
    const what = e.origin
      ? `origin "${e.origin}"` + (e.works ? ` and its ${e.works} work${e.works > 1 ? 's' : ''}` : '')
      : e.repository ? `repository "${e.repository}" of "${e.work}"` : `work "${e.work}" and its repositories`;
    const text = ` Remove ${what} from taskmgr.json?\n The folders are kept.\n\n y: remove   n / esc: cancel`;
    confirmBox = blessed.box({
      parent: screen,
      width: Math.min(screen.width - 2, Math.max(44, ...text.split('\n').map(displayWidth)) + 4),
      height: 6,
      content: text,
      border: { type: 'line' },
      style: { fg: 'white', bg: 'black', border: { fg: MODAL_BORDER_COLOR } }
    });
    confirmBox.top = Math.max(0, Math.floor((screen.height - 6) / 2));
    confirmBox.left = Math.max(0, Math.floor((screen.width - confirmBox.width) / 2));
    confirmBox.key(['n', 'escape', 'q'], closeConfirm);
    confirmBox.key('y', () => {
      closeConfirm();
      try {
        if (e.origin) config.removeOrigin(e.origin);
        else if (e.repository) config.removeRepository(e.work, e.repository);
        else config.removeWork(e.work);
      } catch (err) {
        statusBar.setContent(`Cannot remove: ${err.message}`);
        screen.render();
        return;
      }
      render();
      statusBar.setContent(`Removed ${what} from taskmgr.json.`);
      screen.render();
    });
    try { confirmBox.focus(); } catch (err) { }
    screen.render();
  });

  list.key('r', () => render());

  // Edit taskmgr.json in the editor, suspending the TUI; the tree is re-read afterwards.
  list.key('e', () => {
    const { spawnSync } = require('child_process');
    const { cmd, args } = getEditorCommand(config.configPath, { atEnd: false });
    try { screen.leave(); } catch (e) { }
    const result = spawnSync(cmd, args, { stdio: 'inherit' });
    try {
      if (typeof screen.enter === 'function') screen.enter();
      else if (screen.program && typeof screen.program.enter === 'function') screen.program.enter();
    } catch (e) { }
    try { screen.realloc(); } catch (e) { }
    render();
    if (result.error) {
      statusBar.setContent(`Cannot start editor "${cmd}": ${result.error.code || result.error.message}`);
      screen.render();
    }
  });

  const HELP_TEXT = [
    ' taskmgr Origins tree',
    '',
    '  j / k, up / down   move between origins, works and repositories',
    '  enter / l / right  open its tasks',
    '  e                  edit taskmgr.json',
    '  d                  remove the origin, work or repository from taskmgr.json (asks first)',
    '  r                  refresh the tree',
    '  :                  command mode  (:h or :help shows this)',
    '  :q / :quit         quit',
    '',
    ' press q, esc or enter to close'
  ].join('\n');

  let helpBox = null;
  function closeHelp() {
    if (!helpBox) return;
    try { helpBox.destroy(); } catch (e) { }
    helpBox = null;
    try { list.focus(); } catch (e) { }
    screen.render();
  }

  const commandLine = createCommandLine(screen, statusBar, {
    onRun(cmd) {
      if (cmd === 'h' || cmd === 'help') helpBox = createHelpBox(screen, HELP_TEXT, closeHelp);
      else if (cmd === 'q' || cmd === 'quit') quit(screen);
      else return false;
    },
    onExit() {
      try { list.focus(); } catch (e) { }
      showStatus();
    }
  });

  list.key(':', () => commandLine.enter());

  return { show, hide };
}

// The task list of one folder. Created once; open(root, label) shows it for that folder.
// `h` at the top of the folder calls onBack (when given) after hiding the view.
function createTaskView(screen, onBack) {
  let cwd = process.cwd();
  let initialRoot = cwd; // do not allow navigating above this directory
  let spaceLabel = '';   // "work" or "work / repository" when opened from the picker
  let active = false;

  // Header row (always visible while the view is active)
  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, height: 1, width: '100%',
    content: '     id            origin    edit_at       task',
    hidden: true
  });

  const list = blessed.list({
    parent: screen,
    top: 1, left: 0, width: '100%', height: '100%-1',
    keys: true, vi: true, mouse: true,
    style: { selected: SELECTED_STYLE },
    hidden: true
  });

  // status bar shown at the bottom of the screen
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, height: 1, width: '100%',
    content: '',
    input: true, // keyable: receives keypresses while in command mode
    style: STATUS_BAR_STYLE,
    hidden: true
  });

  function updateStatusBar(tasks) {
    if (commandLine.isActive()) return; // keep the typed command visible
    const ts = tasks || list.tasksData || [];

    // Show: <counters> [work / repository] `path-to-task-folder` <editor>
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
    const spaceString = spaceLabel ? ` [${spaceLabel}]` : '';
    const pathString = ' ' + '`' + cwd + '`';
    const { missing } = getEditorInfo();
    const editorString = ' ' + editor + (missing ? ` (EDITOR=${missing} not found)` : '');
    statusBar.setContent(counterString + spaceString + pathString + editorString);
    try { screen.render(); } catch (e) { }
  }

  // persistent no-tasks box (hidden by default)
  const noTasksBox = blessed.box({
    parent: screen,
    top: 'center', left: 'center', width: 'shrink', height: 'shrink',
    content: 'No tasks found. Press `a` to add a task, or `:q` to quit.',
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

  function open(root, label) {
    cwd = root;
    initialRoot = root;
    spaceLabel = label || '';
    active = true;
    try { header.show(); } catch (e) { }
    try { list.show(); } catch (e) { }
    try { statusBar.show(); } catch (e) { }
    refresh(0);
    try { list.focus(); } catch (e) { }
    screen.render();
  }

  function close() {
    active = false;
    for (const w of [header, list, statusBar, noTasksBox]) {
      try { w.hide(); } catch (e) { }
    }
    screen.render();
  }

  // Shortcuts of this view only fire while it is shown (the picker shares the screen).
  function taskKey(keys, fn) {
    screen.key(keys, (...a) => { if (!active) return; fn(...a); });
  }

  // Open a task file in the editor, suspending the TUI while it runs.
  // Returns false (and shows a message) if the editor could not be started.
  function openInEditor(taskPath) {
    const { spawnSync } = require('child_process');
    const { cmd, args } = getEditorCommand(taskPath);
    try { ensureTaskFile(taskPath); } catch (e) { }  // folder-only task: write its file first
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
    normalizeTaskFile(taskPath);
    renameTaskByFirstLine(taskPath);
    return true;
  }

  // Shortcuts
  // 1. Exit the application (also from the picker); :q / :quit go through the command line
  screen.key('C-c', () => quit(screen));

  // 2. Refresh the task list
  taskKey('l', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    refresh(list.selected);
  });

  // 3. Refresh the task list
  taskKey('r', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;

    const sel = (typeof list.selected === 'number') ? list.selected : 0;
    // Re-render the blessed UI and refresh the list — do NOT clear the raw terminal buffer
    try { refresh(sel); } catch (e) { try { screen.render(); } catch (err) { /* ignore */ } }
  });

  // 4. Add a new task: a large centered "New task" box where the whole task.txt is typed, as in
  // the web UI: the first line is the name, the rest are the details. As in vim, esc leaves
  // typing, then :wq (or :w, :x, ctrl-s anywhere) creates the folder "<id> <name>" (id = current
  // minute, bumped if that id is already taken) and :q cancels; i or a goes back to typing.
  // Keys are read directly (no blessed textarea) so CJK input draws correctly.
  let newBox = null;
  let newHint = null;
  let newText = '';
  let newMode = 'insert'; // 'insert' (typing), 'normal' (after esc) or 'command' (after :)
  let newCommand = '';
  let isNaming = false;

  const NEW_HINTS = {
    insert: '-- INSERT --  first line: name, then details    esc then :wq save  :q cancel',
    normal: 'i: back to typing  :wq save  :q cancel'
  };

  // The last `width` display cells of s, so the end of a long line stays in view.
  function tailToWidth(s, width) {
    let out = '';
    let cur = 0;
    for (const ch of [...s].reverse()) {
      const w = isCJKChar(ch) ? 2 : 1;
      if (cur + w > width) break;
      out = ch + out;
      cur += w;
    }
    return out;
  }

  function drawNewTask() {
    // 80% x 70% of the whole window, centered (blessed's 'center' sits half a row low)
    const width = Math.max(20, Math.floor(screen.width * 0.8));
    const height = Math.max(8, Math.floor(screen.height * 0.7));
    newBox.width = width;
    newBox.height = height;
    newBox.top = Math.max(0, Math.floor((screen.height - height) / 2));
    newBox.left = Math.max(0, Math.floor((screen.width - width) / 2));

    // border + padding take 2 cells a side; the bottom row holds the hint
    const innerWidth = width - 4;
    const rows = height - 3;
    const lines = newText.split('\n');
    const shown = lines.slice(-rows).map(l => tailToWidth(l, innerWidth - 1));
    newBox.setContent(shown.join('\n'));
    newHint.setContent(newMode === 'command' ? ':' + newCommand : NEW_HINTS[newMode]);
    try { screen.render(); } catch (e) { }
    // put the terminal cursor after the typed text, or after the command being typed
    try {
      const onCommand = newMode === 'command';
      const row = onCommand ? newBox.atop + height - 2 : newBox.atop + 1 + shown.length - 1;
      const col = newBox.aleft + 2 + (onCommand ? 1 + displayWidth(newCommand) : displayWidth(shown[shown.length - 1]));
      screen.program.cup(row, col);
      screen.program.showCursor();
    } catch (e) { }
  }

  function closeNewTask() {
    isNaming = false;
    newText = '';
    screen.grabKeys = false;
    if (newBox) {
      try { newBox.destroy(); } catch (e) { }
      newBox = null;
      newHint = null;
    }
    try { screen.program.hideCursor(); } catch (e) { }
    try { list.focus(); } catch (e) { }
    try { screen.render(); } catch (e) { }
  }

  function saveNewTask() {
    const text = newText.replace(/\s+$/, '');
    closeNewTask();
    if (!text.trim()) return;
    createTask(cwd, text + '\n');
    refresh();
  }

  function openNewTask() {
    isNaming = true;
    newText = '';
    newMode = 'insert';
    newCommand = '';
    screen.grabKeys = true; // suppress all screen-level shortcuts while typing
    newBox = blessed.box({
      parent: screen,
      label: ' New task ',
      padding: { left: 1, right: 1 },
      wrap: false,
      border: { type: 'line' },
      style: { fg: 'white', bg: 'black', border: { fg: MODAL_BORDER_COLOR } }
    });
    // the bottom row: the mode's hint, or the : command being typed
    newHint = blessed.box({
      parent: newBox,
      bottom: 0, left: 0, right: 0, height: 1,
      style: { fg: 'gray', bg: 'black' }
    });
    newBox.on('keypress', (ch, key) => {
      if (!isNaming) return;
      const name = (key && key.name) || '';
      if (name === 'return') return; // blessed emits 'return' and 'enter' for the same key
      if (key && key.ctrl && name === 'c') { closeNewTask(); return; }
      if (key && key.ctrl && name === 's') { saveNewTask(); return; }

      if (newMode === 'command') {
        if (name === 'escape' || (name === 'backspace' && !newCommand)) {
          newMode = 'normal';
        } else if (name === 'enter') {
          const cmd = newCommand.trim();
          newCommand = '';
          newMode = 'normal';
          if (['w', 'wq', 'x', 'wq!', 'x!'].includes(cmd)) { saveNewTask(); return; }
          if (['q', 'q!'].includes(cmd)) { closeNewTask(); return; }
        } else if (name === 'backspace') {
          newCommand = newCommand.slice(0, -1);
        } else if (ch && !/^[\x00-\x1f\x7f]$/.test(ch)) {
          newCommand += ch;
        }
        drawNewTask();
        return;
      }

      if (newMode === 'normal') {
        if (ch === ':') { newMode = 'command'; newCommand = ''; }
        else if (ch === 'i' || ch === 'a' || ch === 'o' || name === 'enter') {
          if (ch === 'o') newText += '\n';
          newMode = 'insert';
        }
        drawNewTask();
        return;
      }

      if (name === 'escape') {
        newMode = 'normal';
        drawNewTask();
        return;
      }
      if (name === 'enter') {
        newText += '\n';
        drawNewTask();
        return;
      }
      if (name === 'backspace') {
        newText = [...newText].slice(0, -1).join('');
        drawNewTask();
        return;
      }
      if (key && (key.ctrl || key.meta)) return;
      if (ch && !/^[\x00-\x1f\x7f]$/.test(ch)) {
        newText += ch;
        drawNewTask();
      }
    });
    try { list.blur(); } catch (e) { }
    try { newBox.focus(); } catch (e) { }
    drawNewTask();
  }

  taskKey(['a', 'n'], () => {
    if (isPreviewing || isNaming || commandLine.isActive()) return;
    openNewTask();
  });

  // 5. Edit a task
  function editSelected() {
    // Close preview if it's open
    if (isPreviewing) {
      closePreview();
    }

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) {
      const ok = openInEditor(t.path);
      try { list.focus(); } catch (e) { }
      if (ok) refresh(list.selected);
    }
  }
  taskKey('e', editSelected);
  taskKey('i', editSelected);

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
    ...(onBack ? ['  h at the top       back to the Origins tree'] : []),
    '  a / n              add a task (type task.txt: first line name; esc :wq saves, :q cancels)',
    '  e / i              edit the selected task',
    '  space              preview task details',
    '  enter              open the task folder',
    '  x                  mark done / undone',
    '  p                  mark pending / todo',
    '  d                  delete the selected task',
    '  r                  refresh the task list',
    '  :                  command mode  (:h or :help shows this)',
    onBack ? '  :q / :quit         back to the Origins tree' : '  :q / :quit         quit',
    '',
    ' press q, esc or enter to close'
  ].join('\n');

  function showHelp() {
    if (isPreviewing) closePreview();
    try { list.blur(); } catch (e) { }
    previewBox = createHelpBox(screen, HELP_TEXT, closePreview);
    isPreviewing = true; // reuse the preview guards so other shortcuts stay inactive
  }

  // 6.2. Command mode, vim style: ':' turns the status bar into a command line.
  const commandLine = createCommandLine(screen, statusBar, {
    onRun(cmd) {
      if (cmd === 'h' || cmd === 'help') showHelp();
      else if (cmd === 'q' || cmd === 'quit') {
        // opened from the work / repository tree: go back to it; `tm <folder>`: quit
        if (onBack) {
          close();
          onBack();
        } else quit(screen);
      } else return false;
    },
    onExit() {
      try { list.focus(); } catch (e) { }
      updateStatusBar();
    }
  });

  taskKey(':', () => {
    if (isPreviewing || commandLine.isActive()) return;
    commandLine.enter();
  });

  taskKey('space', () => {
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
      style: { fg: 'white', bg: 'black', border: { fg: MODAL_BORDER_COLOR } }
    });
    // mark preview as active
    isPreviewing = true;

    // Close preview with common keys and restore focus
    previewBox.key(['q', 'escape', 'enter', 'space'], closePreview);

    // Ensure list doesn't capture keys while preview is open
    try { list.blur(); } catch (e) { }
    try { previewBox.focus(); } catch (e) { }
    try { screen.render(); } catch (e) { }
  });

  // Toggle a status on the selected task and keep it selected in the new ordering.
  function toggleStatus(status) {
    const tasks = list.tasksData || readTasks(cwd);
    const cur = (typeof list.selected === 'number') ? list.selected : 0;
    const t = tasks[cur];
    if (!t) return;
    const id = t.id;

    // the status is the folder the task is in, so this moves it
    try {
      markTask(t, (t.status || '').toLowerCase() !== status ? status : 'todo');
    } catch (e) {
      statusBar.setContent(e.message);
    }

    // refresh list and re-select the same task by id in new ordering
    refresh();
    const newTasks = list.tasksData || readTasks(cwd);
    const idx = newTasks.findIndex(x => x.id === id);
    const sel = idx >= 0 ? idx : Math.min(cur, newTasks.length - 1);
    try { list.select(sel); } catch (e) { }
    try { screen.render(); } catch (e) { }
  }

  // 6.5. Toggle pending status with 'p' — mark pending/todo and refresh ordering
  taskKey('p', () => {
    // do not toggle pending if preview is open
    if (isPreviewing) return;
    toggleStatus('pending');
  });

  // 7. Open current task folder (enter or a left click on the row)
  function openSelected() {
    // do not open if preview is open
    if (isPreviewing) return;

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) { openTask(t); }
  }
  taskKey('enter', openSelected);
  clickToOpen(list, openSelected);

  // 8. Delete a task
  taskKey('d', () => {
    // do not delete if preview is open
    if (isPreviewing) return;

    const tasks = list.tasksData || readTasks(cwd);
    const t = tasks[list.selected];
    if (t) {
      deleteTask(t);
      refresh(Math.max(0, list.selected - 1));
    }
  });

  // 8.5. Mark task as done
  taskKey('x', () => {
    // do not toggle done if preview is open
    if (isPreviewing) return;
    toggleStatus('done');
  });

  // 9. Change current working directory
  // - Right arrow / l: change cwd into the selected task's folder (the directory containing the task file)
  // - Left arrow / h: go up to the parent directory; at the top, back to the picker (when there is one)
  taskKey(['right', 'l'], () => {
    // do not navigate if preview is open
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

  taskKey(['left', 'h'], () => {
    // do not navigate if preview is open
    if (isPreviewing) return;

    try {
      if (cwd === initialRoot) {
        // top of this folder: never move above it; go back to the Origins tree instead
        if (onBack) {
          close();
          onBack();
        }
        return;
      }
      // up to the list the task is in, past its "done" / "pending" folder
      const parent = listDirOf(cwd);
      if (!parent || parent === cwd) return;
      // prevent moving above the initial root directory where the program started
      const rel = path.relative(initialRoot, parent);
      if (rel === '' || (!rel.startsWith('..'))) {
        // parent is inside or equal to initialRoot -> allow
        cwd = parent;
        refresh(0);
      }
    } catch (e) { /* ignore */ }
  });

  wheelOneRow(list);

  return { open, close };
}

const USAGE = `Usage: tm [<folder> | config | push | help]

  tm              pick a work and a repository from taskmgr.json, then open its tasks
  tm <folder>     open that folder as a task list (e.g. tm . or tm ~/tasks)
  tm config       open taskmgr.json in the editor (created from taskmgr.json.example if missing)
  tm push         push taskmgr.json and the tasks folders to the server of taskmgrd now (TASKMGRD_SERVER in .env)
  tm help         show this help (also -h, --help)

To open a folder named "config", "push" or "help", prefix it: tm ./config

The editor is EDITOR (or VISUAL) from .env / the environment; default: ${process.platform === 'win32' ? 'notepad' : 'vim'}.
Config file: ${DEFAULT_CONFIG_PATH}.
Inside the task list, type :h for the key bindings.`;

// `tm config`: open the config file in the editor. A missing config is first created from
// taskmgr.json.example, so a fresh install can be configured right away.
function editConfig() {
  const configPath = DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, configPath);
      console.log(`Created ${configPath} from taskmgr.json.example`);
    } else {
      console.error(`Config file not found: ${configPath}.`);
      process.exit(1);
    }
  }
  const { spawnSync } = require('child_process');
  const { cmd, args } = getEditorCommand(configPath, { atEnd: false });
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Cannot start editor "${cmd}": ${result.error.code || result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

// `tm push`: what the sync daemon does, once and in the foreground: push what differs from the
// server, report it, and exit (non-zero when the push failed).
function pushNow() {
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'taskmgrd.js'), '--once'], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'help' || command === '-h' || command === '--help') {
    console.log(USAGE);
    return;
  }
  if (command === 'config') {
    editConfig();
    return;
  }
  if (command === 'push') {
    pushNow();
    return;
  }

  // `tm <folder>`: open that folder as a task list.
  if (args.length > 0) {
    const providedPath = args[0];
    // Resolve the path (handles relative paths)
    const resolvedPath = path.resolve(providedPath);

    // Check if the path exists and is a directory
    try {
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        console.error(`Error: "${providedPath}" is not a valid directory. Run \`tm help\` for usage.`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: Cannot access "${providedPath}": ${error.message}`);
      process.exit(1);
    }

    const screen = createScreen();
    createTaskView(screen, null).open(resolvedPath, '');
    return;
  }

  // `tm`: pick a work or one of its repositories from the taskmgr.json tree, then open its folder.
  let config;
  try {
    config = resolveConfig();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    console.error('Run `tm config` to edit the config, or `tm <folder>` (for example `tm .`) to open a folder of tasks directly.');
    process.exit(1);
  }

  const screen = createScreen();
  const taskView = createTaskView(screen, () => picker.show());
  const picker = createWorkPicker(screen, config, (space) => taskView.open(space.root, space.label));
  picker.show();
}

main();
