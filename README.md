
taskmgr
=======


Task management tool.


How It Works
------------

The application bacically read the folders in current directory, listing all tasks.  
Each task is a folder with a `task.txt` file inside it.  
The folder name is the task ID, which is the creation time formatted as `YYYYMMDDHHmm`.  
Start it with `tm <folder>` to list the tasks in that folder, or with a bare `tm` to pick a work  
and a project from `taskmgr.json` first (see `Command`); then move between the tasks.  


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
Shows the task counter, the work / project, the task folder path, and the default text editor.  


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
`EDITOR=nvim`  
Available editors: `vim`, `nvim`, `subl`(Sublime Text), `notepad`  


Command
-------

`tm <folder>` (or `taskmgr <folder>`), e.g. `tm .` or `tm ~/tasks`  
Opens that folder as a task list. No `taskmgr.json` is needed.  
If there is no task, it will show a message: "No tasks found."

`tm` (or `taskmgr`) without arguments  
Opens the works listed in `taskmgr.json` (the same file as the web UI, see `Web UI` below).  
Select a work with `enter`, then one of its projects, or `(common tasks)` for the tasks of the work itself,  
to enter that folder's task list. A work without projects opens directly.  
`h` at the top of a task list goes back to the work / project list.  
Each row shows the task counters of the folder, or `folder not found` if it does not exist yet.  


Create Shortcut
---------------

On macOS, create a `.command` file in the tasks folder, with content:  

```
#!/bin/bash
taskmgr current_directory_path
```

Make it executable:  
`chmod +x yourfile.command`

Then you can double click the file to start `taskmgr`.  


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
Add a task, it will create a folder inside current directory,  
and open the default text editor (like Vim) to edit the `task.txt` file.  

e  
Edit a task with the default text editor.  

↑ or ↓ (arrow keys)  
j and k
Move from tasks.  

h and l  
→ or ← (arrow keys)
Move from main task and subtasks.  
`h` at the top of the list goes back to the work / project list (when started with a bare `tm`).  

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

q  
Quit the application.  

:  
Enter command mode (like Vim). Supported commands:  
`:h` or `:help` shows a help popup with all shortcuts.  


Gestures
--------

Mouse scroll up/down  
Scroll through the task list.  
(Not working on Windows.)  


Web UI
------

A React app (Vite + Express) over the same task folders, in a plain black-and-white style.  
It manages several *works*, each with common tasks and any number of *projects*:  

```
work
  project
    task
```

Opening the web root shows that tree; pick a work (its common tasks) or one of its projects  
to list, filter, add, edit, mark done or pending, delete, and open subtasks and attachments.  

Configuration: `taskmgr.json` (copy `taskmgr.json.example`; the file is git-ignored).  
The bare `tm` command reads the same file:  
```
{
  "port": 3456,
  "host": "127.0.0.1",
  "works": [
    {
      "work": "gcc3.com",
      "root": "~/gcc3/tasks",
      "projects": [
        { "name": "project a", "root": "~/gcc3/project-a/tasks" }
      ]
    }
  ]
}
```
`root` is the folder holding the task folders (`~` is expanded). The file is re-read when it changes.  
`PORT` / `HOST` in `.env` override the values in the file; `TASKMGR_CONFIG` in `.env` points at a config file elsewhere.  

Setup (installs dependencies, creates `.env` and `taskmgr.json` from the examples, builds the frontend):  
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
