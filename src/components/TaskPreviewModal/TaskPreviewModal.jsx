import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { FolderIcon, TrashIcon } from "@components/icons";
import { fileUrl } from "@utils/api";
import { formatSize, previewKind } from "@utils/task";
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

// An icon button at the left end of the header, grey until hovered like the close button.
function HeaderButton({ label, onClick, children }) {
  return (
    <button type="button" className={styles.headerButton} title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

// Look at a task's task.txt, with its attachments under it (`files`, the one at
// `selectedRel` marked; Home moves it with j / k and opens it with enter; esc calls onUnselect first; double click or `onEdit` starts the edit; with `editing`, e / i in Home, the text is a textarea saved by onSave), a click on a file (or enter) opens it through `onOpenFile`, which previews a PDF, image or text file instead of downloading it; the buttons at the top left open the task's folder (`onOpenFolder`) and delete the task (`onDelete`, which asks first); opened with space or a double click on the task and closed with space, q, enter or escape.
export default function TaskPreviewModal({ task, files, selectedRel, onUnselect, editing, onEdit, onEndEdit, onSave, onOpenFile, onOpenFolder, onDelete, onClose }) {
  const { t } = useTranslation();
  const textRef = useRef(null);
  const onEscape = editing ? () => textRef.current?.blur() : selectedRel ? onUnselect : undefined;
  const actions = task && (
    <div className={styles.headerButtons}>
      <HeaderButton label={t("tree.openFolder")} onClick={() => onOpenFolder(task)}>
        <FolderIcon />
      </HeaderButton>
      <HeaderButton label={t("delete.title")} onClick={() => onDelete(task)}>
        <TrashIcon />
      </HeaderButton>
    </div>
  );
  return (
    <Modal isOpen={!!task} onClose={onClose} onEscape={onEscape} className={styles.modal} headerLeft={actions}>
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
                    <a
                      href={fileUrl(task.space, f.rel)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        if (!onOpenFile || !previewKind(f.name)) return;
                        e.preventDefault();
                        onOpenFile(f);
                      }}
                    >
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
