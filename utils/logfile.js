// Appending to a log file that is kept from growing without end: logs/taskmgr.log, logs/taskmgrd.log
// (push.js, pull.js, taskmgrd.js) and, on a sync server, logs/<MACHINE_ID>.log (server/sync.js). When
// a file grows past LOG_MAX_BYTES, its oldest LOG_TRIM_BYTES are dropped, up to the end of the line
// that byte falls in, so the file keeps whole lines and goes on from 8 MB. The same goes for every
// other .log file in logs/ when the web UI or the daemon starts (see trimLogs).
const fs = require('fs');
const path = require('path');

const LOG_MAX_BYTES = 10 * 1024 * 1024;  // a log is trimmed when it is bigger than this
const LOG_TRIM_BYTES = 2 * 1024 * 1024;  // how much is dropped from its start then

// Append `line` (ending in "\n") to `file`, making its folder, and trim the file when it is too big.
// Throws when the file cannot be written; a failed trim is ignored (the next append tries again).
function appendLog(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) trimLog(file);
  } catch (e) { /* kept as it is */ }
}

// Drop the first LOG_TRIM_BYTES of `file`, rounded up to the end of a line. Written through a
// temporary file next to it, renamed into place, so the log is never half written.
function trimLog(file) {
  const content = fs.readFileSync(file);
  let cut = content.indexOf(10, LOG_TRIM_BYTES);  // the "\n" that ends the line the cut falls in
  cut = cut < 0 ? content.length : cut + 1;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content.subarray(cut));
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Trim every .log file in `dir` that is over the limit: run when the web UI and the daemon start, for
// a log that grew before this limit existed or that nothing appends to any more. A missing folder is
// nothing to do. Returns the files trimmed.
function trimLogs(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  const trimmed = [];
  for (const name of names) {
    if (!name.endsWith('.log')) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile() && fs.statSync(file).size > LOG_MAX_BYTES) { trimLog(file); trimmed.push(file); }
    } catch (e) { /* kept as it is */ }
  }
  return trimmed;
}

module.exports = { appendLog, trimLog, trimLogs, LOG_MAX_BYTES, LOG_TRIM_BYTES };
