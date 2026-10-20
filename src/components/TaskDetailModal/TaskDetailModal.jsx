import { Modal } from "@ui";
import { CheckIcon, ClockIcon, EditIcon, TrashIcon, FolderIcon, ChevronRightIcon, ExternalIcon } from "@components/icons";
import { fileUrl } from "@utils/api";
import { splitDetails, labelList, formatStamp, formatSize } from "@utils/task";
import styles from "./detail.module.css";

export default function TaskDetailModal({
  space,
  task,
  files,
  onClose,
  onEdit,
  onToggleDone,
  onTogglePending,
  onEnter,
  onOpenFolder,
  onDelete,
}) {
  const isOpen = !!task;
  const { title, body } = splitDetails(task?.details);
  const labels = labelList(task?.labels);
  const subtasks = (files || []).filter((f) => f.isSubtask);
  const attachments = (files || []).filter((f) => !f.isSubtask);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || "(untitled)"} className={styles.modal}>
      {task && (
        <div className={styles.body}>
          <dl className={styles.meta}>
            <dt>status</dt>
            <dd>
              <span className={`tag ${task.status}`}>{task.status}</span>
            </dd>
            <dt>id</dt>
            <dd className="mono">{task.id}</dd>
            <dt>edited</dt>
            <dd className="mono">{formatStamp(task.last_edit) || "—"}</dd>
            <dt>origin</dt>
            <dd>{task.origin || <span className="muted">—</span>}</dd>
            <dt>labels</dt>
            <dd className={styles.labels}>
              {labels.length ? labels.map((l) => <span key={l} className="tag">{l}</span>) : <span className="muted">—</span>}
            </dd>
          </dl>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Details</div>
            {body ? <pre className={styles.details}>{body}</pre> : <p className="muted">No details.</p>}
          </div>

          {subtasks.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Subtasks</div>
              <button type="button" className="btn" onClick={() => onEnter(task)}>
                <ChevronRightIcon />
                Open {subtasks.length} subtask{subtasks.length === 1 ? "" : "s"}
              </button>
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Attachments</div>
            {attachments.length ? (
              <ul className={styles.files}>
                {attachments.map((f) => (
                  <li key={f.rel}>
                    {f.isDir ? (
                      <span>{f.name}/</span>
                    ) : (
                      <a href={fileUrl(space, f.rel)} target="_blank" rel="noreferrer">
                        {f.name}
                      </a>
                    )}
                    <span className={`muted ${styles.fileMeta}`}>{f.isDir ? "folder" : formatSize(f.size)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No attachments. Drop files into the task folder to attach them.</p>
            )}
          </div>

          <div className={styles.actions}>
            <button type="button" className="btn" onClick={() => onToggleDone(task)}>
              <CheckIcon />
              {task.status === "done" ? "Mark todo" : "Mark done"}
            </button>
            <button type="button" className="btn" onClick={() => onTogglePending(task)}>
              <ClockIcon />
              {task.status === "pending" ? "Resume" : "Pending"}
            </button>
            <button type="button" className="btn" onClick={() => onEdit(task)}>
              <EditIcon />
              Edit
            </button>
            <button type="button" className="btn" onClick={() => onOpenFolder(task)} title="Open the task folder in the file manager">
              <FolderIcon />
              Folder
              <ExternalIcon />
            </button>
            <span className={styles.spacer} />
            <button type="button" className="btn danger" onClick={() => onDelete(task)}>
              <TrashIcon />
              Delete
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
