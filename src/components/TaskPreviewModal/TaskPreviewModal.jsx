import { Modal } from "@ui";
import styles from "./taskPreview.module.css";

// task.txt as the terminal's space preview shows it: blank lines at the ends dropped, each line trimmed.
function previewText(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines
    .slice(start, end)
    .map((line) => line.trim())
    .join("\n");
}

// Read-only look at a task's task.txt, opened with space and closed with space, q, enter or escape.
export default function TaskPreviewModal({ task, onClose }) {
  return (
    <Modal isOpen={!!task} onClose={onClose} className={styles.modal}>
      <pre className={styles.text}>{previewText(task?.details)}</pre>
    </Modal>
  );
}
