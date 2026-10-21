import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SpaceTree, TaskList, TaskPanel, TaskEditorModal, ConfirmModal, HelpModal, FilePreviewModal, ConfigEditorModal, LanguageSwitcher, UserMenu } from "@components";
import { PlusIcon, SearchIcon, XIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from "@components/icons";
import { showToast } from "@ui";
import * as api from "@utils/api";
import { labelList } from "@utils/task";
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

// The one page: the works and projects as a tree on the left, the tasks of the chosen one on the
// right. The space is in the path (/w/:work for a work's common tasks, /w/:work/:project for a
// project) and the folder inside it in ?dir=, so back/forward and reload keep both.
export default function Home() {
  const { t } = useTranslation();
  const { work = "", project = "" } = useParams();
  const space = useMemo(() => (work ? { work, project } : null), [work, project]);
  const spaceTo = work ? api.spacePath(work, project) : null;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dir = searchParams.get("dir") || "";

  const [works, setWorks] = useState(null);
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
  const [selectedRel, setSelectedRel] = useState(null); // the task the shortcuts act on
  const [help, setHelp] = useState(false);
  const [command, setCommand] = useState(null); // text after ":" while in command mode
  const [preview, setPreview] = useState(null); // attachment shown in the preview modal
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => writeFlag("panel.tree", treeOpen), [treeOpen]);
  useEffect(() => writeFlag("panel.detail", detailOpen), [detailOpen]);

  const loadSpaces = useCallback(async () => {
    try {
      const d = await api.listSpaces();
      setWorks(d.works);
      setWorksError("");
    } catch (e) {
      setWorksError(e.message);
    }
  }, []);

  const load = useCallback(async () => {
    if (!space) {
      setData(EMPTY_DIR);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = await api.listTasks(space, dir);
      setData(d);
      setLoadError("");
    } catch (e) {
      setData(EMPTY_DIR);
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [space, dir]);

  // A change to a task moves the counts in the tree as well.
  const reload = useCallback(() => Promise.all([load(), loadSpaces()]), [load, loadSpaces]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    document.title = work ? `taskmgr - ${work}${project ? ` / ${project}` : ""}` : "taskmgr";
  }, [work, project]);

  useEffect(() => {
    setQuery("");
    load();
  }, [load]);

  // The spaces in tree order; only those whose folder exists can be shown.
  const spaces = useMemo(
    () =>
      (works || []).flatMap((w) => [
        { to: api.spacePath(w.work), exists: w.exists },
        ...w.projects.map((p) => ({ to: api.spacePath(w.work, p.name), exists: p.exists })),
      ]).filter((s) => s.exists),
    [works],
  );

  // With no space in the path, show the first one.
  useEffect(() => {
    if (!work && spaces.length) navigate(spaces[0].to, { replace: true });
  }, [work, spaces, navigate]);

  const selectSpace = (to, replace = false) => {
    if (to !== spaceTo || dir) navigate(to, { replace });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.tasks;
    return data.tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.id.includes(q) ||
        (t.origin || "").toLowerCase().includes(q) ||
        labelList(t.labels).some((l) => l.toLowerCase().includes(q)),
    );
  }, [data.tasks, query]);

  // Like the terminal, a selection always sits on a row: the first one when the selected task
  // is not in this list (a new folder, a filter, a deleted task).
  const found = visible.findIndex((t) => t.rel === selectedRel);
  const selectedIndex = found >= 0 ? found : visible.length ? 0 : -1;
  const selected = visible[selectedIndex] || null;

  // The wheel over the task list moves the selection, which scrolls itself into view.
  const [scrollEl, setScrollEl] = useState(null);
  useWheelSteps(scrollEl, (dir) => {
    const move = moveIndex(dir > 0 ? "down" : "up", selectedIndex, visible.length);
    if (move >= 0) setSelectedRel(visible[move].rel);
    setPane("tasks");
  });

  const openEditor = (task) => setEditor({ open: true, task });

  async function setStatus(task, status) {
    try {
      const { task: updated } = await api.setStatus(space, task.rel, status);
      setSelectedRel(updated.rel); // keep the task selected in its new place
      await reload();
    } catch (e) {
      showToast(e.message);
    }
  }

  const toggleDone = (task) => setStatus(task, task.status === "done" ? "todo" : "done");
  const togglePending = (task) => setStatus(task, task.status === "pending" ? "todo" : "pending");

  const goTo = (rel) => setSearchParams(rel ? { dir: rel } : {});
  const enterFolder = (task) => goTo(task.rel);

  // Up one folder, selecting the task we came out of; at the top, over to the tree.
  function goUp() {
    if (data.isRoot) {
      setTreeOpen(true);
      setPane("tree");
      return;
    }
    setSelectedRel(data.dir);
    goTo(data.parent || "");
  }

  async function saveEditor(text, files = []) {
    setSaving(true);
    try {
      let rel;
      if (editor.task) {
        ({ task: { rel } } = await api.saveTaskText(space, editor.task.rel, text));
      } else {
        ({ task: { rel } } = await api.createTaskText(space, dir, text));
        // the task exists now, so a failed upload must not keep the editor open for a second create
        try {
          for (const f of files) await api.uploadFile(space, rel, f);
        } catch (e) {
          showToast(t("toast.createdUploadFailed", { error: e.message }), 5000);
        }
      }
      setEditor({ open: false, task: null });
      setSelectedRel(rel);
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
      await api.deleteTask(space, confirm.rel);
      // select the row above the deleted one, as the terminal does
      const i = visible.findIndex((t) => t.rel === confirm.rel);
      setSelectedRel(visible[Math.max(0, i - 1)]?.rel ?? null);
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
      await api.openInFileManager(space, task.rel);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  function runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    if (cmd === "h" || cmd === "help") setHelp(true);
    else showToast(t("toast.notCommand", { cmd }));
  }

  const canAdd = !!space && !loadError;

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
      if (space) setPane("tasks");
      return true;
    }
    return false;
  }

  // The terminal's key bindings (see cli.js); :h lists them.
  useShortcuts((name) => {
    if (editor.open || confirm || configOpen || command !== null) return false;
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
      } else if (space) setPane("tasks");
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
      if (move >= 0) setSelectedRel(visible[move].rel);
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
  if (!space) {
    content = (
      <div className={styles.state}>
        <p className="muted">{works === null ? t("common.loading") : t("home.pickSpace")}</p>
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
            <button type="button" className="btn primary" onClick={() => setEditor({ open: true, task: null })}>
              <PlusIcon />
              {t("header.newTask")}
            </button>
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
          selectedRel={selected?.rel}
          onSelect={(t) => setSelectedRel(t.rel)}
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
          {work && <span className={styles.taskName}>{project ? `${work} / ${project}` : work}</span>}
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
          <button type="button" className="btn" onClick={reload} title={t("header.refresh")} aria-label={t("header.refresh")}>
            <RefreshIcon />
          </button>
          <button type="button" className="btn primary" onClick={() => setEditor({ open: true, task: null })} disabled={!canAdd}>
            <PlusIcon />
            {t("header.newTask")}
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
            error={worksError}
            activeTo={spaceTo}
            focused={pane === "tree"}
            onSelect={(to) => selectSpace(to)}
            onEdit={() => setConfigOpen(true)}
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

        <main className={styles.main} onMouseDown={() => space && setPane("tasks")}>
          {space && (
            <nav className={styles.section} aria-label={t("header.location")}>
              <button type="button" className={crumbClass(!project && data.isRoot)} onClick={() => selectSpace(api.spacePath(work))}>
                {work}
              </button>
              {project && (
                <span className={styles.crumbItem}>
                  <span className={styles.crumbSep}>&gt;</span>
                  <button type="button" className={crumbClass(data.isRoot)} onClick={() => goTo("")}>
                    {project}
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
          {space && (
            <TaskPanel
              space={space}
              task={selected}
              version={data}
              onEdit={openEditor}
              onEnter={enterFolder}
              onPreview={setPreview}
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
              {t("status.todo")} <b>{c.todo}</b>
            </span>
            <span>
              {t("status.done")} <b>{c.done}</b>
            </span>
            <span>
              {t("status.pending")} <b>{c.pending}</b>
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
        onSaved={(w) => {
          setConfigOpen(false);
          setWorks(w);
          setWorksError("");
          showToast(t("config.saved"));
        }}
      />

      <HelpModal isOpen={help} onClose={() => setHelp(false)} />

      <TaskEditorModal
        isOpen={editor.open}
        space={space}
        task={editor.task}
        saving={saving}
        onCancel={() => setEditor({ open: false, task: null })}
        onSave={saveEditor}
        onEnter={(t) => {
          setEditor({ open: false, task: null });
          enterFolder(t);
        }}
        onDelete={(t) => setConfirm(t)}
        onPreview={setPreview}
      />

      <FilePreviewModal space={space} file={preview} onClose={() => setPreview(null)} />

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
