
Develop
=======


Web UI
------

Develop with hot reload in the foreground (Ctrl+C to stop):  
`pnpm run dev`  

Production server without pm2, after `pnpm run build`:  
`NODE_ENV=production node server/index.js [path/to/taskmgr.json]` (PowerShell: `$env:NODE_ENV='production'; node server/index.js`)  


API
---

The server's APIs are listed in [Server.md](Server.md).  


AI
--

Everything about Claude Code is in `ai/`: `task.js` finds a task and makes its first prompt (shared by the terminal and  
the web UI), `run.js` is `tm run` (the `run.js` at the root only requires it), `session.js` runs Claude Code for the web UI  
through the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, which brings its own copy of Claude Code and uses the  
login in `~/.claude`), keeping the runs and relaying what Claude asks, `routes.js` is their API (see [Server.md](Server.md)),  
and `web/` the React side: the run button, the run shown under a prompt, the hook that follows the runs, and their texts  
(imported as `@ai`, merged into the translations by `src/i18n/index.js`). What claude writes to stderr goes to `logs/ai.log`.    
