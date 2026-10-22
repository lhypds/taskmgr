import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal } from "@ui";
import * as api from "@utils/api";
import styles from "./name.module.css";

// Rename one repository. `repository` is { work, name }; the new name is written into taskmgr.json
// and passed to onSaved along with the new { works, origins }.
export default function RepositoryNameModal({ repository, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!repository) return;
    setName(repository.name);
    setError("");
  }, [repository]);

  async function save() {
    const newName = name.trim();
    if (!newName) {
      setError(t("repository.nameEmpty"));
      return;
    }
    if (newName === repository.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      onSaved(await api.renameRepository(repository.work, repository.name, newName), newName);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!repository} onClose={onClose} title={repository?.name || ""} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) save();
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>{t("repository.name")}</span>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving}>
            {t("editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
