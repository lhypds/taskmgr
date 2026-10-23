// pm2 app for taskmgrd, the sync daemon (taskmgrd.js), started by ./taskmgrd.sh.
// Separate from ecosystem.config.cjs (the web UI) since a machine usually runs one or the other.
module.exports = {
  apps: [
    {
      name: 'taskmgrd',
      script: 'taskmgrd.js',
      cwd: __dirname,
      time: true,
      // A wrong .env makes it exit at once: wait between restarts instead of spinning.
      restart_delay: 5000,
    },
  ],
};
