const fs = require('fs');
const path = require('path');

function readEnv() {
  try {
    return fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  } catch {
    return '';
  }
}

function getEnvVar(key, defaultValue) {
  const match = readEnv().match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : defaultValue;
}

const PORT = getEnvVar('PORT', '3456');
const PM2_NAME = getEnvVar('PM2_NAME', 'taskmgr');
const TASKS_ROOT = getEnvVar('TASKS_ROOT', '');

module.exports = {
  apps: [
    {
      name: PM2_NAME,
      script: 'webui/server.js',
      cwd: __dirname,
      time: true,
      env: {
        PORT: PORT,
        TASKS_ROOT: TASKS_ROOT,
        NODE_ENV: 'production',
      },
    },
  ],
};
