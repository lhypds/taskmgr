// The web UI's API for running Claude Code on a task (the runs themselves live in ai/session.js),
// mounted by index.js under /api after the login guard, so every route needs a session:
//
//   GET    /api/ai/events            the runs, live: a text/event-stream (SSE) of events (see below)
//   GET    /api/ai/runs              the runs, with their transcripts: { runs }
//   POST   /api/ai/run               { work, repository?, rel }: start Claude Code on that task; 201 { run }
//   POST   /api/ai/runs/:id/answer   { pending, decision } or { pending, answers }: answer the run's question; { run }
//   POST   /api/ai/runs/:id/stop     stop the run; { run }
//   DELETE /api/ai/runs/:id          forget a finished run; { ok: true }
//
// The event stream starts with `snapshot` { runs } (the runs with their transcripts), then sends
// `run` (a run's state: status, pending question...), `item` { run, i, item } (one item of a run's
// transcript, new or changed), `delta` { run, i, text } (text appended to a transcript item) and
// `remove` { run } as they happen, with a comment every 25 seconds to keep the connection.
const express = require('express');

const { isDirectory, spaceOf, taskDirIn } = require('../ai/task');
const session = require('../ai/session');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function createAiApp({ config, logFile }) {
  session.configure({ logFile });
  const app = express.Router();

  // The space a request names, as the task APIs do (work, repository "" for the common tasks).
  function spaceFrom(params) {
    const work = String(params.work || '');
    const repository = String(params.repository || '');
    if (!work) throw httpError(400, 'Missing work.');
    const space = spaceOf(config.getWorks(), work, repository);
    if (!space) throw httpError(404, repository ? `Unknown repository "${repository}" in "${work}".` : `Unknown work "${work}".`);
    if (!space.root) throw httpError(404, `"${work}" has no tasks folder of its own.`);
    if (!isDirectory(space.root)) throw httpError(404, `Folder not found: ${space.root}`);
    return space;
  }

  app.get('/api/ai/events', (req, res) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('snapshot', { runs: session.listRuns(true) });
    const off = session.subscribe(send);
    const beat = setInterval(() => res.write(': keep\n\n'), 25 * 1000);
    req.on('close', () => {
      clearInterval(beat);
      off();
    });
  });

  app.get('/api/ai/runs', (req, res) => {
    res.json({ runs: session.listRuns(true) });
  });

  app.post('/api/ai/run', (req, res) => {
    const body = req.body || {};
    const space = spaceFrom(body);
    const rel = String(body.rel || '');
    const taskDir = taskDirIn(space, rel);
    const run = session.startRun({ space, taskDir, taskRef: { work: space.work, repository: space.repository, rel } });
    res.status(201).json({ run: session.publicRun(run, true) });
  });

  app.post('/api/ai/runs/:id/answer', (req, res) => {
    const body = req.body || {};
    const run = session.answerRun(String(req.params.id), String(body.pending || ''), body);
    res.json({ run: session.publicRun(run) });
  });

  app.post('/api/ai/runs/:id/stop', (req, res) => {
    const run = session.stopRun(String(req.params.id));
    res.json({ run: session.publicRun(run) });
  });

  app.delete('/api/ai/runs/:id', (req, res) => {
    session.dismissRun(String(req.params.id));
    res.json({ ok: true });
  });

  return app;
}

module.exports = { createAiApp };
