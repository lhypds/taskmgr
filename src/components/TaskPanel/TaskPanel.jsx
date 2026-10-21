import { useTranslation } from "react-i18next";
import Attachments, { useTaskFiles } from "@components/Attachments";
import { EditIcon, ChevronRightIcon } from "@components/icons";
import { splitDetails, labelList, formatStamp } from "@utils/task";
import styles from "./panel.module.css";

// The selected task, read-only, beside the list: its fields, details and attachments (files can
// be dropped in here too). `version` reloads the attachments when the list reloads.
export default function TaskPanel({ space, task, version, onEdit, onEnter, onPreview }) {
  const { t } = useTranslation();
  const { files, uploading, add, remove } = useTaskFiles(space, task?.rel, version);

  if (!task) {
    return (
      <div className={styles.empty}>
        <p className="muted">{t("panel.none")}</p>
      </div>
    );
  }

  const { title, body } = splitDetails(task.details);
  const labels = labelList(task.labels);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title || <span className="muted">{t("common.untitled")}</span>}</h2>
        <button type="button" className="btn" onClick={() => onEdit(task)}>
          <EditIcon />
          {t("common.edit")}
        </button>
      </div>

      <dl className={styles.meta}>
        <dt>{t("field.status")}</dt>
        <dd>
          <span className={`tag ${task.status}`}>{t(`status.${task.status}`)}</span>
        </dd>
        <dt>{t("field.id")}</dt>
        <dd className="mono">{task.id}</dd>
        <dt>{t("field.edited")}</dt>
        <dd className="mono">{formatStamp(task.last_edit) || "—"}</dd>
        <dt>{t("field.origin")}</dt>
        <dd>{task.origin || <span className="muted">—</span>}</dd>
        <dt>{t("field.labels")}</dt>
        <dd className={styles.labels}>
          {labels.length ? labels.map((l) => <span key={l} className="tag">{l}</span>) : <span className="muted">—</span>}
        </dd>
      </dl>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t("panel.details")}</div>
        {body ? <pre className={styles.details}>{body}</pre> : <p className="muted">{t("panel.noDetails")}</p>}
      </div>

      {task.hasSubtask && (
        <button type="button" className={`btn ${styles.subtasks}`} onClick={() => onEnter(task)}>
          <ChevronRightIcon />
          {t("common.subtasks")}
        </button>
      )}

      <Attachments space={space} files={files} busy={uploading} onAdd={add} onRemove={remove} onPreview={onPreview} />
    </div>
  );
}
