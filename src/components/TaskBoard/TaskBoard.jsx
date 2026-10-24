import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { FromTag, TaskActions } from "@components/TaskList";
import TreeLines from "@components/TreeLines";
import { describe, formatStamp } from "@utils/task";
import styles from "./board.module.css";

// Every column the board can have, in order; the "aborted" column shows only when aborted tasks
// are shown (`statuses` says which columns a board has).
export const BOARD_STATUSES = ["todo", "done", "pending", "aborted"];

// A task's own status as a column: anything that is not done, pending or aborted is still to do.
const ownStatus = (task) => (BOARD_STATUSES.includes(task.status) ? task.status : "todo");

// The column a task sits in: a subtask's is its task's (`column`, set when the rows are built),
// whatever its own status; a task at the top sits in the column of its status.
export const boardStatus = (task) => task.column || ownStatus(task);

// The progress view: a column per status in `statuses` with the tasks as cards, each task's subtasks as cards
// under it, drawn as a tree like the list (`tasks` are the rows in order, with their `depth`,
// `through` and `last`, see flattenTasks). Dragging a card into another column sets the task to
// that status (`onMove`); a subtask stays under its task, in grey when its status is not the
// column's. As in the list, a click only selects and a double click opens the preview (`onPreview`).
export default function TaskBoard({
  tasks,
  statuses = BOARD_STATUSES,
  selectedKey,
  focusedStatus,
  onFocusStatus,
  onSelect,
  onPreview,
  onOpen,
  onOpenFolder,
  onDelete,
  onMove,
}) {
  const [dragKey, setDragKey] = useState(null);
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  function drop(status) {
    const task = tasks.find((t) => t.key === dragKey);
    setDragKey(null);
    if (task && ownStatus(task) !== status) onMove(task, status);
  }

  return (
    <div className={styles.board} style={{ "--columns": statuses.length }}>
      {statuses.map((status) => (
        <Column
          key={status}
          status={status}
          cards={tasks.filter((t) => boardStatus(t) === status)}
          selectedKey={selectedKey}
          selectedRef={selectedRef}
          focused={status === focusedStatus}
          dragKey={dragKey}
          onFocus={() => onFocusStatus(status)}
          onDragOver={(e) => {
            if (!dragKey) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(status);
          }}
          onDragStart={(e, t) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", t.title || t.id);
            setDragKey(t.key);
            onSelect(t);
          }}
          onDragEnd={() => setDragKey(null)}
          onSelect={onSelect}
          onPreview={onPreview}
          onOpen={onOpen}
          onOpenFolder={onOpenFolder}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// One column: its head with the number of cards, then the cards.
function Column({
  status,
  cards,
  selectedKey,
  selectedRef,
  focused,
  dragKey,
  onFocus,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  onSelect,
  onPreview,
  onOpen,
  onOpenFolder,
  onDelete,
}) {
  const { t: tr } = useTranslation();

  return (
    <section
      className={styles.column}
      data-status={status}
      data-focused={focused}
      onMouseDown={(e) => {
        e.stopPropagation();
        onFocus();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className={styles.columnHead}>
        <span>{tr(`status.${status}`)}</span>
        <span className={styles.count}>{cards.length}</span>
      </header>
      <div className={styles.cards}>
        {cards.map((t) => {
          const detail = describe(t.details);
          return (
            <div key={t.key} className={styles.cardRow} style={{ "--depth": t.depth || 0 }}>
              <TreeLines depth={t.depth || 0} through={t.through} last={t.last} />
              <div
                ref={t.key === selectedKey ? selectedRef : null}
                className={styles.card}
                data-selected={t.key === selectedKey}
                data-dragging={t.key === dragKey}
                data-off={ownStatus(t) !== status}
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) => onDragStart(e, t)}
                onDragEnd={onDragEnd}
                onFocus={() => onSelect(t)}
                onClick={() => onSelect(t)}
                onDoubleClick={() => onPreview(t)}
              >
                <div className={styles.cardTitle}>
                  <FromTag task={t} />
                  <span className={styles.cardName}>{t.title || <span className="muted">{tr("common.untitled")}</span>}</span>
                  {detail && <span className={styles.cardDetail}>{detail}</span>}
                </div>
                <div className={`mono ${styles.cardStamp}`}>{formatStamp(t.id)}</div>
                <TaskActions task={t} className={styles.actions} onOpen={onOpen} onOpenFolder={onOpenFolder} onDelete={onDelete} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
