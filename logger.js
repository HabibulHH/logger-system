// logger.js — a tiny structured logger, ~70 lines, zero dependencies.
//
// It's deliberately small so students can read the WHOLE thing and see
// that the "magic" of pino/winston is not magic. It fixes every problem
// from scripts 02–06:
//
//   #1 levels      -> LEVELS + LOG_LEVEL filtering
//   #2 context     -> timestamp + service + child() bindings (e.g. reqId)
//   #3 structured  -> output is JSON, one object per line
//   #4 performance -> we skip building the log entirely when filtered out
//   #5 disable/secrets -> LOG_LEVEL env var + redaction of secret fields

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Read the floor once at startup. In prod you'd set LOG_LEVEL=info,
// in dev LOG_LEVEL=debug. No code change, no redeploy to adjust.
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

// Fields we never want to appear in logs.
const REDACT = new Set(['password', 'sessionToken', 'token', 'secret']);

function redact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object') out[k] = redact(v);
    else out[k] = v;
  }
  return out;
}

function createLogger(bindings = {}) {
  function log(level, msg, data = {}) {
    // PERFORMANCE FIX: bail out *before* building anything if this level
    // is below the threshold. Nothing is allocated, nothing is written.
    if (LEVELS[level] < threshold) return;

    const entry = {
      level,
      time: new Date().toISOString(), // CONTEXT FIX: always timestamped
      msg,
      ...bindings, // CONTEXT FIX: service, reqId, etc. on every line
      ...redact(data), // SECRETS FIX: mask sensitive fields
    };

    // STRUCTURED FIX: one JSON object per line. A collector can parse,
    // index, filter, and graph it. We write errors to stderr, rest to stdout.
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),

    // child() returns a logger that stamps extra context onto every line.
    // e.g. log.child({ reqId }) — now every log in that request is traceable.
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

// The root logger carries the service name on every single line.
module.exports = createLogger({ service: 'checkout' });
