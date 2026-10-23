// The task's title is the first non-empty line of its details; the body is everything after it.
export function splitDetails(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  if (i === -1) return { title: "", body: "" };
  const body = lines.slice(i + 1);
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body.at(-1).trim() === "") body.pop();
  return { title: lines[i].trim(), body: body.join("\n") };
}

// The description is the line right after the title; a blank line there means there is none, and
// whatever follows is only notes.
export function describe(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  return i === -1 ? "" : (lines[i + 1] || "").trim();
}

export function joinDetails(title, body) {
  const t = (title || "").trim();
  const b = (body || "").replace(/\r\n/g, "\n").trim();
  return b ? `${t}\n${b}` : t;
}

// "202508142100" -> "2025-08-14 21:00"; anything else is shown as-is.
export function formatStamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2})[_]?(\d{2})(\d{2})/.exec(s || "");
  if (!m) return s || "";
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

// The month a task was created in ("2026-10"), from its id; "" for an id that is not a date.
export const ALL_MONTHS = "all";
export const taskMonth = (task) => (/^\d{6}/.test(task.id) ? `${task.id.slice(0, 4)}-${task.id.slice(4, 6)}` : "");

// The month filter's entries: all months, then the months the tasks were created in, newest first.
export function taskMonths(tasks) {
  const keys = [...new Set(tasks.map(taskMonth).filter(Boolean))].sort((a, b) => (a > b ? -1 : 1));
  return [{ key: ALL_MONTHS }, ...keys.map((key) => ({ key }))];
}

// "2026-10" as "2026 - 10", as fin writes a month.
export const monthLabel = (key, t) => (key === ALL_MONTHS ? t("month.all") : key.replace("-", " - "));

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABEL = { todo: "todo", done: "done", pending: "pending" };

// What the preview modal can show in the page: a PDF, an image or a text file.
const TEXT_EXT = /\.(txt|md|markdown|log|csv|tsv|json|ya?ml|xml|ini|conf|cfg|toml|sql|sh|bat|ps1|js|jsx|ts|tsx|py|rb|go|java|c|h|cpp|cs|rs|php|css|html?)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function previewKind(name) {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (IMAGE_EXT.test(name)) return "image";
  if (TEXT_EXT.test(name)) return "text";
  return null;
}
