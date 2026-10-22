
Web UI
======

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
  "origins": [
    {
      "origin": "gcc3",
      "works": [
        {
          "work": "gcc3.com",
          "income": { "monthly": [{ "amount": 500000, "currency": "JPY", "from": "2026-01" }], "once": [{ "amount": 100000, "currency": "JPY" }] },
          "tasks_path": "~/gcc3/tasks",
          "repositories": [
            { "repository": "repository a", "source_path": "~/gcc3/repository-a" },
            { "repository": "repository b", "source_path": "~/gcc3/repository-b", "tasks_path": "~/gcc3/tasks/repository-b" }
          ]
        }
      ]
    },
    { "works": [{ "work": "personal", "tasks_path": "~/tasks", "repositories": [] }] }
  ]
}
```
`tasks_path` is the folder holding the task folders (`~` is expanded). A work's `tasks_path` is optional: a work without one has no common tasks of its own, only its repositories'. Each entry of `origins` is an organization the works are for, with its works; in the web UI's tree, its works are grouped under its name. One entry may leave `origin` out (or `""`) for works without an origin, which come last. Work names are unique across all origins. The older form, a top-level `works` list whose works each have an optional `origin`, is still read, and is rewritten as `origins` when the file is saved from the web UI; so is a repository's older `name`, which becomes `repository`. `income` (optional) is what the work pays, as two lists of `{ amount, currency }` (a 3-letter code): `monthly` and `once` (one-time payments); a monthly item may also have `from`, the year and month it starts (`"2026-01"`, optional); An origin may have an `income` of the same form too (what it pays besides its works). An older single `reward` (`{ amount, currency, period }`) is still read, and becomes `income` when the work is saved from the web UI. In the web UI, the + button next to "Origins" opens the add dialog, which adds an origin (name and income), a work (into an origin, which is required; its tasks folder, if given, is created if missing) or a repository (into a work, with a source folder, a tasks folder or both; its tasks folder is created if missing); the + on an origin's row starts it on adding a work there, the one on a work's row on adding a repository there. The income of an origin or a work is shown at the right of its name in units of 10,000 (万): the one-time total, then `m` and the monthly total, e.g. `44 + m7`. The pencil button at the right of an origin's or a work's row edits its name and income (add or remove monthly and one-time items), and the one on a repository's row edits its name. `hidden` (optional, `true`) hides a work and its repositories from the tree; it is set with the "Hide this work" box in the work's edit dialog, and the "Show hidden works" box under the tree's head shows them again (greyed out). The pie-chart button at the top right opens the income analysis: in one currency, the annual income (monthly × 12), what the monthly items actually pay in a chosen year (counted from each one's `from` month), the one-time total, and a pie of where the income comes from, by origin (hidden works count only when asked for). `source_path` (optional) is a repository's source code folder; the tree shows it under the repository's name, or its `tasks_path` when it has none. A repository's `tasks_path` may be left out (or `""`) when it has a `source_path`: its tasks are then read from the `tasks` folder in the source folder. Paths in the tree are shown as written here, with `~` kept. The file is re-read when it changes.  
`PORT` / `HOST` in `.env` set the port (default 3456) and host (default 127.0.0.1).  

Login: the web UI asks for a username and password. Accounts are a list in `data/users.json`  
(copy `data/users.example.json`; the file is git-ignored),  
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
`./start.sh` start, `./stop.sh` stop, `./restart.sh` pull latest code, rebuild and restart (taskmgrd too, when `TASKMGRD_SERVER` is set in `.env`).  
Then open the printed URL (default `http://127.0.0.1:3456/`).  
The pm2 process name is `PM2_NAME` in `.env` (default `taskmgr`), configured in `ecosystem.config.cjs`.  

For development (hot reload, production server without pm2), see [Develop.md](Develop.md).  
