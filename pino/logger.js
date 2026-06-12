// logger.js — pino with the SIDECAR (worker-thread) transport pattern.
// Same five logging lessons as ../winstone/logger.js, but now the file IO
// and target dispatching run on a separate Worker Thread so the main event
// loop stays free.
//
//   #1 levels      -> pino's `level` option + per-target `level` filters
//   #2 context     -> `base` defaultMeta + .child() bindings
//   #3 structured  -> pino emits one JSON object per line by default
//   #4 performance -> worker-thread transport keeps logging off the hot path
//   #5 disable/secrets -> LOG_LEVEL env var + pino's `redact` config
//
// Architecture (vs. the previous pino.multistream version):
//
//   main thread        worker thread (pino.transport)
//   ────────────       ────────────────────────────────────
//   level check        receive bytes via SharedArrayBuffer
//   base + child       write to fd 1   (stdout)
//   redact             write to logs/app.log
//   JSON serialize     write to logs/error.log (errors only)
//        │
//        └──── postMessage ────►

const path = require('path');
const fs = require('fs');
const pino = require('pino');

// pino's `pino/file` target will create files but not parent dirs by default;
// keep the explicit mkdir so the worker can open them on first write.
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// Fields we never want to appear in logs — same set as winstone/primary-logger.
// pino's redact runs on the MAIN thread before bytes are shipped to the
// worker, so secrets never leave the process unmasked even if the worker
// crashed mid-write.
const REDACT_PATHS = [
  'password', 'sessionToken', 'token', 'secret',
  '*.password', '*.sessionToken', '*.token', '*.secret',
];

// pino.transport spins up a Worker Thread that owns all the destinations.
// Each `target` is a module path resolved inside the worker; `pino/file` is
// the built-in file/fd writer (use destination: 1 for stdout, 2 for stderr,
// or a path for a file).
const transport = pino.transport({
  targets: [
    // Terminal — fd 1 is stdout. `level: 'trace'` so the logger's top-level
    // `level` is the single floor; this target accepts whatever the logger
    // lets through.
    {
      target: 'pino/file',
      level: 'trace',
      options: { destination: 1 },
    },

    // Every log line appended to logs/app.log so nothing is lost when the
    // terminal scrolls away or closes.
    {
      target: 'pino/file',
      level: 'trace',
      options: { destination: path.join(LOG_DIR, 'app.log'), mkdir: true },
    },

    // A separate logs/error.log with only errors — handy for "what broke?".
    {
      target: 'pino/file',
      level: 'error',
      options: { destination: path.join(LOG_DIR, 'error.log'), mkdir: true },
    },
  ],
});

const logger = pino(
  {
    // LEVELS FIX: read the floor once at startup. LOG_LEVEL=info in prod,
    // LOG_LEVEL=debug in dev. No code change to adjust verbosity.
    level: process.env.LOG_LEVEL || 'info',

    // CONTEXT FIX: service name stamped on every single line.
    base: { service: 'students-api' },

    // CONTEXT FIX: ISO timestamps instead of pino's default epoch ms.
    timestamp: pino.stdTimeFunctions.isoTime,

    // SECRETS FIX: mask sensitive fields wherever they appear in a log object.
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  },
  transport
);

// Flush the worker's buffers on graceful shutdown so in-flight log lines
// don't get dropped when the process exits. Without this, a fast exit can
// leave the last few lines stranded in the worker's ring buffer.
const shutdown = () => logger.flush(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// child() works exactly like before: stamp extra context (e.g. a reqId)
// onto every line so a whole request is traceable end-to-end. Child
// bindings are merged on the main thread before serialization.
module.exports = logger;
