// `tm run <work | repository | work/repository | folder>:<task id>`: start Claude Code on a task, in
// the terminal.
//
// Before the colon is where the task is: a work of taskmgr.json (its common tasks), a repository of
// any work ("work/repository" when several works have a repository of that name, "work/" for the
// common tasks of a work that also names a repository), or a path to a folder of tasks, as `tm <folder>`
// opens one (the two may also be given as two arguments, `tm run develop 202610241655`). The task is
// looked for there by its id, in its status folders and among the subtasks too.
// Its task.txt, its prompt.txt (when it has one) and the list of its other files make one prompt (see
// ai/task.js, shared with the web UI's run button), and `claude` is started with it: in the
// repository's source folder when the task is a repository's, so Claude works on the code, else in
// the task folder; the task folder is added with --add-dir so its files can be read either way. Any
// further arguments go to claude as they are (`-p`, `--model opus`, ...); --dry-run prints the folder,
// the command and the prompt instead of running claude.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { q, samePath, resolveSpace, findTaskDir, describeRun } = require('./task');

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

  let space, taskDir, run;
  try {
    space = resolveSpace(spaceName);
    taskDir = findTaskDir(space, idArg);
    run = describeRun(space, taskDir);
  } catch (e) {
    fail(e.message);
  }
  const { task, title, prompt, cwd, text } = run;

  // to stderr, so `-p` leaves only claude's answer on stdout
  console.error(`tm run: ${task.id} ${title}${prompt === null ? ' (no prompt.txt: the task text is the prompt)' : ''}`);
  if (task.status !== 'todo') console.error(`Note: this task is ${task.status}.`);
  if (!dryRun) console.error(`Starting claude in ${cwd}`);

  process.exit(runClaude({ cwd, taskDir, task, prompt: text, extra, dryRun }));
}

module.exports = { main };
