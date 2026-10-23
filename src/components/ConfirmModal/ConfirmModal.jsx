import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { isTyping } from "@utils/keys";
import styles from "./confirm.module.css";

// With `typeToConfirm`, the confirm button stays off until that text is typed in.
export default function ConfirmModal({ isOpen, title, message, confirmLabel, typeToConfirm, busy = false, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [isOpen, typeToConfirm]);
  const ready = !typeToConfirm || typed.trim() === typeToConfirm;

  // d confirms, as it does on a file: press d to delete, then d again to go through with it.
  // Not while typing the name in the field.
  const confirmRef = useRef(null);
  useEffect(() => {
    confirmRef.current = () => ready && !busy && onConfirm();
  });
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key !== "d" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      e.preventDefault();
      confirmRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

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
            {confirmLabel ?? t("common.delete")} (d)
          </button>
        </div>
      </form>
    </Modal>
  );
}
