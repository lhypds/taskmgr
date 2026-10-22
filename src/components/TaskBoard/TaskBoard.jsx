import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "@components/icons";
import { FromTag, TaskActions } from "@components/TaskList";
import { formatStamp, splitDetails } from "@utils/task";
import styles from "./board.module.css";

export const BOARD_STATUSES = ["todo", "done", "pending"];

// The column a task sits in: anything that is not done or pending is still to do.
export const boardStatus = (task) =>
  BOARD_STATUSES.includes(task.status) ? task.status : "todo";

// The progress view: a column per status with the tasks as cards. Dragging a card into another
// column sets the task to that status (`onMove`). As in the list, a click only selects.
export default function TaskBoard({
  tasks,
  selectedKey,
  onSelect,
  onOpen,
  onOpenFolder,
  onDelete,
  onEnter,
  onMove,
}) {
  const { t: tr } = useTranslation();
  const [dragKey, setDragKey] = useState(null);
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  function drop(status) {
    const task = tasks.find((t) => t.key === dragKey);
    setDragKey(null);
    if (task && boardStatus(task) !== status) onMove(task, status);
  }

  return (
    <div className={styles.board}>
      {BOARD_STATUSES.map((status) => {
        const cards = tasks.filter((t) => boardStatus(t) === status);
        return (
          <section
            key={status}
            className={styles.column}
            data-status={status}
            onDragOver={(e) => {
              if (!dragKey) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(status);
            }}
          >
            <header className={styles.columnHead}>
              <span>{tr(`status.${status}`)}</span>
              <span className={styles.count}>{cards.length}</span>
            </header>
            <div className={styles.cards}>
              {cards.map((t) => {
                const detail = splitDetails(t.details).body.replace(/\s+/g, " ").trim();
                return (
                  <div
                    key={t.key}
                    ref={t.key === selectedKey ? selectedRef : null}
                    className={styles.card}
                    data-selected={t.key === selectedKey}
                    data-dragging={t.key === dragKey}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.title || t.id);
                      setDragKey(t.key);
                      onSelect(t);
                    }}
                    onDragEnd={() => setDragKey(null)}
                    onFocus={() => onSelect(t)}
                    onClick={() => onSelect(t)}
                    onDoubleClick={() => onOpenFolder(t)}
                  >
                    <div className={styles.cardTitle}>
                      <FromTag task={t} />
                      <span className={styles.cardName}>
                        {t.title || (
                          <span className="muted">{tr("common.untitled")}</span>
                        )}
                      </span>
                      {detail && (
                        <>
                          {" "}
                          <span className={styles.cardDetail}>{detail}</span>
                        </>
                      )}
                    </div>
                    {t.hasSubtask && (
                      <div className={styles.cardFoot}>
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
                    <div className={`mono ${styles.cardStamp}`}>{formatStamp(t.id)}</div>
                    <TaskActions
                      task={t}
                      className={styles.actions}
                      onOpen={onOpen}
                      onOpenFolder={onOpenFolder}
                      onDelete={onDelete}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
