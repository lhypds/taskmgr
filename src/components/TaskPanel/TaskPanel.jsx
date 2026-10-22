import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { RedoIcon, TrashIcon, UndoIcon } from "@components/icons";
import styles from "./panel.module.css";

// The selected task beside the list: its task.txt as written, editable in place. It is saved
// when the text loses focus or on cmd/ctrl+s; esc ends the edit, saving it. onSave(task, text)
// writes it. When `focusKey` is the task's key, its text takes the focus and onFocused is called.
// Under a head like the tree's: "Task", with undo, redo and delete at its right; onDelete(task)
// asks before deleting.
export default function TaskPanel({ task, focused, focusKey, onFocused, onSave, onDelete }) {
  const { t } = useTranslation();
  const textRef = useRef(null);

  // The text's own undo history, the one cmd/ctrl+z walks, so the buttons and the keys agree. The
  // text keeps the focus (the buttons do not take it on mousedown), so a click does not save it.
  function edit(command) {
    const el = textRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command);
  }

  return (
    <div className={styles.root}>
      <div className={styles.bar} data-focused={focused}>
        <span className={styles.barTitle}>{t("panel.heading")}</span>
        <div className={styles.barActions}>
          <button
            type="button"
            className="btn"
            disabled={!task}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => edit("undo")}
            title={t("panel.undo")}
            aria-label={t("panel.undo")}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="btn"
            disabled={!task}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => edit("redo")}
            title={t("panel.redo")}
            aria-label={t("panel.redo")}
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            className="btn"
            disabled={!task}
            onClick={() => onDelete(task)}
            title={t("delete.title")}
            aria-label={t("delete.title")}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      {task ? (
        // keyed by id, which a rename (a new first line) keeps, so saving does not lose the focus
        <TaskText
          key={`${task.space.work}/${task.space.repository || ""}/${task.id}`}
          task={task}
          textRef={textRef}
          focus={focusKey === task.key}
          onFocused={onFocused}
          onSave={onSave}
        />
      ) : (
        <div className={styles.empty}>
          <p className="muted">{t("panel.none")}</p>
        </div>
      )}
    </div>
  );
}

function TaskText({ task, textRef, focus, onFocused, onSave }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(task.details);
  const sent = useRef(null); // the text last saved, until the list reloads with it

  // Focus with the caret at the end, where the details go.
  useEffect(() => {
    const el = textRef.current;
    if (!focus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocused();
  }, [focus, onFocused, textRef]);

  // Take the reloaded text unless it was typed on since saving.
  useEffect(() => {
    setDraft((d) => (sent.current === null || d === sent.current ? task.details : d));
    sent.current = null;
  }, [task.details]);

  function save() {
    if (draft === task.details || draft === sent.current) return;
    sent.current = draft;
    onSave(task, draft);
  }

  return (
    <textarea
      ref={textRef}
      className={styles.text}
      value={draft}
      placeholder={t("common.untitled")}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.currentTarget.blur(); // saved by onBlur
        }
      }}
    />
  );
}
