import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { ChevronRightIcon, EditIcon, FolderIcon, TrashIcon } from "@components/icons";
import { formatStamp, splitDetails } from "@utils/task";
import styles from "./tasklist.module.css";

function DoneBox({ checked, onChange, title }) {
  return (
    <label className={styles.check} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className={styles.checkInput} checked={checked} onChange={onChange} />
      <span className={styles.box} aria-hidden="true" />
    </label>
  );
}

// A small button at the right end of a row's title, shown while the row is hovered (as in the tree).
function RowButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      className={styles.rowButton}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// A task's edit, open folder and delete buttons, shown while its row (or card) is hovered.
export function TaskActions({ task, className = "", onOpen, onOpenFolder, onDelete }) {
  const { t: tr } = useTranslation();
  return (
    <div className={`${styles.rowActions} ${className}`}>
      <RowButton label={tr("common.edit")} onClick={() => onOpen(task)}>
        <EditIcon />
      </RowButton>
      <RowButton label={tr("tree.openFolder")} onClick={() => onOpenFolder(task)}>
        <FolderIcon />
      </RowButton>
      <RowButton label={tr("delete.title")} onClick={() => onDelete(task)}>
        <TrashIcon />
      </RowButton>
    </div>
  );
}

// `selectedKey` is the row the keyboard shortcuts act on; it is kept scrolled into view. A task's
// `from` (the work or repository it lives in, in a list of several) shows before its title.
export default function TaskList({ tasks, selectedKey, onSelect, onOpenFolder, onToggleDone, onEnter }) {
  const { t: tr } = useTranslation();
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  return (
    <div className={styles.table} role="table">
      <div className={`${styles.row} ${styles.head}`} role="row">
        <div />
        <div>{tr("field.created")}</div>
        <div>{tr("field.task")}</div>
      </div>
      {tasks.map((t) => (
        <div
          key={t.key}
          ref={t.key === selectedKey ? selectedRef : null}
          className={`${styles.row}${t.key === selectedKey ? ` ${styles.selected}` : ""}`}
          data-status={t.status}
          role="button"
          tabIndex={0}
          onFocus={() => onSelect(t)}
          onClick={() => onSelect(t)}
          onDoubleClick={() => onOpenFolder(t)}
        >
          <div>
            <DoneBox
              checked={t.status === "done"}
              onChange={() => onToggleDone(t)}
              title={tr(t.status === "done" ? "list.markTodo" : "list.markDone")}
            />
          </div>
          <div className="mono">{formatStamp(t.id)}</div>
          <div className={styles.title}>
            {t.from && <span className="tag">{t.from}</span>}
            <span className={styles.titleText}>
              {t.title || <span className="muted">{tr("common.untitled")}</span>}
              <span className={styles.detail}>{splitDetails(t.details).body.split("\n")[0]}</span>
            </span>
            {t.status === "pending" && <span className="tag pending">{tr("status.pending")}</span>}
          </div>
          {t.hasSubtask && (
            <div className={styles.enter}>
              <button
                type="button"
                className={styles.enterButton}
                title={tr("list.openSubtasks")}
                onClick={(e) => {
                  e.stopPropagation();
                  onEnter(t);
                }}
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
