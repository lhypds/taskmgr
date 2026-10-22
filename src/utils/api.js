// Fired on window when the server answers that there is no session any more (it restarted, or
// the cookie expired). The auth store listens and takes the app back to the login page.
export const UNAUTHORIZED_EVENT = "taskmgr:unauthorized";

async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.code === "LOGIN_REQUIRED") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body.code || "";
    throw err;
  }
  return body;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const q = (params) => new URLSearchParams(params).toString();

// A space is one folder of tasks: { work, repository } with repository "" for the work's common tasks.
const sp = (space) => ({ work: space.work, repository: space.repository || "" });

// Resolves to { username }; rejects with status 401 on a wrong username or password.
export const login = (username, password) => request("/api/login", json("POST", { username, password }));

// Resolves to { username } for the current session; null when nobody is logged in.
export async function getSession() {
  const res = await fetch("/api/session", { cache: "no-store" });
  if (res.status === 401) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const logout = () => request("/api/session", { method: "DELETE" });

export const getSettings = () => request("/api/settings");

export const listSpaces = () => request("/api/spaces");

// The raw taskmgr.json: { configPath, text }. Saving resolves to the new { works }.
export const getConfig = () => request("/api/config");

export const saveConfig = (text) => request("/api/config", json("PUT", { text }));

// Set one work's reward ("" clears it); resolves to the new { works }.
export const saveWorkReward = (work, reward) => request("/api/work/reward", json("PUT", { work, reward }));

export const listTasks = (space, dir = "") => request(`/api/tasks?${q({ ...sp(space), dir })}`);

// fields: { status, labels, origin, details }
export const createTask = (space, dir, fields) => request("/api/tasks", json("POST", { ...sp(space), dir, ...fields }));

export const getTask = (space, rel) => request(`/api/task?${q({ ...sp(space), rel })}`);

export const updateTask = (space, rel, fields) => request("/api/task", json("PUT", { ...sp(space), rel, ...fields }));

// The raw task file, as the terminal's editor sees it.
export const getTaskText = (space, rel) => request(`/api/task/text?${q({ ...sp(space), rel })}`);

export const saveTaskText = (space, rel, text) => request("/api/task/text", json("PUT", { ...sp(space), rel, text }));

export const createTaskText = (space, dir, text) => request("/api/tasks/text", json("POST", { ...sp(space), dir, text }));

export const setStatus = (space, rel, status) => request("/api/task/status", json("POST", { ...sp(space), rel, status }));

export const openInFileManager = (space, rel) => request("/api/task/open", json("POST", { ...sp(space), rel }));

export const deleteTask = (space, rel) => request(`/api/task?${q({ ...sp(space), rel })}`, { method: "DELETE" });

// Upload one File into a task folder; resolves to the task's files after the upload.
export const uploadFile = (space, rel, file) =>
  request(`/api/task/file?${q({ ...sp(space), rel, name: file.name })}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });

export const deleteFile = (space, rel) => request(`/api/file?${q({ ...sp(space), rel })}`, { method: "DELETE" });

export const fileUrl = (space, rel, download = false) =>
  `/api/file?${q({ ...sp(space), rel, ...(download ? { download: "1" } : {}) })}`;

// Route to a space's task list.
export const spacePath = (work, repository) =>
  `/w/${encodeURIComponent(work)}` + (repository ? `/${encodeURIComponent(repository)}` : "");
