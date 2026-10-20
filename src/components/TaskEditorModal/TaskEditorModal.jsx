import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { splitDetails, joinDetails } from "@utils/task";
import styles from "./editor.module.css";

const EMPTY = { title: "", body: "", status: "todo", labels: "", origin: "" };

function fromTask(task) {
  if (!task) return EMPTY;
  const { title, body } = splitDetails(task.details);
  return { title, body, status: task.status || "todo", labels: task.labels || "", origin: task.origin || "" };
}

// Edits one task's fields, or collects them for a new one. `task` is null for a new task;
// `isOpen` is separate so a closed editor keeps its last values until it reopens.
export default function TaskEditorModal({ isOpen, task, saving, onCancel, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const titleRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(fromTask(task));
    // Focus after the modal has mounted its fields.
    const id = setTimeout(() => titleRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [isOpen, task]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e) {
    e?.preventDefault();
    if (saving) return;
    onSave({
      status: form.status,
      labels: form.labels.trim(),
      origin: form.origin.trim(),
      details: joinDetails(form.title, form.body),
    });
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={task ? "Edit task" : "New task"} closeOnOverlay={false} className={styles.modal}>
      <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input ref={titleRef} className="input" value={form.title} onChange={set("title")} placeholder="What needs doing?" />
        </label>

        <div className={styles.rowFields}>
          <label className={styles.field}>
            <span className={styles.label}>Status</span>
            <select className="select" value={form.status} onChange={set("status")}>
              <option value="todo">todo</option>
              <option value="done">done</option>
              <option value="pending">pending</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Origin</span>
            <input className="input" value={form.origin} onChange={set("origin")} placeholder="who asked" />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Labels</span>
          <input className="input" value={form.labels} onChange={set("labels")} placeholder="comma, separated" />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Details</span>
          <textarea className={`textarea ${styles.details}`} value={form.body} onChange={set("body")} rows={8} />
        </label>

        <div className={styles.actions}>
          <span className={`muted ${styles.hint}`}>{task ? `${task.rel}/task.txt` : "⌘S / Ctrl+S saves"}</span>
          <button type="button" className="btn lg" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn lg primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
