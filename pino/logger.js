// logger.js — same logging lessons as ../winstone/logger.js, but built on
// the `pino` library. Compare the two to see how the same ideas (levels,
// context, structured JSON, performance, disable/secrets) map onto pino.
//
//   #1 levels      -> pino's `level` option + built-in level methods
//   #2 context     -> `base` defaultMeta + .child() bindings
//   #3 structured  -> pino emits one JSON object per line by default
//   #4 performance -> pino short-circuits filtered levels (very fast)
//   #5 disable/secrets -> LOG_LEVEL env var + pino's `redact` config

const path = require('path');
const fs = require('fs');
const pino = require('pino');

// All log files live in pino/logs/. Make sure the directory exists; pino's
// file destinations won't create it for us.
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// Fields we never want to appear in logs — same set as winstone/primary-logger.
// pino's `redact` takes JSON-path-style strings; `*.foo` covers one nested level
// (e.g. user.password) so nested objects are masked too.
const REDACT_PATHS = [
  'password', 'sessionToken', 'token', 'secret',
  '*.password', '*.sessionToken', '*.token', '*.secret',
];

// pino.multistream lets one logger fan out to several destinations at once
// — the analogue of winston's `transports` array. Note: each stream has its
// own level floor that defaults to `info` — we set `trace` on the general
// streams so the logger's top-level `level` is the single source of truth.
const streams = [
  // Terminal — pino writes to stdout by default; we list it explicitly so the
  // fan-out is visible.
  { level: 'trace', stream: process.stdout },

  // Every log line appended to logs/app.log so nothing is lost when the
  // terminal scrolls away or closes.
  { level: 'trace', stream: pino.destination({ dest: path.join(LOG_DIR, 'app.log'), sync: false, mkdir: true }) },

  // A separate logs/error.log with only errors — handy for "what broke?".
  { level: 'error', stream: pino.destination({ dest: path.join(LOG_DIR, 'error.log'), sync: false, mkdir: true }) },
];

const logger = pino(
  {
    // LEVELS FIX: read the floor once at startup. LOG_LEVEL=info in prod,
    // LOG_LEVEL=debug in dev. No code change to adjust verbosity.
    level: process.env.LOG_LEVEL || 'info',

    // CONTEXT FIX: service name stamped on every single line. pino keeps the
    // default pid/hostname too; drop them by setting base to just {service}.
    base: { service: 'students-api' },

    // CONTEXT FIX: ISO timestamps instead of pino's default epoch ms, to match
    // the winston output style.
    timestamp: pino.stdTimeFunctions.isoTime,

    // SECRETS FIX: mask sensitive fields wherever they appear in a log object.
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  },
  pino.multistream(streams)
);

// child() works exactly like winston's: stamp extra context (e.g. a reqId)
// onto every line so a whole request is traceable end-to-end.
module.exports = logger;
