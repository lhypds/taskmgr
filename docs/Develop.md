
Develop
=======


Web UI
------

Develop with hot reload in the foreground (Ctrl+C to stop):  
`./preview.sh` or `./preview.sh /path/to/taskmgr.json` (also `pnpm run dev`)  

Production server without pm2, after `pnpm run build`:  
`NODE_ENV=production node server/index.js [path/to/taskmgr.json]`  
or, after installing globally: `taskmgr-web`  


API
---

The server's APIs are listed in [Server.md](Server.md).  
