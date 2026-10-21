import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import styles from "./confirm.module.css";

export default function ConfirmModal({ isOpen, title, message, confirmLabel, busy = false, onCancel, onConfirm }) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title ?? t("common.confirm")} className={styles.modal}>
      <div className={styles.body}>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn lg primary" onClick={onConfirm} disabled={busy} autoFocus>
            {confirmLabel ?? t("common.delete")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
