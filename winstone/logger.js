// logger.js — the same logger as ../primary-logger/logger.js, but built on
// the real `winston` library instead of hand-rolled. Compare the two files:
// winston gives you the exact same features for free, plus a lot more.
//
//   #1 levels      -> winston.level + the LEVELS map (npm levels)
//   #2 context     -> timestamp + service defaultMeta + .child() bindings
//   #3 structured  -> format.json(): one JSON object per line
//   #4 performance  -> winston skips formatting when a level is filtered out
//   #5 disable/secrets -> LOG_LEVEL env var + a redaction format

const path = require('path');
const winston = require('winston');

// All log files live in winstone/logs/. winston creates the directory itself.
const LOG_DIR = path.join(__dirname, 'logs');

// Fields we never want to appear in logs — same set as primary-logger.
const REDACT = new Set(['password', 'sessionToken', 'token', 'secret']);

// A custom winston format that walks each log entry and masks secrets.
// format((info) => info) is winston's hook for transforming entries.
const redact = winston.format((info) => {
  const mask = (obj) => {
    for (const k of Object.keys(obj)) {
      if (REDACT.has(k)) obj[k] = '[REDACTED]';
      else if (obj[k] && typeof obj[k] === 'object') mask(obj[k]);
    }
    return obj;
  };
  return mask(info);
});

const logger = winston.createLogger({
  // LEVELS FIX: read the floor once at startup. LOG_LEVEL=info in prod,
  // LOG_LEVEL=debug in dev. No code change to adjust verbosity.
  level: process.env.LOG_LEVEL || 'info',

  // CONTEXT FIX: service name stamped on every single line.
  defaultMeta: { service: 'students-api' },

  format: winston.format.combine(
    redact(), // SECRETS FIX: mask sensitive fields
    winston.format.timestamp(), // CONTEXT FIX: always timestamped
    winston.format.json() // STRUCTURED FIX: one JSON object per line
  ),

  // winston can write to many places at once. Here: the terminal AND files.
  transports: [
    // Terminal — errors to stderr, everything else to stdout.
    new winston.transports.Console({ stderrLevels: ['error'] }),

    // Every log line (info and up) appended to logs/app.log so nothing is lost
    // when the terminal scrolls away or closes.
    new winston.transports.File({ filename: path.join(LOG_DIR, 'app.log') }),

    // A separate logs/error.log with only errors — handy for "what broke?".
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
    }),
  ],
});

// child() works exactly like primary-logger's: stamp extra context (e.g. a
// reqId) onto every line so a whole request is traceable.
module.exports = logger;
