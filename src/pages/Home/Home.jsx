import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SpaceTree, TaskList, TaskPanel, TaskEditorModal, ConfirmModal, HelpModal, FilePreviewModal, ConfigEditorModal, WorkEditModal, AddSpaceModal, RepositoryNameModal, LanguageSwitcher, UserMenu } from "@components";
import { PlusIcon, SearchIcon, XIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from "@components/icons";
import { showToast } from "@ui";
import { useAuth } from "@store";
import * as api from "@utils/api";
import { labelList } from "@utils/task";
import { groupWorksByOrigin } from "@utils/works";
import { useShortcuts, useWheelSteps, moveIndex } from "@utils/keys";
import styles from "./home.module.css";

const EMPTY_DIR = { dir: "", absDir: "", isRoot: true, parent: null, crumbs: [], tasks: [], counts: { todo: 0, done: 0, pending: 0 } };

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// A key for a task that is unique across spaces, for the selection.
const keyOf = (space, rel) => `${space.work}/${space.repository || ""}/${rel}`;

// The one page: the origins, works and repositories as a tree on the left, the tasks of the chosen
// one on the right. What is shown is in the path (/o/:origin for every task of an origin, /w/:work
// for a work's tasks and its repositories', /w/:work/:repository for a repository) and the folder
// inside a space in ?dir=, so back/forward and reload keep both. A work with ?dir= is a folder in
// the work's own tasks.
export default function Home() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { origin = "", work = "", repository = "" } = useParams();
  const space = useMemo(() => (work ? { work, repository } : null), [work, repository]);
  const spaceTo = origin ? api.originPath(origin) : work ? api.spacePath(work, repository) : null;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dir = searchParams.get("dir") || "";
  // The tasks of several spaces in one list: a whole origin, or a work at its top.
  const scope = useMemo(() => (origin ? { origin } : work && !repository && !dir ? { work } : null), [origin, work, repository, dir]);

  const [works, setWorks] = useState(null);
  const [origins, setOrigins] = useState([]); // the named origins, { origin, income }, some maybe without works
  const [worksError, setWorksError] = useState("");
  const [treeOpen, setTreeOpen] = useState(() => readFlag("panel.tree", true));
  const [detailOpen, setDetailOpen] = useState(() => readFlag("panel.detail", true));
  const [pane, setPane] = useState("tasks"); // where j / k and friends go: "tree" or "tasks"
  const [data, setData] = useState(EMPTY_DIR);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState({ open: false, task: null });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // task to delete
  const [deleting, setDeleting] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // the task the shortcuts act on
  const [help, setHelp] = useState(false);
  const [command, setCommand] = useState(null); // text after ":" while in command mode
  const [preview, setPreview] = useState(null); // attachment shown in the preview modal
  const [configOpen, setConfigOpen] = useState(false);
  const [editingWork, setEditingWork] = useState(null); // work whose name and income are being edited
  const [adding, setAdding] = useState(null); // what the add modal starts with: { type, origin, work }
  const [editingOrigin, setEditingOrigin] = useState(null); // { origin, income } of the origin being edited
  const [renaming, setRenaming] = useState(null); // { work, name } of the repository being renamed

  useEffect(() => writeFlag("panel.tree", treeOpen), [treeOpen]);
  useEffect(() => writeFlag("panel.detail", detailOpen), [detailOpen]);

  // The { works, origins } every change to taskmgr.json answers with.
  const setSpaces = useCallback((d) => {
    setWorks(d.works);
    setOrigins(d.origins || []);
    setWorksError("");
  }, []);

  const loadSpaces = useCallback(async () => {
    try {
      setSpaces(await api.listSpaces());
    } catch (e) {
      setWorksError(e.message);
    }
  }, [setSpaces]);

  const load = useCallback(async () => {
    if (!scope && !space) {
      setData(EMPTY_DIR);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = scope ? await api.listAllTasks(scope) : await api.listTasks(space, dir);
      setData(d);
      setLoadError("");
    } catch (e) {
      setData(EMPTY_DIR);
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [scope, space, dir]);

  // Re-read the works as well: a task folder may have been created or removed.
  const reload = useCallback(() => Promise.all([load(), loadSpaces()]), [load, loadSpaces]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    document.title = origin ? `taskmgr - ${origin}` : work ? `taskmgr - ${work}${repository ? ` / ${repository}` : ""}` : "taskmgr";
  }, [origin, work, repository]);

  useEffect(() => {
    setQuery("");
    load();
  }, [load]);

  // The tree's rows in order (each origin, then its works and their repositories), including the
  // spaces whose folder is missing.
  const spaces = useMemo(
    () =>
      groupWorksByOrigin(works, origins).flatMap((g) => [
        ...(g.origin ? [{ to: api.originPath(g.origin), exists: true }] : []),
        ...g.works.flatMap((w) => [
          { to: api.spacePath(w.work), root: w.root, exists: w.exists },
          ...w.repositories.map((p) => ({ to: api.spacePath(w.work, p.name), root: p.root, exists: p.exists })),
        ]),
      ]),
    [works, origins],
  );
  // The space on the right when its task folder does not exist. A list of several spaces just
  // leaves the missing ones out.
  const missing = (!scope && spaces.find((s) => s.to === spaceTo && !s.exists)) || null;

  // With nothing in the path, show the first space whose folder exists.
  useEffect(() => {
    const first = spaces.find((s) => s.exists && s.root) || spaces[0];
    if (!spaceTo && first) navigate(first.to, { replace: true });
  }, [spaceTo, spaces, navigate]);

  const selectSpace = (to, replace = false) => {
    if (to !== spaceTo || dir) navigate(to, { replace });
  };

  // Every task with the space it lives in, a key unique across spaces, and, in a list of several
  // spaces, where it is from: the repository in a work's list, the work (and repository) in an
  // origin's.
  const tasks = useMemo(
    () =>
      data.tasks.map((t) => {
        const s = t.work !== undefined ? { work: t.work, repository: t.repository } : space;
        const from = !scope ? "" : origin ? [s.work, s.repository].filter(Boolean).join(" / ") : s.repository;
        return { ...t, space: s, key: keyOf(s, t.rel), from };
      }),
    [data.tasks, space, scope, origin],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.id.includes(q) ||
        (t.origin || "").toLowerCase().includes(q) ||
        t.from.toLowerCase().includes(q) ||
        labelList(t.labels).some((l) => l.toLowerCase().includes(q)),
    );
  }, [tasks, query]);

  // Like the terminal, a selection always sits on a row: the first one when the selected task
  // is not in this list (a new folder, a filter, a deleted task).
  const found = visible.findIndex((t) => t.key === selectedKey);
  const selectedIndex = found >= 0 ? found : visible.length ? 0 : -1;
  const selected = visible[selectedIndex] || null;

  // The wheel over the task list moves the selection, which scrolls itself into view.
  const [scrollEl, setScrollEl] = useState(null);
  useWheelSteps(scrollEl, (dir) => {
    const move = moveIndex(dir > 0 ? "down" : "up", selectedIndex, visible.length);
    if (move >= 0) setSelectedKey(visible[move].key);
    setPane("tasks");
  });

  const openEditor = (task) => setEditor({ open: true, task });

  async function setStatus(task, status) {
    try {
      const { task: updated } = await api.setStatus(task.space, task.rel, status);
      setSelectedKey(keyOf(task.space, updated.rel)); // keep the task selected in its new place
      await reload();
    } catch (e) {
      showToast(e.message);
    }
  }

  const toggleDone = (task) => setStatus(task, task.status === "done" ? "todo" : "done");
  const togglePending = (task) => setStatus(task, task.status === "pending" ? "todo" : "pending");

  const goTo = (rel) => setSearchParams(rel ? { dir: rel } : {});
  // Into a task's subtasks, in the space the task lives in.
  const enterFolder = (task) => navigate({ pathname: api.spacePath(task.space.work, task.space.repository), search: `?${new URLSearchParams({ dir: task.rel })}` });

  // Up one folder, selecting the task we came out of; at the top, over to the tree.
  function goUp() {
    if (data.isRoot) {
      setTreeOpen(true);
      setPane("tree");
      return;
    }
    setSelectedKey(keyOf(space, data.dir));
    goTo(data.parent || "");
  }

  async function saveEditor(text, files = []) {
    setSaving(true);
    // a new task goes in the folder on the right; in a work's list, in the work's own tasks
    const target = editor.task ? editor.task.space : space;
    try {
      let rel;
      if (editor.task) {
        ({ task: { rel } } = await api.saveTaskText(target, editor.task.rel, text));
      } else {
        ({ task: { rel } } = await api.createTaskText(target, dir, text));
        // the task exists now, so a failed upload must not keep the editor open for a second create
        try {
          for (const f of files) await api.uploadFile(target, rel, f);
        } catch (e) {
          showToast(t("toast.createdUploadFailed", { error: e.message }), 5000);
        }
      }
      setEditor({ open: false, task: null });
      setSelectedKey(keyOf(target, rel));
      await reload();
      showToast(editor.task ? t("toast.saved") : t("toast.created"));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api.deleteTask(confirm.space, confirm.rel);
      // select the row above the deleted one, as the terminal does
      const i = visible.findIndex((t) => t.key === confirm.key);
      setSelectedKey(visible[Math.max(0, i - 1)]?.key ?? null);
      setConfirm(null);
      setEditor({ open: false, task: null });
      await reload();
      showToast(t("toast.deleted"));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function openFolder(task) {
    try {
      await api.openInFileManager(task.space, task.rel);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function openSpaceFolder(target) {
    try {
      await api.openSpaceFolder(target);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  function runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    if (cmd === "h" || cmd === "help") setHelp(true);
    // a page cannot close its own tab, so quitting means logging out
    else if (cmd === "q" || cmd === "quit") logout();
    else showToast(t("toast.notCommand", { cmd }));
  }

  // An origin has no tasks folder of its own to add to.
  const canAdd = !!space && !origin && !loadError;

  // On the tree: j / k move through the spaces (the right side follows), l / enter go over to
  // the tasks.
  function treeKey(name) {
    const i = spaces.findIndex((s) => s.to === spaceTo);
    const move = moveIndex(name, i, spaces.length);
    if (move !== null) {
      if (move >= 0) selectSpace(spaces[move].to, true);
      return true;
    }
    if (["l", "right", "enter"].includes(name)) {
      if (spaceTo) setPane("tasks");
      return true;
    }
    return false;
  }

  // The terminal's key bindings (see cli.js); :h lists them.
  useShortcuts((name) => {
    if (editor.open || confirm || configOpen || editingWork || editingOrigin || adding || renaming || command !== null) return false;
    if (preview) {
      if (!["q", "enter", "space"].includes(name)) return false;
      setPreview(null);
      return true;
    }
    // the help closes with the keys that close it in the terminal
    if (help) {
      if (!["q", "enter", "space"].includes(name)) return false;
      setHelp(false);
      return true;
    }
    if (name === "Tab") {
      if (pane === "tasks") {
        setTreeOpen(true);
        setPane("tree");
      } else if (spaceTo) setPane("tasks");
      return true;
    }
    if (name === "r") {
      reload();
      return true;
    }
    if (name === ":") {
      setCommand("");
      return true;
    }
    if (pane === "tree") return treeKey(name);

    const move = moveIndex(name, selectedIndex, visible.length);
    if (move !== null) {
      if (move >= 0) setSelectedKey(visible[move].key);
      return true;
    }
    const t = selected;
    switch (name) {
      case "h":
      case "left":
        goUp();
        return true;
      case "l":
      case "right":
        if (t) enterFolder(t);
        return true;
      case "a":
        if (canAdd) setEditor({ open: true, task: null });
        return true;
      case "e":
      case "i":
      case "space":
        if (t) openEditor(t);
        return true;
      case "enter":
        if (t) openFolder(t);
        return true;
      case "x":
        if (t) toggleDone(t);
        return true;
      case "p":
        if (t) togglePending(t);
        return true;
      case "d":
        if (t) setConfirm(t);
        return true;
      default:
        return false;
    }
  });

  const c = data.counts;
  const crumbClass = (active) => `${styles.crumb}${active ? ` ${styles.crumbActive}` : ""}`;

  let content;
  if (!spaceTo) {
    content = (
      <div className={styles.state}>
        <p className="muted">{works === null ? t("common.loading") : t("home.pickSpace")}</p>
      </div>
    );
  } else if (missing) {
    content = (
      <div className={styles.state}>
        <p className="muted">{t("home.folderNotFound")}</p>
        <p className={`mono ${styles.missingPath}`}>{missing.root}</p>
      </div>
    );
  } else if (loadError) {
    content = (
      <div className={styles.state}>
        <p className={styles.error}>{loadError}</p>
        <button type="button" className="btn" onClick={load}>
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (data.tasks.length === 0) {
    content = (
      <div className={styles.state}>
        {loading ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <>
            <p className="muted">{data.isRoot ? t("home.noTasks") : t("home.noSubtasks")}</p>
            {canAdd && (
              <button type="button" className="btn primary" onClick={() => setEditor({ open: true, task: null })}>
                <PlusIcon />
                {t("header.newTask")}
              </button>
            )}
          </>
        )}
      </div>
    );
  } else if (visible.length === 0) {
    content = (
      <div className={styles.state}>
        <p className="muted">{t("home.noMatch", { query })}</p>
      </div>
    );
  } else {
    content = (
      <div className={styles.scroll} ref={setScrollEl}>
        <TaskList
          tasks={visible}
          selectedKey={selected?.key}
          onSelect={(t) => setSelectedKey(t.key)}
          onOpen={openEditor}
          onToggleDone={toggleDone}
          onEnter={enterFolder}
        />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>taskmgr</h1>
        </div>

        <div className={styles.search}>
          <SearchIcon className={styles.searchIcon} />
          <input
            className={`input ${styles.searchInput}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("header.filter")}
            aria-label={t("header.filterLabel")}
          />
          {query && (
            <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label={t("header.clearFilter")}>
              <XIcon />
            </button>
          )}
        </div>

        <div className={styles.actions}>
          {!data.isRoot && (
            <button type="button" className="btn" onClick={() => goTo(data.parent || "")}>
              <ChevronLeftIcon />
              {t("header.up")}
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => setEditor({ open: true, task: null })} disabled={!canAdd}>
            <PlusIcon />
            {t("header.newTask")}
          </button>
          <button type="button" className="btn" onClick={reload} title={t("header.refresh")} aria-label={t("header.refresh")}>
            <RefreshIcon />
          </button>
          <div className={styles.account}>
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.drawer} data-open={treeOpen} onMouseDown={() => setPane("tree")}>
          <SpaceTree
            works={works}
            origins={origins}
            error={worksError}
            activeTo={spaceTo}
            focused={pane === "tree"}
            onSelect={(to) => selectSpace(to)}
            onEdit={() => setConfigOpen(true)}
            onAdd={setAdding}
            onEditWork={setEditingWork}
            onEditOrigin={setEditingOrigin}
            onEditRepository={setRenaming}
            onOpenFolder={openSpaceFolder}
          />
        </aside>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => {
            if (treeOpen && pane === "tree") setPane("tasks");
            setTreeOpen((v) => !v);
          }}
          title={t(treeOpen ? "header.hideTree" : "header.showTree")}
          aria-label={t(treeOpen ? "header.hideTree" : "header.showTree")}
        >
          {treeOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </button>

        <main className={styles.main} onMouseDown={() => spaceTo && setPane("tasks")}>
          {origin && (
            <nav className={styles.section} aria-label={t("header.location")}>
              <button type="button" className={crumbClass(true)} disabled>
                {origin}
              </button>
            </nav>
          )}
          {space && (
            <nav className={styles.section} aria-label={t("header.location")}>
              <button type="button" className={crumbClass(!repository && data.isRoot)} onClick={() => selectSpace(api.spacePath(work))}>
                {work}
              </button>
              {repository && (
                <span className={styles.crumbItem}>
                  <span className={styles.crumbSep}>&gt;</span>
                  <button type="button" className={crumbClass(data.isRoot)} onClick={() => goTo("")}>
                    {repository}
                  </button>
                </span>
              )}
              {data.crumbs.map((cr, i) => {
                const active = i === data.crumbs.length - 1;
                return (
                  <span key={cr.rel} className={styles.crumbItem}>
                    <span className={styles.crumbSep}>&gt;</span>
                    <button type="button" className={crumbClass(active)} onClick={() => goTo(cr.rel)} disabled={active}>
                      {cr.title}
                    </button>
                  </span>
                );
              })}
            </nav>
          )}
          {content}
        </main>

        <button
          type="button"
          className={styles.toggle}
          onClick={() => setDetailOpen((v) => !v)}
          title={t(detailOpen ? "header.hideDetails" : "header.showDetails")}
          aria-label={t(detailOpen ? "header.hideDetails" : "header.showDetails")}
        >
          {detailOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
        <aside className={styles.detail} data-open={detailOpen}>
          {spaceTo && (
            <TaskPanel
              space={selected?.space}
              task={selected}
              version={data}
              onEdit={openEditor}
              onEnter={enterFolder}
              onPreview={(file) => setPreview({ ...file, space: selected.space })}
            />
          )}
        </aside>
      </div>

      <footer className={styles.statusBar}>
        {command !== null ? (
          <CommandLine
            value={command}
            onChange={setCommand}
            onCancel={() => setCommand(null)}
            onRun={() => {
              setCommand(null);
              runCommand(command);
            }}
          />
        ) : (
          <>
            <span>
              {t("status.todo")} {c.todo}
            </span>
            <span>
              {t("status.done")} {c.done}
            </span>
            <span>
              {t("status.pending")} {c.pending}
            </span>
            <span className={`mono ${styles.path}`} title={data.absDir}>
              {data.absDir}
            </span>
          </>
        )}
      </footer>

      <ConfigEditorModal
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={(d) => {
          setConfigOpen(false);
          setSpaces(d);
          showToast(t("config.saved"));
        }}
      />

      <WorkEditModal
        work={editingWork}
        onClose={() => setEditingWork(null)}
        onSaved={(d, newName) => {
          const oldName = editingWork.work;
          setEditingWork(null);
          setSpaces(d);
          // Follow the rename when the space on the right is this work or one of its repositories.
          if (newName !== oldName && work === oldName) navigate({ pathname: api.spacePath(newName, repository), search: searchParams.toString() }, { replace: true });
          showToast(t("work.saved"));
        }}
      />

      <WorkEditModal
        origin={editingOrigin}
        onClose={() => setEditingOrigin(null)}
        onSaved={(d, newName) => {
          const oldName = editingOrigin.origin;
          setEditingOrigin(null);
          setSpaces(d);
          // Follow the rename when the origin is the one on the right.
          if (newName !== oldName && origin === oldName) navigate(api.originPath(newName), { replace: true });
          showToast(t("origin.saved"));
        }}
      />

      <AddSpaceModal
        add={adding}
        origins={origins}
        works={works}
        onClose={() => setAdding(null)}
        onSaved={(d, added) => {
          setAdding(null);
          setSpaces(d);
          // Open what was added on the right.
          const to =
            added.type === "origin" ? api.originPath(added.name) : added.type === "work" ? api.spacePath(added.name) : api.spacePath(added.work, added.name);
          selectSpace(to);
          showToast(t(`${added.type}.added`));
        }}
      />

      <RepositoryNameModal
        repository={renaming}
        onClose={() => setRenaming(null)}
        onSaved={(d, newName) => {
          const { work: inWork, name } = renaming;
          setRenaming(null);
          setSpaces(d);
          // Follow the rename when the repository is the one on the right.
          if (spaceTo === api.spacePath(inWork, name)) navigate({ pathname: api.spacePath(inWork, newName), search: searchParams.toString() }, { replace: true });
          showToast(t("repository.renamed"));
        }}
      />

      <HelpModal isOpen={help} onClose={() => setHelp(false)} />

      <TaskEditorModal
        isOpen={editor.open}
        space={editor.task ? editor.task.space : space}
        task={editor.task}
        saving={saving}
        onCancel={() => setEditor({ open: false, task: null })}
        onSave={saveEditor}
        onEnter={(t) => {
          setEditor({ open: false, task: null });
          enterFolder(t);
        }}
        onDelete={(t) => setConfirm(t)}
        onPreview={(file) => setPreview({ ...file, space: editor.task ? editor.task.space : space })}
      />

      <FilePreviewModal space={preview?.space} file={preview} onClose={() => setPreview(null)} />

      <ConfirmModal
        isOpen={!!confirm}
        title={t("delete.title")}
        message={confirm ? t("delete.message", { name: confirm.title || confirm.id }) : ""}
        busy={deleting}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// Vim-style command line in the status bar: enter runs, esc (or backspace on empty) leaves.
function CommandLine({ value, onChange, onCancel, onRun }) {
  const { t } = useTranslation();
  return (
    <span className={`mono ${styles.command}`}>
      :
      <input
        className={styles.commandInput}
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onRun();
          } else if (e.key === "Escape" || (e.key === "Backspace" && !value)) {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("home.command")}
      />
    </span>
  );
}
