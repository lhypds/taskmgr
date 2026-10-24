import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import styles from "./modal.module.css";

// The dialogs open right now, oldest first. Escape closes only the newest, so a confirm
// opened from a detail view goes before the detail view under it.
const openStack = [];

// `headerLeft` goes before the title at the left end of the header, `headerActions` before the
// close button at the right end.
const Modal = ({ isOpen, onClose, title, children, closeOnOverlay = true, className, headerLeft, headerActions, onEscape }) => {
  const { t } = useTranslation();
  // A click only counts as "outside" when it both starts and ends on the overlay. A drag that
  // begins inside the dialog (selecting text in a field) and is released over the backdrop
  // must not close it.
  const pressedOnOverlay = useRef(false);
  // The latest onClose, read at key time, so a new callback each render does not re-register
  // the dialog and move it to the top of the stack.
  const onCloseRef = useRef(onClose);
  // What Escape does instead of closing, when given (e.g. let go of a selection first).
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onCloseRef.current = onClose;
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!isOpen) return;
    const token = {};
    openStack.push(token);
    const handleKeyDown = (e) => {
      if (e.key !== "Escape" || openStack.at(-1) !== token) return;
      e.preventDefault();
      e.stopPropagation();
      (onEscapeRef.current || onCloseRef.current)?.();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const index = openStack.lastIndexOf(token);
      if (index !== -1) openStack.splice(index, 1);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayPointerDown = (e) => {
    pressedOnOverlay.current = e.target === e.currentTarget;
  };
  const handleOverlayClick = (e) => {
    if (closeOnOverlay && e.target === e.currentTarget && pressedOnOverlay.current) onClose?.();
    pressedOnOverlay.current = false;
  };

  return (
    <div className={styles.overlay} onPointerDown={handleOverlayPointerDown} onClick={handleOverlayClick}>
      <div
        className={[styles.modal, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : t("common.dialog")}
      >
        <div className={styles.header}>
          {headerLeft}
          {title && <span className={styles.title}>{title}</span>}
          <div className={styles.headerRight}>
            {headerActions}
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t("common.close")}>
              ✕
            </button>
          </div>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
};

export default Modal;
