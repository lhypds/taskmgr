import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import { XIcon } from "@components/icons";
import { fileUrl } from "@utils/api";
import { formatSize, previewKind } from "@utils/task";
import styles from "./attachments.module.css";

// The files in a task folder, plus a drop zone to add more. `files` are the saved ones
// ({ name, rel, size, isDir }) and link to the file; `pending` are File objects not uploaded yet
// (a new task gets its files once it is created). A PDF, image or text file opens in onPreview;
// any other file opens in a new tab.
export default function Attachments({ className, space, files, pending = [], busy, selectedRel, onAdd, onRemove, onRemovePending, onPreview }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const add = (list) => {
    const picked = Array.from(list || []);
    if (picked.length) onAdd(picked);
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div className={styles.title}>{t("attach.title")}</div>
      <div
        className={styles.drop}
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        {files.length + pending.length > 0 && (
          <ul className={styles.files}>
            {files.map((f) => (
              <li key={f.rel} data-selected={f.rel === selectedRel}>
                {f.isDir ? (
                  <span className={styles.fileName}>{f.name}/</span>
                ) : (
                  <a
                    className={styles.fileName}
                    href={fileUrl(space, f.rel)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (!onPreview || !previewKind(f.name)) return;
                      e.preventDefault();
                      onPreview(f);
                    }}
                  >
                    {f.name}
                  </a>
                )}
                <span className={`muted ${styles.fileMeta}`}>{f.isDir ? t("attach.folder") : formatSize(f.size)}</span>
                {!f.isDir && (
                  <button type="button" className={styles.fileRemove} onClick={() => onRemove(f)} disabled={busy} aria-label={t("attach.remove", { name: f.name })}>
                    <XIcon />
                  </button>
                )}
              </li>
            ))}
            {pending.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className={styles.fileName}>{f.name}</span>
                <span className={`muted ${styles.fileMeta}`}>{formatSize(f.size)}</span>
                <button type="button" className={styles.fileRemove} onClick={() => onRemovePending(i)} aria-label={t("attach.remove", { name: f.name })}>
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className={`muted ${styles.dropHint}`}>
          {busy ? (
            t("attach.uploading")
          ) : (
            <>
              {t("attach.drop")}{" "}
              <button type="button" className={styles.pick} onClick={() => inputRef.current?.click()}>
                {t("attach.choose")}
              </button>
            </>
          )}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
