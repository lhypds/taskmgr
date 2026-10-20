async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
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

const q = (params) => new URLSearchParams(params).toString();

// A space is one folder of tasks: { work, project } with project "" for the work's common tasks.
const sp = (space) => ({ work: space.work, project: space.project || "" });

export const getSettings = () => request("/api/settings");

export const listSpaces = () => request("/api/spaces");

export const listTasks = (space, dir = "") => request(`/api/tasks?${q({ ...sp(space), dir })}`);

// fields: { status, labels, origin, details }
export const createTask = (space, dir, fields) => request("/api/tasks", json("POST", { ...sp(space), dir, ...fields }));

export const getTask = (space, rel) => request(`/api/task?${q({ ...sp(space), rel })}`);

export const updateTask = (space, rel, fields) => request("/api/task", json("PUT", { ...sp(space), rel, ...fields }));

export const setStatus = (space, rel, status) => request("/api/task/status", json("POST", { ...sp(space), rel, status }));

export const openInFileManager = (space, rel) => request("/api/task/open", json("POST", { ...sp(space), rel }));

export const deleteTask = (space, rel) => request(`/api/task?${q({ ...sp(space), rel })}`, { method: "DELETE" });

export const fileUrl = (space, rel, download = false) =>
  `/api/file?${q({ ...sp(space), rel, ...(download ? { download: "1" } : {}) })}`;

// Route to a space's task list.
export const spacePath = (work, project) =>
  `/w/${encodeURIComponent(work)}` + (project ? `/${encodeURIComponent(project)}` : "");
