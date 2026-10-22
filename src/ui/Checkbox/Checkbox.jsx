import styles from "./checkbox.module.css";

// A checkbox drawn like the task list's done box, with its label after it.
export default function Checkbox({ checked, onChange, className, children }) {
  return (
    <label className={[styles.check, className].filter(Boolean).join(" ")}>
      <input type="checkbox" className={styles.input} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.box} aria-hidden="true" />
      {children}
    </label>
  );
}
