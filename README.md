
taskmgr
=======


Task management tool.


How It Works
------------

The application bacically read the folders in current directory, listing all tasks.  
Each task is a folder with a `task.txt` file inside it.  
The folder name is the task ID, which is a timestamp in seconds.  
After start it with `taskmgr` or `tm`, it will list all tasks in current folder, and user can move between tasks.  


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
Shows the task counter, task folder path, and default text editor.  


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

`taskmgr`
After start it will list all tasks in current folder.  
If there is no task, it will show a message: "No tasks found."


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


Gestures
--------

Mouse scroll up/down  
Scroll through the task list.  
(Not working on Windows.)  


Web UI
------

A browser interface with the same features as the command line, served on localhost.  

Start:  
`pnpm run webui`  
or, after installing globally: `taskmgr-web`  
Then open the printed URL (default `http://127.0.0.1:3456/`).  

Preview in the foreground and open it in the browser (Ctrl+C to stop):  
`./preview.sh` or `./preview.sh /path/to/tasks`  

Run as a background service with pm2 (`pnpm add -g pm2`):  
`./start.sh` start, `./stop.sh` stop, `./restart.sh` pull latest code, reinstall and restart.  
The pm2 process name is `PM2_NAME` in `.env` (default `taskmgr`), configured in `ecosystem.config.cjs`.  

Tasks root folder, first match wins:  
1. Command-line argument: `node webui/server.js /path/to/tasks`  
2. `TASKS_ROOT` in `.env`  
3. `tasksRoot` in `webui/settings.json`  
4. Home folder `~/` (default)  

`.env` example (`~` is expanded to the home folder):  
```
TASKS_ROOT=~/tasks
PORT=3456
```

`webui/settings.json` example:  
```
{
  "tasksRoot": "/Users/me/tasks",
  "port": 3456,
  "host": "127.0.0.1"
}
```

Features:  
Same task list, ordering and status markers (`[ ]`, `[x]`, `[p]`, `[+]`) as the CLI.  
Add and edit tasks in an in-browser editor for `task.txt` (`ctrl/cmd+s` saves, `esc` cancels).  
Navigate into task folders to see subtasks, and back up (never above the root).  
Preview details, toggle done / pending, delete, refresh.  
`Enter` shows the task folder with its attachments (clickable), and a button opens it in the OS file manager.  
Status bar shows the counters and the current folder path.  

Shortcuts are the same as the CLI (`j`, `k`, `h`, `l`, `a`, `e`, `space`, `enter`, `x`, `p`, `d`, `r`),  
plus `o` to open the folder in the OS file manager and `?` to show the shortcut list.  
`q` quits: it stops the web UI server (under pm2 the process is restarted automatically).  
