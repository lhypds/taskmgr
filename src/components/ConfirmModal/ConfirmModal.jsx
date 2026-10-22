import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal } from "@ui";
import styles from "./confirm.module.css";

// With `typeToConfirm`, the confirm button stays off until that text is typed in.
export default function ConfirmModal({ isOpen, title, message, confirmLabel, typeToConfirm, busy = false, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [isOpen, typeToConfirm]);
  const ready = !typeToConfirm || typed.trim() === typeToConfirm;
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title ?? t("common.confirm")} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConfirm();
        }}
      >
        <p className={styles.message}>{message}</p>
        {typeToConfirm && (
          <label className={styles.field}>
            <span className={styles.label}>{t("common.typeToConfirm", { name: typeToConfirm })}</span>
            <input className="input" value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={busy || !ready} autoFocus={!typeToConfirm}>
            {confirmLabel ?? t("common.delete")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
