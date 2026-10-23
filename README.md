
tm
==


Task manager improved.  


How It Works
------------

The application bacically read the folders in current directory, listing all tasks.  
Each task is a folder with a `task.txt` file inside it.  
The folder name is the task ID, which is the creation time formatted as `YYYYMMDDHHmm`.  
Start it with `tm <folder>` to list the tasks in that folder, or with a bare `tm` to pick a work  
or a repository from the `taskmgr.json` tree first (see `Command`); then move between the tasks.  


`tasks` Folder
--------------

Create a `tasks` folder inside a repository folder and globally gitignore it.  
Use `globally_ignore_tasks.sh` or `.bat` for Windows or below command.  

```
git config --global core.excludesFile ~/.gitignore_global
vim ~/.gitignore_global
```

Add `tasks/` into it.  
Or run `./globally_ignore_tasks.sh` (Windows: `globally_ignore_tasks.bat`), which does both.  

You can manage all tasks in or not in a repository folder.  


Features
--------

Task Preview  
Use `space` to preview task details.  
Support `vi` style keybindings.  

Subtasks  
Support subtasks inside the a task folder.  

Shortcuts  
Refer `Shortcuts` section.  
Support a `vi` style keybindings, like `j`, `k`, `h`, `l` to navigate between tasks and subtasks.  

Status bar  
Shows the task counter, the work / repository, the task folder path, and the default text editor.  


Dependencies
------------

Node.js  
pnpm  


Installation
------------

Install:  
`pnpm install`  

Install globally:  
`pnpm link`

Uninstall:  
`pnpm unlink` (run inside the taskmgr folder)


Setup
-----

.env  
`EDITOR=vim` (default when EDITOR is not set)  
Available editors: `vim`, `nvim`, `subl`(Sublime Text), `notepad`  


Command
-------

`tm <folder>` (or `taskmgr <folder>`), e.g. `tm .` or `tm ~/tasks`  
Opens that folder as a task list. No `taskmgr.json` is needed.  
If there is no task, it will show a message: "No tasks found."

`tm` (or `taskmgr`) without arguments  
Shows the works listed in `taskmgr.json` (the same file as the web UI, see [docs/Web UI.md](docs/Web%20UI.md)) as a tree,  
each work followed by its repositories:  

```
  work / repository
  acme         todo:3 done:1 pending:0   ~/acme/tasks
  ├─ alpha     todo:1 done:0 pending:0   ~/acme/alpha/tasks
  └─ beta      folder not found          ~/acme/beta/tasks
  personal     todo:2 done:5 pending:1   ~/tasks
```

Select a row with `enter` to open its task list: a work row opens the common tasks of the work,  
a repository row opens that repository. `h` at the top of a task list goes back to the tree.  

`tm config`  
Opens `taskmgr.json` in the editor (`EDITOR` in `.env`, see above). If the file does not exist yet,  
it is created from `taskmgr.json.example` first.  

`tm push`  
Pushes `taskmgr.json` and the tasks folders to the remote server once, by hand, the same push the sync daemon does (see [docs/taskmgrd.md](docs/taskmgrd.md); `SYNC_SERVER` and `SYNC_SERVER_TOKEN` in `.env`). It prints what it pushed and exits, with an error when the server cannot be reached. Every tasks folder is sent each time, so whatever was changed on the server since is put back as it is here; attachments the server already has are not uploaded again. Each run, its start, what it pushed and its end, is logged to `logs/taskmgr.log` (the daemon's own pushes go to `logs/taskmgrd.log`).  

`tm pull`  
Fetches `taskmgr.json` and, for the works and repositories listed in it, every `task.txt` and the other files (attachments, files in folders) from the server, once, by hand. A file or folder that exists is updated when it differs, one that does not is added. A task the server deleted since the last sync (taskmgrd's last push or the last pull, remembered in `.tm-sync-state.json`) is deleted here too, with its folder, unless you changed its `task.txt` here since. Other files the server lacks are never deleted here, since taskmgrd does not push files over its size limits. A task or file you deleted here is fetched again if the server still has it (push first, or taskmgrd will send it back). Nothing never synced before is ever deleted. `taskmgr.json` is merged, and only for what is already in it: an origin, work or repository you have takes the server's fields (keeping its own `tasks_path` and `source_path`), and one only on the server is not pulled, with its files. Same `.env` settings as `tm push`, and logged to the same `logs/taskmgr.log`. With `POLLING=1` in `.env`, taskmgrd does this pull by itself: once when it starts, before its first push, then every `POLLING_INTERVAL` seconds (600 when not set, ten minutes), logged to its `logs/taskmgrd.log` (see [docs/taskmgrd.md](docs/taskmgrd.md)).  

`tm help` (or `tm -h`, `tm --help`)  
Prints the commands above. To open a folder named `config`, `push`, `pull` or `help`, prefix it: `tm ./config`.  


Task files
----------

Each task is a folder `<id> <title>`, the id being its creation minute (`YYYYMMDDHHmm`).

`task.txt`  
Plain text file, just the task details. The first line is the title.  
A task folder without a `task.txt` is still a task, titled after the folder name.

File example:
```
Buy apple.
Buy apple from the store.
```

The status is where the folder is: a task right in a folder of tasks is todo, one in its
`done` folder is done, one in its `pending` folder is pending. Marking a task done or pending
moves its folder there (the `done` / `pending` folder is created when needed and removed when
it is empty again):
```
tasks/
  202508142100 Buy orange./
  done/
    202508142100 Buy apple./
  pending/
```
Task files from older versions, which began with a `---` block (`status:`, `labels:`, ...), are
converted the first time their folder is listed: the block is dropped, and a done or pending
task is moved into its folder.


Task List
---------

Example:  
```
     id            task
[x]  202508142100  Buy apple.   
[ ]  202508142100  Buy orange.  
```

Task status:
empty for todo.  
x for done.  
p for pending.  

Task order:  
TODO tasks first, then done tasks, then pending tasks.


Shortcuts
---------

l  
List tasks, or refresh task list.  

a / n  
Add a task: a large "New task" box opens where you type the whole `task.txt`, the  
first line being the name and the rest the details (enter for a new line; as in vim,  
esc then `:wq` creates it and `:q` cancels). It creates a folder `<id> <name>` inside current directory  
(the id is the creation minute, `YYYYMMDDHHmm`; a second task in the same minute gets  
the next minute).  

e  
Edit a task with the default text editor.  

↑ or ↓ (arrow keys)  
j and k
Move from tasks.  

h and l  
→ or ← (arrow keys)
Move from main task and subtasks.  
`h` at the top of the list goes back to the work / repository tree (when started with a bare `tm`).  

x  
Mark a task as done.  

Space  
Show task details.  

Enter  
Open a task folder to view details and attachments.  

d  
Delete a task.  

s  
Create subtasks with AI.  

r  
Refresh the task list.  

p  
Pending a task.  

:  
Enter command mode (like Vim). Supported commands:  
`:h` or `:help` shows a help popup with all shortcuts.  
`:q` or `:quit` quits the application; in a task list opened from the work / repository tree it goes back to the tree instead.


Gestures
--------

Mouse scroll up/down  
Scroll through the task list.  
(Not working on Windows.)  


Documents
---------

* [Web UI](docs/Web%20UI.md) — A React app over the same task folders, managing works and repositories.  
* [taskmgrd](docs/taskmgrd.md) — Sync daemon that pushes the tasks to a remote tm server running the web UI, and pulls them from it when polling is on.  
* [Develop](docs/Develop.md) — Development setup.  
* [Server](docs/Server.md) — Server APIs.  
