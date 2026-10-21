
tim
===


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
Shows the works listed in `taskmgr.json` (the same file as the web UI, see `Web UI` below) as a tree,  
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
it is created from `taskmgr.json.example` first. `TASKMGR_CONFIG` in `.env` points at a config file elsewhere.  

`tm help` (or `tm -h`, `tm --help`)  
Prints the commands above. To open a folder named `config` or `help`, prefix it: `tm ./config`.  


Task files
----------

`task.txt`
Plain text file, with task details.

File example:
```
Title: Buy apple.
Status: done
Labels: shopping, groceries
Origin: Wife
Created at: 20250814_2100
Last edit at: 20250814_2100
Details:
Buy apple from the store.
```


Task List
---------

Example:  
```
     id           edit_at        task
[x]  202508142100  202508142100  Buy apple.   
[ ]  202508142100  202508142100  Buy orange.  
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

a  
Add a task: a small dialog asks for the task name (enter to create, esc to cancel).  
It creates a folder `<id> <name>` inside current directory (the id is the creation  
minute, `YYYYMMDDHHmm`; a second task in the same minute gets the next minute),  
puts the name on the first line of `task.txt` and opens it in the default text  
editor (like Vim).  

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


Web UI
------

A React app (Vite + Express) over the same task folders, in a plain black-and-white style.  
It manages several *works*, each with common tasks and any number of *repositories*:  

```
work
  repository
    task
```

It is one page: that tree on the left (a drawer that folds away), the tasks of the chosen work  
(its common tasks) or repository on the right, to list, filter, add, edit, mark done or pending,  
delete, and open subtasks and attachments. `tab` (or `h` at the top of a task list) moves the  
keyboard to the tree, `l` / `enter` back to the tasks.  

Configuration: `taskmgr.json` (copy `taskmgr.json.example`; the file is git-ignored).  
The bare `tm` command reads the same file:  
```
{
  "port": 3456,
  "host": "127.0.0.1",
  "works": [
    {
      "work": "gcc3.com",
      "orgin": "gcc3",
      "tasks_path": "~/gcc3/tasks",
      "repositories": [
        { "name": "repository a", "tasks_path": "~/gcc3/repository-a/tasks" }
      ]
    }
  ]
}
```
`tasks_path` is the folder holding the task folders (`~` is expanded). `orgin` (optional) is the organization the work is for, shown next to its name. The file is re-read when it changes.  
`PORT` / `HOST` in `.env` override the values in the file; `TASKMGR_CONFIG` in `.env` points at a config file elsewhere.  

Login: the web UI asks for a username and password. Accounts are a list in `data/users.json`  
(copy `data/users.example.json`; the file is git-ignored; `TASKMGR_USERS` in `.env` points at one elsewhere),  
all seeing the same works. The file is read on every login, so edits apply without a restart:  
```
[
  { "username": "admin", "password": "change-me" },
  { "username": "liu", "password": "..." }
]
```
Without the file nobody can log in. Sessions are kept in memory, so a restart signs everyone out  
(the browser remembers the password and logs back in by itself until "Log out").  

Setup (installs dependencies, creates `.env`, `taskmgr.json` and `data/users.json` from the examples, builds the frontend):  
`./setup.sh`  

Run as a background service with pm2 (`pnpm add -g pm2`):  
`./start.sh` start, `./stop.sh` stop, `./restart.sh` pull latest code, rebuild and restart.  
Then open the printed URL (default `http://127.0.0.1:3456/`).  
The pm2 process name is `PM2_NAME` in `.env` (default `taskmgr`), configured in `ecosystem.config.cjs`.  

Develop with hot reload in the foreground (Ctrl+C to stop):  
`./preview.sh` or `./preview.sh /path/to/taskmgr.json` (also `pnpm run dev`)  

Production server without pm2, after `pnpm run build`:  
`NODE_ENV=production node server/index.js [path/to/taskmgr.json]`  
or, after installing globally: `taskmgr-web`  
