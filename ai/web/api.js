// The web UI's calls to the AI API (ai/routes.js): starting Claude Code on a task, answering what it
// asks, stopping and forgetting a run. The runs themselves arrive live on eventsUrl (see useRuns).
import { UNAUTHORIZED_EVENT } from "@utils/api";

async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.code === "LOGIN_REQUIRED") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// The event stream of every run: see GET /api/ai/events in ai/routes.js.
export const eventsUrl = "/api/ai/events";

// Start Claude Code on the task at `rel` in the space; resolves to { run } with its transcript (409
// while the task has a run going).
export const startRun = (space, rel) => request("/api/ai/run", json("POST", { work: space.work, repository: space.repository || "", rel }));

// Answer the run's pending question `pending`: { decision: "allow" | "deny" } for a permission,
// { answers: { "<question>": "<answer>" } } for a question. { run }.
export const answerRun = (id, pending, body) => request(`/api/ai/runs/${encodeURIComponent(id)}/answer`, json("POST", { pending, ...body }));

export const stopRun = (id) => request(`/api/ai/runs/${encodeURIComponent(id)}/stop`, json("POST", {}));

export const dismissRun = (id) => request(`/api/ai/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
