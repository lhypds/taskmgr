// Configuration for the web UI.
//
// taskmgr.json (next to package.json by default) lists the works and their projects; each one
// is a folder of tasks:
//
//   {
//     "port": 3456,            // optional, PORT in .env / environment wins
//     "host": "127.0.0.1",     // optional, HOST in .env / environment wins
//     "works": [
//       {
//         "work": "gcc3.com",
//         "root": "~/gcc3",                       // common tasks of this work
//         "projects": [
//           { "name": "project a", "root": "~/gcc3/a" }   // tasks of one project
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
// names unique (projects unique within their work) so they can be used as URL segments.
function normalizeWorks(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('"works" must be a non-empty array.');
  }
  const seenWorks = new Set();
  return raw.map((w, i) => {
    if (!w || typeof w !== 'object') throw new Error(`works[${i}] must be an object.`);
    if (!isNonEmptyString(w.work)) throw new Error(`works[${i}].work must be a non-empty string.`);
    if (!isNonEmptyString(w.root)) throw new Error(`works[${i}] ("${w.work}") needs a "root" folder.`);
    const work = w.work.trim();
    if (work.includes('/')) throw new Error(`works[${i}].work "${work}" must not contain "/".`);
    if (seenWorks.has(work)) throw new Error(`Duplicate work name "${work}".`);
    seenWorks.add(work);

    const seenProjects = new Set();
    const projects = (w.projects === undefined ? [] : w.projects);
    if (!Array.isArray(projects)) throw new Error(`works[${i}].projects ("${work}") must be an array.`);
    return {
      work,
      root: path.resolve(expandHome(w.root.trim())),
      projects: projects.map((p, j) => {
        if (!p || typeof p !== 'object') throw new Error(`works[${i}].projects[${j}] ("${work}") must be an object.`);
        if (!isNonEmptyString(p.name)) throw new Error(`works[${i}].projects[${j}].name ("${work}") must be a non-empty string.`);
        if (!isNonEmptyString(p.root)) throw new Error(`Project "${p.name}" of "${work}" needs a "root" folder.`);
        const name = p.name.trim();
        if (name.includes('/')) throw new Error(`Project name "${name}" of "${work}" must not contain "/".`);
        if (seenProjects.has(name)) throw new Error(`Duplicate project name "${name}" in "${work}".`);
        seenProjects.add(name);
        return { name, root: path.resolve(expandHome(p.root.trim())) };
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
    return { works: normalizeWorks(raw.works), port: raw.port, host: raw.host };
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
  const port = parseInt(process.env.PORT || first.port || 3456, 10);
  const host = process.env.HOST || first.host || '127.0.0.1';
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
  // port and host only apply on the next start.
  function writeText(text) {
    const parsed = parseConfig(text, configPath);
    fs.writeFileSync(configPath, text);
    cached = { mtimeMs: fs.statSync(configPath).mtimeMs, works: parsed.works };
    return parsed.works;
  }

  return { configPath, configSource: source, port, host, usersPath, getWorks, readText, writeText };
}

module.exports = { resolveConfig, resolveConfigPath, DEFAULT_CONFIG_PATH, EXAMPLE_CONFIG_PATH };
