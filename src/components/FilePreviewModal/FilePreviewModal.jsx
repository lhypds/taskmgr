import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal } from "@ui";
import { fileUrl } from "@utils/api";
import { previewKind } from "@utils/task";
import styles from "./preview.module.css";

function TextView({ url }) {
  const { t } = useTranslation();
  const [text, setText] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => !stale && setText(t))
      .catch((e) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [url]);

  if (error) return <p className={styles.note}>{error}</p>;
  if (text === null) return <p className={`muted ${styles.note}`}>{t("common.loading")}</p>;
  return <pre className={styles.text}>{text}</pre>;
}

// An attachment shown in the page: a PDF in the browser's own viewer, an image that zooms to full
// size on a click, or a text file as it is. `file` is { name, rel } from a task's files.
export default function FilePreviewModal({ space, file, onClose }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(false);
  useEffect(() => setZoom(false), [file]);

  const kind = file ? previewKind(file.name) : null;
  const url = file ? fileUrl(space, file.rel) : "";

  return (
    <Modal
      isOpen={!!file}
      onClose={onClose}
      title={file?.name}
      className={styles.modal}
      headerActions={
        file && (
          <a className="btn" href={fileUrl(space, file.rel, true)}>
            {t("preview.download")}
          </a>
        )
      }
    >
      {file && (
        <div className={styles.body}>
          {kind === "pdf" && <iframe className={styles.frame} src={url} title={file.name} />}
          {kind === "image" && (
            <div className={styles.image} data-zoom={zoom} onClick={() => setZoom((z) => !z)}>
              <img src={url} alt={file.name} draggable={false} />
            </div>
          )}
          {kind === "text" && <TextView url={url} />}
        </div>
      )}
    </Modal>
  );
}
