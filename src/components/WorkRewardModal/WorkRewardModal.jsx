import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal } from "@ui";
import * as api from "@utils/api";
import styles from "./reward.module.css";

// Edit the reward of one work. It is written into taskmgr.json; an empty value removes it.
export default function WorkRewardModal({ work, onClose, onSaved }) {
  const { t } = useTranslation();
  const [reward, setReward] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!work) return;
    setReward(work.reward || "");
    setError("");
  }, [work]);

  async function save() {
    setSaving(true);
    try {
      const { works } = await api.saveWorkReward(work.work, reward);
      onSaved(works);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!work} onClose={onClose} title={t("reward.title", { work: work?.work })} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) save();
        }}
      >
        <input
          className="input"
          value={reward}
          placeholder={t("reward.placeholder")}
          autoFocus
          onChange={(e) => setReward(e.target.value)}
        />
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
