import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { fileUrl } from "@utils/api";
import { formatSize } from "@utils/task";
import styles from "./taskPreview.module.css";

// task.txt as the terminal's space preview shows it: blank lines at the ends dropped, each line trimmed.
function previewText(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines
    .slice(start, end)
    .map((line) => line.trim())
    .join("\n");
}

// task.txt in a textarea, caret at the end. A blur saves and ends the edit, and so does esc; cmd/ctrl+s saves and keeps editing.
function Editor({ task, textRef, onSave, onEndEdit }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(task.details);

  useEffect(() => {
    const el = textRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [textRef]);

  const save = () => {
    if (draft !== task.details) onSave(task, draft);
  };

  return (
    <textarea
      ref={textRef}
      className={styles.text}
      value={draft}
      placeholder={t("common.untitled")}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        save();
        onEndEdit();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          save();
        }
      }}
    />
  );
}

// Look at a task's task.txt, with its attachments under it (`files`, the one at
// `selectedRel` marked; Home moves it with j / k and opens it with enter; esc calls onUnselect first; double click or `onEdit` starts the edit; with `editing`, e / i in Home, the text is a textarea saved by onSave), opened with space and closed with space, q, enter or escape.
export default function TaskPreviewModal({ task, files, selectedRel, onUnselect, editing, onEdit, onEndEdit, onSave, onClose }) {
  const { t } = useTranslation();
  const textRef = useRef(null);
  const onEscape = editing ? () => textRef.current?.blur() : selectedRel ? onUnselect : undefined;
  return (
    <Modal isOpen={!!task} onClose={onClose} onEscape={onEscape} className={styles.modal}>
      <div className={styles.body}>
        {editing && task ? (
          <Editor key={task.key} task={task} textRef={textRef} onSave={onSave} onEndEdit={onEndEdit} />
        ) : (
          <pre className={styles.text} onDoubleClick={onEdit}>
            {previewText(task?.details)}
          </pre>
        )}
        {task && files.length > 0 && (
          <div className={styles.files}>
            <div className="muted">{t("attach.title")}</div>
            <ul>
              {files.map((f) => (
                <li key={f.rel} data-selected={f.rel === selectedRel}>
                  {f.isDir ? (
                    <span>{f.name}/</span>
                  ) : (
                    <a href={fileUrl(task.space, f.rel)} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  )}
                  {!f.isDir && <span className="muted"> {formatSize(f.size)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
