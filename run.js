// `tm run`: start Claude Code on a task. The logic lives in ai/run.js, with everything else of tm that
// is about AI (see ai/); this file stays here, beside push.js and pull.js, so the command is found
// where the others are.
module.exports = require('./ai/run');
