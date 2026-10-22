import { useTranslation } from "react-i18next";
import Attachments, { useTaskFiles } from "@components/Attachments";
import { EditIcon, ChevronRightIcon } from "@components/icons";
import { splitDetails, formatStamp } from "@utils/task";
import styles from "./panel.module.css";

// The selected task, read-only, beside the list: its fields, details and attachments (files can
// be dropped in here too). `version` reloads the attachments when the list reloads.
// Under a head like the tree's: "Task", with the edit button at its right.
export default function TaskPanel(props) {
  const { t } = useTranslation();
  const { task, onEdit } = props;
  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.barTitle}>{t("panel.heading")}</span>
        <div className={styles.barActions}>
          {task && (
            <button type="button" className="btn" onClick={() => onEdit(task)} title={t("common.edit")} aria-label={t("common.edit")}>
              <EditIcon />
            </button>
          )}
        </div>
      </div>
      {props.task ? (
        <TaskDetails {...props} />
      ) : (
        <div className={styles.empty}>
          <p className="muted">{t("panel.none")}</p>
        </div>
      )}
    </div>
  );
}

function TaskDetails({ space, task, version, onEnter, onPreview }) {
  const { t } = useTranslation();
  const { files, uploading, add, remove } = useTaskFiles(space, task.rel, version);

  const { title, body } = splitDetails(task.details);

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>{title || <span className="muted">{t("common.untitled")}</span>}</h2>

      <dl className={styles.meta}>
        <dt>{t("field.status")}</dt>
        <dd>
          <span className={`tag ${task.status}`}>{t(`status.${task.status}`)}</span>
        </dd>
        <dt>{t("field.id")}</dt>
        <dd className="mono">{task.id}</dd>
        <dt>{t("field.created")}</dt>
        <dd className="mono">{formatStamp(task.id)}</dd>
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
