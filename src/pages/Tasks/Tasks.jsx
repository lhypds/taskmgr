import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { TaskList, TaskDetailModal, TaskEditorModal, ConfirmModal } from "@components";
import { PlusIcon, SearchIcon, XIcon, ChevronLeftIcon, RefreshIcon } from "@components/icons";
import { showToast } from "@ui";
import * as api from "@utils/api";
import { labelList } from "@utils/task";
import styles from "./tasks.module.css";

const EMPTY_DIR = { dir: "", absDir: "", isRoot: true, parent: null, crumbs: [], tasks: [], counts: { todo: 0, done: 0, pending: 0 } };

// The task list of one space (/w/:work for a work's common tasks, /w/:work/:project for a
// project). The folder inside the space lives in ?dir= so back/forward and reload keep it.
export default function Tasks() {
  const { work, project = "" } = useParams();
  const space = useMemo(() => ({ work, project }), [work, project]);
  const [searchParams, setSearchParams] = useSearchParams();
  const dir = searchParams.get("dir") || "";

  const [settings, setSettings] = useState(null);
  const [data, setData] = useState(EMPTY_DIR);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null); // { task, files }
  const [editor, setEditor] = useState({ open: false, task: null });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // task to delete
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listTasks(space, dir);
      setData(d);
      setLoadError("");
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [space, dir]);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    document.title = `taskmgr - ${work}${project ? ` / ${project}` : ""}`;
  }, [work, project]);

  useEffect(() => {
    setDetail(null);
    setQuery("");
    load();
  }, [load]);

  // Re-read a task after a change so the detail view shows the new state and folder name.
  async function reopenDetail(rel) {
    try {
      setDetail(await api.getTask(space, rel));
    } catch {
      setDetail(null);
    }
  }

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

  async function openDetail(task) {
    try {
      setDetail(await api.getTask(space, task.rel));
    } catch (e) {
      showToast(e.message);
    }
  }

  async function setStatus(task, status) {
    try {
      const { task: updated } = await api.setStatus(space, task.rel, status);
      await load();
      if (detail?.task?.rel === task.rel) await reopenDetail(updated.rel);
    } catch (e) {
      showToast(e.message);
    }
  }

  const toggleDone = (task) => setStatus(task, task.status === "done" ? "todo" : "done");
  const togglePending = (task) => setStatus(task, task.status === "pending" ? "todo" : "pending");

  const goTo = (rel) => setSearchParams(rel ? { dir: rel } : {});
  const enterFolder = (task) => goTo(task.rel);

  async function saveEditor(fields) {
    setSaving(true);
    try {
      let rel;
      if (editor.task) {
        ({ task: { rel } } = await api.updateTask(space, editor.task.rel, fields));
      } else {
        ({ task: { rel } } = await api.createTask(space, dir, fields));
      }
      setEditor({ open: false, task: null });
      await load();
      if (detail) await reopenDetail(rel);
      showToast(editor.task ? "Saved" : "Task created");
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
      setConfirm(null);
      setDetail(null);
      await load();
      showToast("Task deleted");
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function openFolder(task) {
    try {
      await api.openInFileManager(space, task.rel);
      showToast("Opened in file manager");
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  const c = data.counts;
  const atSpaceRoot = data.isRoot;
  const crumbClass = (active) => `${styles.crumb}${active ? ` ${styles.crumbActive}` : ""}`;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link to="/" className={styles.title} title="All works and projects">
            taskmgr
          </Link>
          <nav className={styles.crumbs} aria-label="Location">
            <Link to={api.spacePath(work)} className={crumbClass(!project && atSpaceRoot)} onClick={() => !project && goTo("")}>
              {work}
            </Link>
            {project && (
              <span className={styles.crumbItem}>
                <span className={styles.crumbSep}>/</span>
                <Link to={api.spacePath(work, project)} className={crumbClass(atSpaceRoot)} onClick={() => goTo("")}>
                  {project}
                </Link>
              </span>
            )}
            {data.crumbs.map((cr, i) => {
              const active = i === data.crumbs.length - 1;
              return (
                <span key={cr.rel} className={styles.crumbItem}>
                  <span className={styles.crumbSep}>/</span>
                  <button type="button" className={crumbClass(active)} onClick={() => goTo(cr.rel)} disabled={active}>
                    {cr.title}
                  </button>
                </span>
              );
            })}
          </nav>
        </div>

        <div className={styles.search}>
          <SearchIcon className={styles.searchIcon} />
          <input
            className={`input ${styles.searchInput}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, label, origin or id"
            aria-label="Filter tasks"
          />
          {query && (
            <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="Clear filter">
              <XIcon />
            </button>
          )}
        </div>

        <div className={styles.actions}>
          {!atSpaceRoot && (
            <button type="button" className="btn" onClick={() => goTo(data.parent || "")}>
              <ChevronLeftIcon />
              Up
            </button>
          )}
          <button type="button" className="btn" onClick={load} title="Refresh">
            <RefreshIcon />
          </button>
          <button type="button" className="btn primary" onClick={() => setEditor({ open: true, task: null })} disabled={!!loadError}>
            <PlusIcon />
            New task
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {loadError ? (
          <div className={styles.state}>
            <p className={styles.error}>{loadError}</p>
            <div className={styles.stateActions}>
              <button type="button" className="btn" onClick={load}>
                Retry
              </button>
              <Link to="/" className="btn">
                All works
              </Link>
            </div>
          </div>
        ) : data.tasks.length === 0 ? (
          <div className={styles.state}>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <p className="muted">{atSpaceRoot ? "No tasks yet." : "No subtasks in this task."}</p>
                <button type="button" className="btn primary" onClick={() => setEditor({ open: true, task: null })}>
                  <PlusIcon />
                  New task
                </button>
              </>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.state}>
            <p className="muted">No tasks match “{query}”.</p>
          </div>
        ) : (
          <div className={styles.scroll}>
            <TaskList tasks={visible} onOpen={openDetail} onToggleDone={toggleDone} onEnter={enterFolder} />
          </div>
        )}
      </main>

      <footer className={styles.statusBar}>
        <span>
          todo <b>{c.todo}</b>
        </span>
        <span>
          done <b>{c.done}</b>
        </span>
        <span>
          pending <b>{c.pending}</b>
        </span>
        <span className={`mono ${styles.path}`} title={data.absDir}>
          {data.absDir}
        </span>
        {settings?.editor && <span className="muted">editor: {settings.editor}</span>}
      </footer>

      <TaskDetailModal
        space={space}
        task={detail?.task || null}
        files={detail?.files || []}
        onClose={() => setDetail(null)}
        onEdit={(t) => setEditor({ open: true, task: t })}
        onToggleDone={toggleDone}
        onTogglePending={togglePending}
        onEnter={enterFolder}
        onOpenFolder={openFolder}
        onDelete={(t) => setConfirm(t)}
      />

      <TaskEditorModal
        isOpen={editor.open}
        task={editor.task}
        saving={saving}
        onCancel={() => setEditor({ open: false, task: null })}
        onSave={saveEditor}
      />

      <ConfirmModal
        isOpen={!!confirm}
        title="Delete task"
        message={confirm ? `Delete “${confirm.title || confirm.id}”? The whole task folder, including attachments and subtasks, is removed.` : ""}
        busy={deleting}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
