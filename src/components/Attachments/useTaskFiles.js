import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "../../i18n";
import { showToast } from "@ui";
import * as api from "@utils/api";

const attachmentsOf = (files) => files.filter((f) => !f.isSubtask);

// The attachments of one task folder, loaded while `rel` is set, with upload and delete (remove asks first unless ask is false, and says whether it deleted).
// `version` re-reads them when it changes (e.g. after the task list reloads); the files shown stay
// until the fresh ones arrive, so nothing flickers. Another task (by work, repository and rel, not
// by the identity of `space`, which the list remakes) starts from no files.
export default function useTaskFiles(space, rel, version) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const taskKey = space && rel ? `${space.work}/${space.repository || ""}/${rel}` : null;
  const shown = useRef(null); // the taskKey the files are of

  useEffect(() => {
    if (shown.current !== taskKey) {
      shown.current = taskKey;
      setFiles([]);
    }
    if (!taskKey) return;
    let stale = false;
    api
      .getTask(space, rel)
      .then((d) => !stale && setFiles(attachmentsOf(d.files)))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [taskKey, version]); // space and rel are what taskKey is made of

  const add = useCallback(
    async (list) => {
      setUploading(true);
      try {
        let latest;
        for (const f of list) latest = await api.uploadFile(space, rel, f);
        setFiles(attachmentsOf(latest.files));
      } catch (e) {
        showToast(e.message, 4000);
      } finally {
        setUploading(false);
      }
    },
    [space, rel],
  );

  const remove = useCallback(
    async (file, ask = true) => {
      if (ask && !window.confirm(i18n.t("attach.deleteConfirm", { name: file.name }))) return false;
      try {
        const d = await api.deleteFile(space, file.rel);
        setFiles(attachmentsOf(d.files));
        return true;
      } catch (e) {
        showToast(e.message, 4000);
        return false;
      }
    },
    [space],
  );

  return { files, uploading, add, remove };
}
