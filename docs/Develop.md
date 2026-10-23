
Develop
=======


Web UI
------

Develop with hot reload in the foreground (Ctrl+C to stop):  
`pnpm run dev`  

Production server without pm2, after `pnpm run build`:  
`NODE_ENV=production node server/index.js [path/to/taskmgr.json]` (PowerShell: `$env:NODE_ENV='production'; node server/index.js`)  
or, after installing globally: `taskmgr-web`  


API
---

The server's APIs are listed in [Server.md](Server.md).  
