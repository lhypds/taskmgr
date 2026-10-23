import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { EditIcon, FolderIcon, TrashIcon } from "@components/icons";
import TreeLines from "@components/TreeLines";
import { describe, formatStamp } from "@utils/task";
import styles from "./tasklist.module.css";

function DoneBox({ checked, pending, onChange, title }) {
  return (
    <label className={styles.check} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className={styles.checkInput} checked={checked} onChange={onChange} />
      <span className={styles.box} data-pending={pending} aria-hidden="true">
        {pending ? "p" : null}
      </span>
    </label>
  );
}

// A small button at the right end of a row's title, shown while the row is hovered (as in the tree).
function RowButton({ label, className = "", onClick, children }) {
  return (
    <button
      type="button"
      className={`${styles.rowButton} ${className}`}
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

// Where a task is from: its repository (or work) name. A long name is cut short with an ellipsis,
// and the whole work / repository path shows on hover.
export function FromTag({ task }) {
  if (!task.from) return null;
  return (
    <span className="tag" title={task.from}>
      {task.fromParts.map((part, i) => (
        <span key={i} className={styles.fromPart}>
          {i > 0 && <span className={styles.fromSep}>/</span>}
          <span className={styles.fromName}>{part}</span>
        </span>
      ))}
    </span>
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

// The tasks as a tree, like the origins tree: `tasks` are the rows in order, each subtask under
// its task with its `depth`, `through` and `last` (see flattenTasks), drawn with tree lines before
// its title. `selectedKey` is the row the keyboard shortcuts act on; it is kept scrolled into
// view. A task's `from` (the work or repository it lives in, in a list of several) shows before
// its title; its subtasks are from the same place, so they do not repeat it.
export default function TaskList({ tasks, selectedKey, focused, onSelect, onOpenFolder, onToggleDone }) {
  const { t: tr } = useTranslation();
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  return (
    <div className={styles.table} role="table">
      <div className={`${styles.row} ${styles.head}`} data-focused={focused} role="row">
        <div />
        <div>{tr("field.created")}</div>
        <div>{tr("field.task")}</div>
      </div>
      {tasks.map((t) => {
        const detail = describe(t.details);
        return (
          <div
            key={t.key}
            ref={t.key === selectedKey ? selectedRef : null}
            className={`${styles.row}${t.key === selectedKey ? ` ${styles.selected}` : ""}`}
            data-status={t.status}
            data-depth={t.depth}
            role="button"
            tabIndex={0}
            onFocus={() => onSelect(t)}
            onClick={() => onSelect(t)}
            onDoubleClick={() => onOpenFolder(t)}
          >
            <div>
              <DoneBox
                checked={t.status === "done"}
                pending={t.status === "pending"}
                onChange={() => onToggleDone(t)}
                title={tr(t.status === "done" ? "list.markTodo" : "list.markDone")}
              />
            </div>
            <div className="mono">{formatStamp(t.id)}</div>
            <div className={styles.title} style={{ "--depth": t.depth }}>
              <TreeLines depth={t.depth} through={t.through} last={t.last} />
              <div className={styles.titleLines}>
                {t.depth === 0 && <FromTag task={t} />}
                <span className={styles.titleText}>
                  {t.title || <span className="muted">{tr("common.untitled")}</span>}
                  {detail && <span className={styles.detail}>{detail}</span>}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
