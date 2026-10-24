// `tm run <work | repository | work/repository | folder>:<task id>`: start Claude Code on a task.
//
// Before the colon is where the task is: a work of taskmgr.json (its common tasks), a repository of
// any work ("work/repository" when several works have a repository of that name, "work/" for the
// common tasks of a work that also names a repository), or a path to a folder of tasks, as `tm <folder>`
// opens one (the two may also be given as two arguments, `tm run develop 202610241655`). The task is
// looked for there by its id, in its status folders and among the subtasks too.
// Its task.txt, its prompt.txt (when it has one) and the list of its other files make one prompt, and
// `claude` is started with it: in the repository's source folder when the task is a repository's, so
// Claude works on the code, else in the task folder; the task folder is added with --add-dir so its
// files can be read either way. Any further arguments go to claude as they are (`-p`, `--model opus`,
// ...); --dry-run prints the folder, the command and the prompt instead of running claude.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  TASK_FILE,
  PROMPT_FILE,
  STATUS_DIRS,
  isTaskFolder,
  readTaskDir,
  readTasks,
  readPrompt,
  folderId
} = require('./utils/taskUtils');
const { resolveConfig } = require('./server/config');

const USAGE = `Usage: tm run <work | repository | work/repository | folder>:<task id> [--dry-run] [claude options...]

  Starts Claude Code (\`claude\`) on a task, e.g. tm run develop:202610241655: its task.txt, its prompt.txt
  (if any) and the list of its other files make the first prompt. A repository's task runs in the
  repository's source folder (source_path in taskmgr.json), any other task in its own folder; the task
  folder is always readable (--add-dir).
  Before the colon: a work (its common tasks), a repository, "work/repository" when several works have a
  repository of that name, or a path to a folder of tasks. After it: the task's 12-digit id (subtasks and
  done / pending / aborted tasks included). The two may also be two arguments: tm run develop 202610241655,
  and the id may then be a path to the task folder.
  Options after them go to claude as they are, e.g. -p (print and exit) or --model opus.
  --dry-run shows the folder, the command and the prompt without running claude.`;

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// Quote a path or name for a command shown to the user.
function q(s) {
  return /[\s"'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function samePath(a, b) {
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };
  return real(a) === real(b);
}

// Every folder of tasks named in taskmgr.json, as { work, repository, label, root, sourcePath }: a
// work's common tasks (repository "", root "" when it has no tasks_path) and each repository's.
function configuredSpaces() {
  let works;
  try {
    works = resolveConfig().getWorks();
  } catch (e) {
    return { spaces: [], error: e.message };
  }
  const spaces = [];
  for (const w of works) {
    spaces.push({ work: w.work, repository: '', label: w.work, root: w.root, sourcePath: '' });
    for (const p of w.repositories) {
      spaces.push({ work: w.work, repository: p.name, label: `${w.work}/${p.name}`, root: p.root, sourcePath: p.sourcePath });
    }
  }
  return { spaces, error: null };
}

// How a space is named on the command line: "work/" for the common tasks of a work (never mistaken
// for a repository), "work/repository" for a repository's.
function spaceArg(s) {
  return s.repository ? `${s.work}/${s.repository}` : `${s.work}/`;
}

// The space the first argument names: a work, a repository, "work/repository" or "work/" of
// taskmgr.json (names first, exactly, then ignoring case), else a folder of tasks that exists (a folder
// named like a work: prefix it, ./work). A folder that is a configured tasks folder is that space, so a
// repository's tasks run in its source folder however the folder is named.
function resolveSpace(arg) {
  const { spaces, error } = configuredSpaces();
  const asDir = path.resolve(arg);

  const slash = arg.indexOf('/');
  const byName = (same) => {
    if (slash >= 0) {
      const work = arg.slice(0, slash).trim();
      const repository = arg.slice(slash + 1).trim();
      return spaces.filter(s => same(s.work, work) && same(s.repository, repository));
    }
    return spaces.filter(s => (same(s.work, arg) && !s.repository) || (s.repository && same(s.repository, arg)));
  };
  let matches = byName((a, b) => a === b);
  if (matches.length === 0) matches = byName((a, b) => a.toLowerCase() === b.toLowerCase());

  if (matches.length > 1) {
    fail(`"${arg}" names ${matches.length} folders of tasks; say which:\n` + matches.map(s => `  tm run ${q(spaceArg(s) + ':<id>')}`).join('\n'));
  }
  if (matches.length === 1) {
    const s = matches[0];
    if (!s.root) {
      const repos = spaces.filter(x => x.work === s.work && x.repository);
      fail(`Work "${s.work}" has no tasks folder of its own (no tasks_path in taskmgr.json).`
        + (repos.length ? ` Its repositories:\n` + repos.map(x => `  tm run ${q(spaceArg(x) + ':<id>')}`).join('\n') : ''));
    }
    return s;
  }

  if (isDirectory(asDir)) {
    return spaces.find(s => s.root && samePath(s.root, asDir))
      || { work: '', repository: '', label: asDir, root: asDir, sourcePath: '' };
  }
  if (error) fail(`${error}\nGive a folder of tasks instead (tm run <folder>:<id>), or fix taskmgr.json with \`tm config\`.`);
  fail(`No work or repository named "${arg}" in taskmgr.json, and no such folder. Works and repositories:\n`
    + spaces.filter(s => s.root).map(s => `  ${s.label}`).join('\n'));
}

// Every task folder listed in dir, with the subtasks inside each, depth first (status folders included).
function* taskDirsUnder(dir) {
  for (const t of readTasks(dir)) {
    const taskDir = path.dirname(t.path);
    yield taskDir;
    yield* taskDirsUnder(taskDir);
  }
}

// The folder of the task `arg` names in the space: the task (or subtask) with that id or exactly that
// folder name, else a path to a task folder.
function findTaskDir(space, arg) {
  if (!isDirectory(space.root)) fail(`Folder not found: ${space.root}`);
  const found = [];
  for (const d of taskDirsUnder(space.root)) {
    const name = path.basename(d);
    if (folderId(name) === arg || name === arg) found.push(d);
  }
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    const spaceName = space.work ? spaceArg(space) : space.root;
    fail(`${found.length} tasks in ${space.label} have the id ${arg}; give the folder instead:\n`
      + found.map(d => `  tm run ${q(spaceName)} ${q(d)}`).join('\n'));
  }
  const asDir = path.resolve(arg);
  if (isTaskFolder(asDir)) return asDir;
  fail(`No task ${arg} in ${space.label} (${space.root}).`);
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// The task's other files, as the web UI lists them: not task.txt, prompt.txt, dot files or the status
// folders (which hold subtasks); a folder that is a task is a subtask. Folders first, then by name.
function listFiles(taskDir) {
  let entries;
  try { entries = fs.readdirSync(taskDir, { withFileTypes: true }); } catch (e) { return []; }
  const files = [];
  for (const e of entries) {
    if (e.name === TASK_FILE || e.name === PROMPT_FILE || e.name.startsWith('.')) continue;
    if (e.isDirectory() && STATUS_DIRS.includes(e.name)) continue;
    const abs = path.join(taskDir, e.name);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (err) { /* ignore */ }
    files.push({ name: e.name, isDir: e.isDirectory(), isSubtask: e.isDirectory() && isTaskFolder(abs), size });
  }
  files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return files;
}

// A text without its leading and trailing blank lines.
function trimBlank(text) {
  return (text || '').replace(/^(\s*\n)+/, '').replace(/\s+$/, '');
}

// The first prompt for claude: what to do, the task text, the prompt text, and where the files are.
function buildPrompt(space, task, prompt, taskDir, cwd) {
  const where = space.repository
    ? `repository "${space.repository}" of work "${space.work}"`
    : space.work ? `work "${space.work}"` : `folder ${space.root}`;
  const files = listFiles(taskDir);
  const out = [];
  out.push(`Task ${task.id} from tm, the task manager (${where}).`);
  out.push(prompt !== null
    ? 'Do what its prompt says; the task text is the context.'
    : 'Do what the task says.');
  out.push('');
  out.push('## Task (task.txt)');
  out.push(trimBlank(task.details) || '(empty)');
  if (prompt !== null) {
    out.push('');
    out.push('## Prompt (prompt.txt)');
    out.push(trimBlank(prompt) || '(empty)');
  }
  out.push('');
  out.push('## Task folder');
  out.push(taskDir);
  if (files.length) {
    out.push('Its other files (read the ones you need):');
    for (const f of files) {
      const note = f.isSubtask ? 'subtask' : f.isDir ? 'folder' : formatSize(f.size);
      out.push(`- ${f.name}${f.isDir ? '/' : ''} (${note})`);
    }
  } else {
    out.push('It has no other files.');
  }
  if (!samePath(cwd, taskDir)) {
    out.push('');
    out.push(`Working folder: ${cwd}, the source code of the repository.`);
  }
  return out.join('\n') + '\n';
}

// For cmd.exe: quote an argument with spaces or special characters (Node does not, with shell: true).
function winQuote(s) {
  return /[\s"&|<>^()%]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

// Start claude in cwd with the prompt as its first message; returns its exit status. On Windows, an npm
// install's claude.cmd cannot be spawned directly (EINVAL) and cmd.exe takes no newlines in a command
// line, so the prompt is written to a temporary file and claude is asked to read it.
function runClaude({ cwd, taskDir, task, prompt, extra, dryRun }) {
  const args = [...extra];
  if (!samePath(cwd, taskDir)) args.push(`--add-dir=${taskDir}`);

  if (dryRun) {
    console.log(`cd ${q(cwd)}`);
    console.log(['claude', ...args.map(q), '"<the prompt below>"'].join(' '));
    console.log('');
    console.log(prompt);
    return 0;
  }

  let r = spawnSync('claude', [...args, prompt], { cwd, stdio: 'inherit' });
  if (r.error && r.error.code === 'EINVAL' && process.platform === 'win32') {
    const tmp = path.join(os.tmpdir(), `tm-run-${task.id}-${Date.now()}.md`);
    fs.writeFileSync(tmp, prompt, 'utf8');
    try {
      r = spawnSync('claude', [...args, `Read the file ${tmp} and do what it says.`].map(winQuote), { cwd, stdio: 'inherit', shell: true });
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    }
  }
  if (r.error) {
    if (r.error.code === 'ENOENT') fail('claude not found on PATH. Install Claude Code first (https://claude.com/claude-code).');
    fail(`Cannot start claude: ${r.error.code || r.error.message}`);
  }
  return r.status === null ? 1 : r.status;
}

// "develop:202610241655" split at its last colon (a Windows drive letter's stays with the folder),
// or the first two arguments. Returns { spaceName, idArg, rest }.
function parseTarget(args) {
  const first = args[0];
  const colon = first.lastIndexOf(':');
  // "C:\tasks" alone has its colon at index 1: that is a folder, not a space and an id
  if (colon > 1 || (colon === 1 && !/^[A-Za-z]$/.test(first[0]))) {
    return { spaceName: first.slice(0, colon), idArg: first.slice(colon + 1), rest: args.slice(1) };
  }
  if (args.length < 2) fail(`Missing the task id: tm run ${first}:<id>\n\n${USAGE}`);
  return { spaceName: first, idArg: args[1], rest: args.slice(2) };
}

function main(args) {
  if (args.length === 0 || ['-h', '--help', 'help'].includes(args[0])) {
    console.log(USAGE);
    process.exit(args.length === 0 ? 1 : 0);
  }
  const { spaceName, idArg, rest } = parseTarget(args);
  if (!spaceName || !idArg) fail(`Say where the task is and its id: tm run <work | repository | folder>:<id>\n\n${USAGE}`);
  const dryRun = rest.includes('--dry-run');
  const extra = rest.filter(a => a !== '--dry-run');

  const space = resolveSpace(spaceName);
  const taskDir = findTaskDir(space, idArg);
  const task = readTaskDir(taskDir);
  const prompt = readPrompt(taskDir);

  let cwd = taskDir;
  if (space.sourcePath) {
    if (!isDirectory(space.sourcePath)) fail(`Source folder of ${space.label} not found: ${space.sourcePath}`);
    cwd = space.sourcePath;
  }

  const title = (task.details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || path.basename(taskDir);
  // to stderr, so `-p` leaves only claude's answer on stdout
  console.error(`tm run: ${task.id} ${title}${prompt === null ? ' (no prompt.txt: the task text is the prompt)' : ''}`);
  if (task.status !== 'todo') console.error(`Note: this task is ${task.status}.`);
  if (!dryRun) console.error(`Starting claude in ${cwd}`);

  process.exit(runClaude({ cwd, taskDir, task, prompt: buildPrompt(space, task, prompt, taskDir, cwd), extra, dryRun }));
}

module.exports = { main };
