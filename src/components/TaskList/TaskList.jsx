import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { ChevronRightIcon } from "@components/icons";
import { formatStamp } from "@utils/task";
import styles from "./tasklist.module.css";

function DoneBox({ checked, onChange, title }) {
  return (
    <label className={styles.check} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className={styles.checkInput} checked={checked} onChange={onChange} />
      <span className={styles.box} aria-hidden="true" />
    </label>
  );
}

// `selectedRel` is the row the keyboard shortcuts act on; it is kept scrolled into view.
export default function TaskList({ tasks, selectedRel, onSelect, onOpen, onToggleDone, onEnter }) {
  const { t: tr } = useTranslation();
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedRel]);

  return (
    <div className={styles.table} role="table">
      <div className={`${styles.row} ${styles.head}`} role="row">
        <div />
        <div>{tr("field.id")}</div>
        <div>{tr("field.origin")}</div>
        <div>{tr("field.edited")}</div>
        <div>{tr("field.task")}</div>
        <div />
      </div>
      {tasks.map((t) => (
        <div
          key={t.rel}
          ref={t.rel === selectedRel ? selectedRef : null}
          className={`${styles.row}${t.rel === selectedRel ? ` ${styles.selected}` : ""}`}
          data-status={t.status}
          role="button"
          tabIndex={0}
          onFocus={() => onSelect(t)}
          onClick={() => {
            onSelect(t);
            onOpen(t);
          }}
        >
          <div>
            <DoneBox
              checked={t.status === "done"}
              onChange={() => onToggleDone(t)}
              title={tr(t.status === "done" ? "list.markTodo" : "list.markDone")}
            />
          </div>
          <div className="mono">{t.id}</div>
          <div className={styles.origin}>{t.origin}</div>
          <div className="mono">{formatStamp(t.last_edit)}</div>
          <div className={styles.title}>
            <span className={styles.titleText}>{t.title || <span className="muted">{tr("common.untitled")}</span>}</span>
            {t.status === "pending" && <span className="tag pending">{tr("status.pending")}</span>}
          </div>
          <div className={styles.enter}>
            {t.hasSubtask && (
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
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
