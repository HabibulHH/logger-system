// runner.js — single-config benchmark child. Spawned by bench.js once per
// config. Emits a structured-log loop, measures main-thread wall time and
// event-loop lag, prints one JSON result line to STDERR (stdout is reserved
// for the logger's own output and is redirected to /dev/null by the parent).
//
// Args: <config> <iterations>
//   config = 'winston' | 'pino-multistream' | 'pino-transport'

const fs = require('fs');

const config = process.argv[2];
const N = Number(process.argv[3] || 100000);

const FILES = {
  'winston':          { app: '/tmp/bench-winston-app.log',  err: '/tmp/bench-winston-error.log' },
  'pino-multistream': { app: '/tmp/bench-pino-ms-app.log',  err: '/tmp/bench-pino-ms-error.log' },
  'pino-transport':   { app: '/tmp/bench-pino-tp-app.log',  err: '/tmp/bench-pino-tp-error.log' },
};

// Truncate output files so each run measures a fresh append, not the cost of
// growing an existing huge file (cosmetic, but keeps numbers comparable).
for (const f of Object.values(FILES).flatMap(({app, err}) => [app, err])) {
  try { fs.unlinkSync(f); } catch {}
}

const REDACT_KEYS = ['password', 'token', 'secret'];

function makeWinston() {
  const winston = require('winston');
  const REDACT = new Set(REDACT_KEYS);
  const redact = winston.format((info) => {
    const mask = (o) => {
      for (const k of Object.keys(o)) {
        if (REDACT.has(k)) o[k] = '[REDACTED]';
        else if (o[k] && typeof o[k] === 'object') mask(o[k]);
      }
      return o;
    };
    return mask(info);
  });
  return winston.createLogger({
    level: 'info',
    defaultMeta: { service: 'bench' },
    format: winston.format.combine(redact(), winston.format.timestamp(), winston.format.json()),
    transports: [
      new winston.transports.Console({ stderrLevels: [] }),
      new winston.transports.File({ filename: FILES.winston.app }),
      new winston.transports.File({ filename: FILES.winston.err, level: 'error' }),
    ],
  });
}

function makePinoMultistream() {
  const pino = require('pino');
  const streams = [
    { level: 'trace', stream: process.stdout },
    { level: 'trace', stream: pino.destination({ dest: FILES['pino-multistream'].app, sync: false, mkdir: true }) },
    { level: 'error', stream: pino.destination({ dest: FILES['pino-multistream'].err, sync: false, mkdir: true }) },
  ];
  return pino({
    level: 'info',
    base: { service: 'bench' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_KEYS, censor: '[REDACTED]' },
  }, pino.multistream(streams));
}

function makePinoTransport() {
  const pino = require('pino');
  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level: 'trace', options: { destination: 1 } },
      { target: 'pino/file', level: 'trace', options: { destination: FILES['pino-transport'].app, mkdir: true } },
      { target: 'pino/file', level: 'error', options: { destination: FILES['pino-transport'].err, mkdir: true } },
    ],
  });
  return pino({
    level: 'info',
    base: { service: 'bench' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_KEYS, censor: '[REDACTED]' },
  }, transport);
}

const factories = {
  'winston':          makeWinston,
  'pino-multistream': makePinoMultistream,
  'pino-transport':   makePinoTransport,
};

if (!factories[config]) {
  process.stderr.write(JSON.stringify({ error: `unknown config: ${config}` }) + '\n');
  process.exit(2);
}
const logger = factories[config]();

// Warmup so V8 JIT-optimizes the hot path before we start the timer.
const WARMUP = 2000;
if (config === 'winston') {
  for (let i = 0; i < WARMUP; i++) {
    logger.info('warmup', { i, userId: 42, path: '/api/users', latencyMs: 12, ok: true });
  }
} else {
  for (let i = 0; i < WARMUP; i++) {
    logger.info({ i, userId: 42, path: '/api/users', latencyMs: 12, ok: true }, 'warmup');
  }
}

// Event-loop lag sampler. setInterval(cb, 10) — measured lag = actual gap
// between callbacks minus the requested 10ms. Spikes here mean the main
// thread was blocked (by the logger or anything else) for that long. We
// keep sampling through the drain phase too, because winston/pino-ms do
// most of their work AFTER logger.info() returns.
const lagSamples = [];
const INTERVAL_MS = 10;
let prev = Date.now();
const lagTimer = setInterval(() => {
  const now = Date.now();
  lagSamples.push(Math.max(0, now - prev - INTERVAL_MS));
  prev = now;
}, INTERVAL_MS);

// The measured emission loop. emitWallMs = how long logger.info() blocks
// the caller. For winston, this is just queueing; the real work is async.
// For pino, JSON serialization happens synchronously here.
const start = process.hrtime.bigint();
if (config === 'winston') {
  for (let i = 0; i < N; i++) {
    logger.info('request handled', { i, userId: 42, path: '/api/users', latencyMs: 12, ok: true });
  }
} else {
  for (let i = 0; i < N; i++) {
    logger.info({ i, userId: 42, path: '/api/users', latencyMs: 12, ok: true }, 'request handled');
  }
}
const emitEnd = process.hrtime.bigint();
const emitWallMs = Number(emitEnd - start) / 1e6;

// DRAIN — poll the app.log file size until it stops growing. This catches:
//   - winston's async transport queue draining to disk
//   - pino multistream's sonic-boom flushing
//   - pino transport's worker thread finishing its writes
// Without this, winston looks fake-fast because logger.info just enqueues.
const drainFile = FILES[config].app;
async function waitForDrain() {
  let prevSize = -1;
  let stable = 0;
  // ~50 samples of 50ms = up to 2.5s. 5 consecutive stable polls = drained.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 50));
    let size = 0;
    try { size = fs.statSync(drainFile).size; } catch {}
    if (size > 0 && size === prevSize) stable++;
    else { stable = 0; prevSize = size; }
    if (stable >= 5) break;
  }
  return prevSize;
}

(async () => {
  const finalBytes = await waitForDrain();
  const endToEndMs = Number(process.hrtime.bigint() - start) / 1e6;
  clearInterval(lagTimer);

  const throughput = N / (emitWallMs / 1000);
  const endToEndThroughput = N / (endToEndMs / 1000);

  function pct(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  const result = {
    config,
    N,
    emitWallMs: +emitWallMs.toFixed(2),
    endToEndMs: +endToEndMs.toFixed(2),
    emitThroughput: Math.round(throughput),
    endToEndThroughput: Math.round(endToEndThroughput),
    perCallUs: +((emitWallMs * 1000) / N).toFixed(3),
    lagP50Ms: +pct(lagSamples, 50).toFixed(2),
    lagP99Ms: +pct(lagSamples, 99).toFixed(2),
    lagMaxMs: +(lagSamples.length ? Math.max(...lagSamples) : 0).toFixed(2),
    finalBytes,
  };

  process.stderr.write(JSON.stringify(result) + '\n');
  process.exit(0);
})();
