import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal, TextArea } from "@ui";
import { TrashIcon, ChevronRightIcon } from "@components/icons";
import Attachments, { useTaskFiles } from "@components/Attachments";
import * as api from "@utils/api";
import styles from "./editor.module.css";

// A new task file as the terminal writes one: the front matter, then the details, whose first
// line becomes the title. last_edit is stamped on save.
const TEMPLATE = "---\nstatus: todo\nlabels: \norigin: \nlast_edit: \n---\n\n";

// The task file in one text area, the way the terminal opens it in $EDITOR. `task` is null for a
// new task; `isOpen` is separate so a closed editor keeps its last text until it reopens.
// An existing task uploads attachments right away and gets buttons to go into its subtasks and
// delete it; a new task keeps its attachments until it is saved (onSave(text, files)).
export default function TaskEditorModal({ isOpen, space, task, saving, onCancel, onSave, onEnter, onDelete, onPreview }) {
  const { t } = useTranslation();
  const [text, setText] = useState(null); // null while the file loads
  const [pending, setPending] = useState([]); // File objects for a new task
  const { files, uploading, add, remove } = useTaskFiles(space, isOpen ? task?.rel : null);
  const textRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setPending([]);
    if (!task) {
      setText(TEMPLATE);
      return;
    }
    setText(null);
    let stale = false;
    api
      .getTaskText(space, task.rel)
      .then((d) => !stale && setText(d.text))
      .catch((e) => !stale && setText(`${e.message}`));
    return () => {
      stale = true;
    };
  }, [isOpen, task, space]);

  // Once the text is in, focus it with the caret at the end, where the details go.
  const loaded = text !== null;
  useEffect(() => {
    if (!isOpen || !loaded) return;
    const el = textRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isOpen, loaded]);

  function submit(e) {
    e?.preventDefault();
    if (saving || uploading || text === null) return;
    onSave(text, pending);
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={task ? task.title || t("common.untitled") : t("editor.newTask")} closeOnOverlay={false} className={styles.modal}>
      <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
        <TextArea
          ref={textRef}
          className={styles.text}
          minHeight={320}
          value={text ?? ""}
          placeholder={text === null ? t("common.loading") : ""}
          disabled={text === null}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label={task ? task.title || t("common.untitled") : t("editor.newTask")}
        />

        <Attachments
          space={space}
          onPreview={onPreview}
          files={files}
          pending={pending}
          busy={uploading}
          onAdd={(list) => (task ? add(list) : setPending((p) => [...p, ...list]))}
          onRemove={remove}
          onRemovePending={(i) => setPending((p) => p.filter((_, j) => j !== i))}
        />

        <div className={styles.actions}>
          {task ? (
            <>
              {task.hasSubtask && (
                <button type="button" className="btn" onClick={() => onEnter(task)}>
                  <ChevronRightIcon />
                  {t("common.subtasks")}
                </button>
              )}
              <button type="button" className="btn" onClick={() => onDelete(task)}>
                <TrashIcon />
                {t("common.delete")}
              </button>
              <span className={styles.spacer} />
            </>
          ) : (
            <span className={`muted ${styles.hint}`}>{t("editor.saveHint")}</span>
          )}
          <button type="button" className="btn lg" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving || uploading || text === null}>
            {saving ? t("editor.saving") : t("editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
