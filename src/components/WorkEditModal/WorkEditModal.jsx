import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal } from "@ui";
import * as api from "@utils/api";
import IncomeFields, { useIncomeFields, readIncome } from "@components/IncomeFields";
import styles from "./work.module.css";

// Edit one work: its name, and whether it has income; if it does, its income as two lists, monthly
// and one-time, each of amount and currency. Both are written into taskmgr.json; "no income" removes
// the income. Given an `origin` ({ origin, income }) instead, it edits that origin's name and income
// the same way. onSaved gets the new { works, origins } and the new name.
export default function WorkEditModal({ work, origin, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const income = useIncomeFields();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { reset } = income;
  useEffect(() => {
    if (!work && !origin) return;
    setName(origin ? origin.origin : work.work);
    reset((origin || work).income);
    setError("");
  }, [work, origin, reset]);

  async function save() {
    const newName = name.trim();
    if (!newName) {
      setError(t("work.nameEmpty"));
      return;
    }
    const read = readIncome(income);
    if (read.error) {
      setError(t(read.error));
      return;
    }
    setSaving(true);
    try {
      const spaces = origin
        ? await api.saveOrigin(origin.origin, { name: newName, income: read.income })
        : await api.saveWork(work.work, { name: newName, income: read.income });
      onSaved(spaces, newName);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!work || !!origin} onClose={onClose} title={origin ? origin.origin : work?.work || ""} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) save();
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>{t("work.name")}</span>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>

        <IncomeFields fields={income} />

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
