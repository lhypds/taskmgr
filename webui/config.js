// Resolve configuration for the web UI.
//
// Tasks root folder precedence (first match wins):
//   1. command-line argument:   node webui/server.js /path/to/tasks
//   2. TASKS_ROOT in .env / environment
//   3. "tasksRoot" in webui/settings.json
//   4. home folder (~/)
//
// Port / host precedence: PORT / HOST env, then settings.json, then defaults.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

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

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    console.error(`Warning: could not read ${SETTINGS_PATH}: ${e.message}`);
    return {};
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveConfig(argv) {
  loadDotenv();
  const settings = loadSettings();

  const argRoot = (argv && argv.length > 0) ? argv[0] : '';
  const envRoot = (process.env.TASKS_ROOT || '').trim();
  const settingsRoot = (typeof settings.tasksRoot === 'string') ? settings.tasksRoot.trim() : '';

  let source = 'default (home folder)';
  let root = os.homedir();
  if (argRoot) { root = argRoot; source = 'argument'; }
  else if (envRoot) { root = envRoot; source = '.env (TASKS_ROOT)'; }
  else if (settingsRoot) { root = settingsRoot; source = 'webui/settings.json (tasksRoot)'; }

  root = path.resolve(expandHome(root));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Tasks root "${root}" (from ${source}) is not a directory.`);
  }

  const port = parseInt(process.env.PORT || settings.port || 3456, 10);
  const host = process.env.HOST || settings.host || '127.0.0.1';

  return { root, rootSource: source, port, host };
}

module.exports = { resolveConfig, SETTINGS_PATH };
