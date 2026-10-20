import { ChevronRightIcon } from "@components/icons";
import { labelList, formatStamp } from "@utils/task";
import styles from "./tasklist.module.css";

function DoneBox({ checked, onChange, title }) {
  return (
    <label className={styles.check} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className={styles.checkInput} checked={checked} onChange={onChange} />
      <span className={styles.box} aria-hidden="true" />
    </label>
  );
}

export default function TaskList({ tasks, onOpen, onToggleDone, onEnter }) {
  return (
    <div className={styles.table} role="table">
      <div className={`${styles.row} ${styles.head}`} role="row">
        <div />
        <div>id</div>
        <div>task</div>
        <div>labels</div>
        <div>origin</div>
        <div>edited</div>
        <div />
      </div>
      {tasks.map((t) => (
        <div
          key={t.rel}
          className={styles.row}
          data-status={t.status}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(t)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(t);
            }
          }}
        >
          <div>
            <DoneBox
              checked={t.status === "done"}
              onChange={() => onToggleDone(t)}
              title={t.status === "done" ? "Mark as todo" : "Mark as done"}
            />
          </div>
          <div className="mono">{t.id}</div>
          <div className={styles.title}>
            <span className={styles.titleText}>{t.title || <span className="muted">(untitled)</span>}</span>
            {t.status === "pending" && <span className="tag pending">pending</span>}
          </div>
          <div className={styles.labels}>
            {labelList(t.labels).map((l) => (
              <span key={l} className="tag">
                {l}
              </span>
            ))}
          </div>
          <div className={styles.origin}>{t.origin}</div>
          <div className="mono">{formatStamp(t.last_edit)}</div>
          <div className={styles.enter}>
            {t.hasSubtask && (
              <button
                type="button"
                className={styles.enterButton}
                title="Open subtasks"
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
