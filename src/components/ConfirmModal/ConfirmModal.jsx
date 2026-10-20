import { Modal } from "@ui";
import styles from "./confirm.module.css";

export default function ConfirmModal({ isOpen, title = "Confirm", message, confirmLabel = "Delete", busy = false, onCancel, onConfirm }) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} className={styles.modal}>
      <div className={styles.body}>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn lg primary" onClick={onConfirm} disabled={busy} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
