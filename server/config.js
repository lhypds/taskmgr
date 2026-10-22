// Configuration for the web UI.
//
// taskmgr.json (next to package.json by default) lists the works and their repositories; each one
// is a folder of tasks:
//
//   {
//     "works": [
//       {
//         "work": "gcc3.com",
//         "orgin": "gcc3",                      // optional, the organization the work is for
//         "reward": "500,000 JPY / month",      // optional, what the work pays
//         "tasks_path": "~/gcc3",               // common tasks of this work
//         "repositories": [
//           {
//             "name": "repository a",
//             "tasks_path": "~/gcc3/a/tasks",   // tasks of one repository
//             "source_path": "~/gcc3/a"         // optional, its source code
//           }
//         ]
//       }
//     ]
//   }
//
// Config file precedence: command-line argument, then TASKMGR_CONFIG in .env / environment,
// then <project>/taskmgr.json. The file is re-read when it changes, so edits apply without a restart.
//
// The web UI's login accounts are in <project>/data/users.json, or TASKMGR_USERS in .env (see server/auth.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'taskmgr.json');
const EXAMPLE_CONFIG_PATH = path.join(PROJECT_ROOT, 'taskmgr.json.example');
const DEFAULT_USERS_PATH = path.join(PROJECT_ROOT, 'data', 'users.json');

function loadDotenv() {
  let dotenv = null;
  try { dotenv = require('dotenv'); } catch (e) { return; }
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(PROJECT_ROOT, '.env')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// Validate and normalize the "works" array: names trimmed, roots expanded to absolute paths,
// names unique (repositories unique within their work) so they can be used as URL segments.
function normalizeWorks(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('"works" must be a non-empty array.');
  }
  const seenWorks = new Set();
  return raw.map((w, i) => {
    if (!w || typeof w !== 'object') throw new Error(`works[${i}] must be an object.`);
    if (!isNonEmptyString(w.work)) throw new Error(`works[${i}].work must be a non-empty string.`);
    if (!isNonEmptyString(w.tasks_path)) throw new Error(`works[${i}] ("${w.work}") needs a "tasks_path" folder.`);
    const work = w.work.trim();
    if (work.includes('/')) throw new Error(`works[${i}].work "${work}" must not contain "/".`);
    if (seenWorks.has(work)) throw new Error(`Duplicate work name "${work}".`);
    seenWorks.add(work);
    if (w.orgin !== undefined && typeof w.orgin !== 'string') throw new Error(`works[${i}].orgin ("${work}") must be a string.`);
    if (w.reward !== undefined && typeof w.reward !== 'string') throw new Error(`works[${i}].reward ("${work}") must be a string.`);

    const seenRepositories = new Set();
    const repositories = (w.repositories === undefined ? [] : w.repositories);
    if (!Array.isArray(repositories)) throw new Error(`works[${i}].repositories ("${work}") must be an array.`);
    return {
      work,
      orgin: (w.orgin || '').trim(),
      reward: (w.reward || '').trim(),
      root: path.resolve(expandHome(w.tasks_path.trim())),
      repositories: repositories.map((p, j) => {
        if (!p || typeof p !== 'object') throw new Error(`works[${i}].repositories[${j}] ("${work}") must be an object.`);
        if (!isNonEmptyString(p.name)) throw new Error(`works[${i}].repositories[${j}].name ("${work}") must be a non-empty string.`);
        if (!isNonEmptyString(p.tasks_path)) throw new Error(`Repository "${p.name}" of "${work}" needs a "tasks_path" folder.`);
        const name = p.name.trim();
        if (name.includes('/')) throw new Error(`Repository name "${name}" of "${work}" must not contain "/".`);
        if (seenRepositories.has(name)) throw new Error(`Duplicate repository name "${name}" in "${work}".`);
        seenRepositories.add(name);
        if (p.source_path !== undefined && typeof p.source_path !== 'string') throw new Error(`Repository "${name}" of "${work}": "source_path" must be a string.`);
        const source = (p.source_path || '').trim();
        return {
          name,
          root: path.resolve(expandHome(p.tasks_path.trim())),
          sourcePath: source ? path.resolve(expandHome(source)) : ''
        };
      })
    };
  });
}

// Parse and validate the text of a config file.
function parseConfig(text, configPath) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${configPath}: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${configPath} must contain a JSON object.`);
  try {
    return { works: normalizeWorks(raw.works) };
  } catch (e) {
    throw new Error(`${configPath}: ${e.message}`);
  }
}

function readConfigFile(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    throw new Error(`Could not read ${configPath}: ${e.message}`);
  }
  return parseConfig(text, configPath);
}

// Where the config file is, without reading it: { configPath, source }.
// Precedence: argument, then TASKMGR_CONFIG, then <project>/taskmgr.json.
function resolveConfigPath(argv) {
  loadDotenv();

  const arg = (argv && argv.length > 0) ? argv[0] : '';
  const envPath = (process.env.TASKMGR_CONFIG || '').trim();
  let source = 'default';
  let configPath = DEFAULT_CONFIG_PATH;
  if (arg) { configPath = arg; source = 'argument'; }
  else if (envPath) { configPath = envPath; source = '.env (TASKMGR_CONFIG)'; }
  configPath = path.resolve(expandHome(configPath));
  return { configPath, source };
}

function resolveConfig(argv) {
  const { configPath, source } = resolveConfigPath(argv);

  if (!fs.existsSync(configPath)) {
    const hint = (configPath === DEFAULT_CONFIG_PATH && fs.existsSync(EXAMPLE_CONFIG_PATH))
      ? ` Copy taskmgr.json.example to taskmgr.json and list your works there.`
      : '';
    throw new Error(`Config file not found: ${configPath} (from ${source}).${hint}`);
  }

  const first = readConfigFile(configPath);
  const port = parseInt(process.env.PORT || 3456, 10);
  const host = process.env.HOST || '127.0.0.1';
  const usersPath = path.resolve(expandHome((process.env.TASKMGR_USERS || '').trim() || DEFAULT_USERS_PATH));

  // Works are re-read when the file's mtime changes; a broken edit keeps the last good list.
  let cached = { mtimeMs: fs.statSync(configPath).mtimeMs, works: first.works };
  function getWorks() {
    try {
      const mtimeMs = fs.statSync(configPath).mtimeMs;
      if (mtimeMs !== cached.mtimeMs) {
        cached = { mtimeMs, works: readConfigFile(configPath).works };
      }
    } catch (e) {
      console.error(`Warning: ${e.message} (keeping the previous configuration)`);
    }
    return cached.works;
  }

  // The config file as written, for editing in the web UI.
  function readText() {
    return fs.readFileSync(configPath, 'utf8');
  }

  // Replace the config file; an invalid one is refused and the file left as it was.
  function writeText(text) {
    const parsed = parseConfig(text, configPath);
    fs.writeFileSync(configPath, text);
    cached = { mtimeMs: fs.statSync(configPath).mtimeMs, works: parsed.works };
    return parsed.works;
  }

  // Set one work's reward ("" removes it) and rewrite the file as 2-space indented JSON.
  function setWorkReward(work, reward) {
    const raw = JSON.parse(readText());
    const w = (Array.isArray(raw.works) ? raw.works : []).find(x => x && typeof x.work === 'string' && x.work.trim() === work);
    if (!w) throw new Error(`No work named "${work}".`);
    const value = reward.trim();
    if (value) w.reward = value;
    else delete w.reward;
    return writeText(JSON.stringify(raw, null, 2) + '\n');
  }

  return { configPath, configSource: source, port, host, usersPath, getWorks, readText, writeText, setWorkReward };
}

module.exports = { resolveConfig, resolveConfigPath, DEFAULT_CONFIG_PATH, EXAMPLE_CONFIG_PATH };
