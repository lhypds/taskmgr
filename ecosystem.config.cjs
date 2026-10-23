// pm2 apps, started together by ./start.sh (`pm2 start ecosystem.config.cjs`): the web UI, named
// PM2_NAME in .env, and taskmgrd, the sync daemon (taskmgrd.js), when REMOTE_SERVER is set there.
// With REMOTE_SERVER empty (a machine that only runs the web UI, or does not sync) the daemon is left
// out. What it does once started is PUSHING and POLLING in .env; with both off it stops itself.
const fs = require('fs');
const path = require('path');

function readEnv() {
  try {
    return fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  } catch {
    return '';
  }
}

// The value of KEY in .env; the default when the line is missing or its value empty.
function getEnvVar(key, defaultValue) {
  const match = readEnv().match(new RegExp(`^${key}=(.*)$`, 'm'));
  const value = match ? match[1].trim() : '';
  return value || defaultValue;
}

const PORT = getEnvVar('PORT', '3456');
const PM2_NAME = getEnvVar('PM2_NAME', 'taskmgr');
const REMOTE_SERVER = getEnvVar('REMOTE_SERVER', '');

const webui = {
  name: PM2_NAME,
  script: 'server/index.js',
  cwd: __dirname,
  time: true,
  env: {
    PORT: PORT,
    NODE_ENV: 'production',
  },
};

const taskmgrd = {
  name: 'taskmgrd',
  script: 'taskmgrd.js',
  cwd: __dirname,
  time: true,
  // A wrong .env makes it exit at once: wait between restarts instead of spinning.
  restart_delay: 5000,
  // It exits with 0 when .env gives it nothing to do (PUSHING=0 and POLLING=0): left stopped then.
  stop_exit_codes: [0],
};

module.exports = {
  apps: REMOTE_SERVER ? [webui, taskmgrd] : [webui],
};
