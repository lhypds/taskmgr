
taskmgrd
========

`taskmgrd` runs in the background on the machine that has the tasks. It watches `taskmgr.json` and the  
tasks folder of every work and repository in it, and pushes what changes to a remote tm server (one  
running the web UI). The server merges the pushed `taskmgr.json` into its own `taskmgr.json`, and  
keeps a copy of the tasks under its `data/` folder, laid out like the origins tree:  

```
data/
  origins/
    <origin>/                      "_" for the works without an origin
      <work>/
        tasks/                     the work's common tasks (its tasks_path), the folder as it is
          202508142100 Buy apple/task.txt
          202508142100 Buy apple/receipt.pdf
          done/202508142000 Buy orange/task.txt
        repositories/
          <repository>/            the repository's tasks (its tasks_path, or the tasks folder of its source_path)
            202508142200 Fix mail/task.txt
```

What is pushed: `taskmgr.json` whole when it changes (an invalid one is not pushed; the folders of the  
last good one stay watched), and each tasks folder whole, whenever anything in it changes: every file in  
it, task files, attachments and anything else, `done` / `pending` folders and subtasks included, and every  
empty folder. The server replaces its copy with the snapshot, so after a push its copy is the folder  
exactly as it is here, and a renamed, moved or deleted task or attachment is mirrored too. Only `.DS_Store`  
files are left out. Task files go as text; every other file by the sha1 of its content: the daemon asks the  
server which of them it does not have yet and uploads only those, so an unchanged attachment, or the same  
file under a renamed task, is never sent twice (the server keeps them in `data/.sync-blobs/`).  
The server merges a pushed `taskmgr.json` into its own: origins, works and repositories it  
does not have are added, the ones it has take the pushed settings, and the ones it has that were not  
pushed are kept, with their folders (so several machines can push to one server; a work or  
repository renamed or removed on one machine stays on the server until removed there). In the  
merged file, the `tasks_path` of every pushed work (that has common tasks) and repository is its  
copy under `data/origins/`, and a repository's `source_path` is left out, so the server's web UI  
shows the pushed tasks. A tasks  
folder that does not exist is left as it is on the server and looked for every 30 seconds. Changes  
go out about 1.5 seconds after they happen; at startup the daemon pushes `taskmgr.json` once, and  
at startup and every 5 minutes it asks the server what it has and pushes what differs, and a push  
that fails (the server is down) is retried, with growing waits, until it goes through.  

On the server: set `TASKMGRD_TOKEN` in `.env` to a secret of your choice and restart the web UI  
(`./start.sh`); its startup lines then say `sync : receiving from taskmgrd`. Without the token the  
server refuses pushes. The copied files are git-ignored. A task changed in the server's web UI is  
changed in the copy only: the next push of its folder overwrites it.  

On the machine with the tasks: in `.env`, `TASKMGRD_SERVER` is the server's URL (the one its web UI  
answers at, e.g. `https://tm.example.com`) and `TASKMGRD_TOKEN` the same secret. Then:  

`./taskmgrd.sh` starts the daemon under pm2 (and restarts it when it already runs, picking up a changed `.env`)  
`./taskmgrd.sh stop` stops it  
`./taskmgrd.sh status` says whether it runs  
`./taskmgrd.sh logs` follows its log  
`./taskmgrd.sh fg` runs it in the foreground without pm2 (Ctrl+C to stop), to see what it does  

The pm2 process is named `taskmgrd` (see `taskmgrd.config.cjs`); `pm2 startup` then `pm2 save` make it start with the machine. After  
`./install.sh`, `taskmgrd` runs it in the foreground too (also `pnpm run daemon`).  

For the API the daemon uses, see [Server.md](Server.md).  
