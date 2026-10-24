import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "@ui";
import * as api from "@utils/api";

// The runs of Claude Code (see ai/session.js), followed live over the server's event stream for as
// long as the page is open: `runs` is every run the server has, by id, each with its transcript
// (`items`) and its `pending` question. runFor(task) is the latest run of a task of the list (by
// its space and rel), start / answer / stop / dismiss act on one (an error shows as a toast).
// onAsk(run) is called when a run gets a question for the user, whatever task is shown.
export default function useRuns({ onAsk } = {}) {
  const [runs, setRuns] = useState({});
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  const asked = useRef(new Set()); // the ids of the questions onAsk was called for, each once

  useEffect(() => {
    const es = new EventSource(api.runEventsUrl);
    const parse = (e) => JSON.parse(e.data);
    // The server's state, whole: on connecting, and again after a reconnection (the browser's own).
    es.addEventListener("snapshot", (e) => {
      setRuns(Object.fromEntries(parse(e).runs.map((r) => [r.id, r])));
    });
    es.addEventListener("run", (e) => {
      const r = parse(e);
      if (r.pending && !asked.current.has(r.pending.id)) {
        asked.current.add(r.pending.id);
        askRef.current?.(r);
      }
      setRuns((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...r, items: prev[r.id]?.items || r.items || [] } }));
    });
    es.addEventListener("item", (e) => {
      const { run, i, item } = parse(e);
      setRuns((prev) => {
        const old = prev[run];
        if (!old) return prev;
        const items = old.items.slice();
        items[i] = item;
        return { ...prev, [run]: { ...old, items } };
      });
    });
    es.addEventListener("delta", (e) => {
      const { run, i, text } = parse(e);
      setRuns((prev) => {
        const old = prev[run];
        const it = old?.items[i];
        if (!it) return prev;
        const items = old.items.slice();
        items[i] = { ...it, text: (it.text || "") + text };
        return { ...prev, [run]: { ...old, items } };
      });
    });
    es.addEventListener("remove", (e) => {
      const { run } = parse(e);
      setRuns((prev) => {
        if (!prev[run]) return prev;
        const next = { ...prev };
        delete next[run];
        return next;
      });
    });
    return () => es.close();
  }, []);

  const runFor = useCallback(
    (task) => {
      if (!task?.space) return null;
      const key = `${task.space.work}/${task.space.repository || ""}/${task.rel}`;
      let latest = null;
      for (const r of Object.values(runs)) {
        if (r.task.key === key && (!latest || r.startedAt > latest.startedAt)) latest = r;
      }
      return latest;
    },
    [runs],
  );

  const put = (run) => setRuns((prev) => ({ ...prev, [run.id]: { ...prev[run.id], ...run, items: run.items || prev[run.id]?.items || [] } }));
  const failed = (e) => showToast(e.message, 4000, "bottom", "error");

  const start = useCallback(async (task) => {
    try {
      put((await api.startRun(task.space, task.rel)).run);
      return true;
    } catch (e) {
      failed(e);
      return false;
    }
  }, []);

  const answer = useCallback(async (run, body) => {
    if (!run.pending) return false;
    try {
      put((await api.answerRun(run.id, run.pending.id, body)).run);
      return true;
    } catch (e) {
      failed(e);
      return false;
    }
  }, []);

  const stop = useCallback(async (run) => {
    try {
      put((await api.stopRun(run.id)).run);
    } catch (e) {
      failed(e);
    }
  }, []);

  const dismiss = useCallback(async (run) => {
    try {
      await api.dismissRun(run.id);
      setRuns((prev) => {
        const next = { ...prev };
        delete next[run.id];
        return next;
      });
    } catch (e) {
      failed(e);
    }
  }, []);

  return { runs, runFor, start, answer, stop, dismiss };
}
