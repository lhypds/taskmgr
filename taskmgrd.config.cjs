// pm2 app for taskmgrd, the sync daemon (taskmgrd.js), started by ./taskmgrd.sh.
// Separate from ecosystem.config.cjs (the web UI) since a machine usually runs one or the other.
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

module.exports = {
  apps: [
    {
      name: getEnvVar('TASKMGRD_PM2_NAME', 'taskmgrd'),
      script: 'taskmgrd.js',
      cwd: __dirname,
      time: true,
      // A wrong .env makes it exit at once: wait between restarts instead of spinning.
      restart_delay: 5000,
    },
  ],
};
