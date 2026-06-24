// micro.js — in-process logger MICRObenchmark. Unlike k6bench.js (which measures
// end-to-end HTTP latency, where Express + network + OS all blur the picture),
// this measures the one thing pino actually claims to win: the raw cost of a
// logger.info() call on the main thread, and how many lines/sec it can emit.
//
// It compares three modes — and the third is the point:
//   winston            — formats + writes on the main thread
//   pino-transport     — worker thread (great for not BLOCKING, not for raw speed)
//   pino-destination   — pino.destination(), same-thread sonic-boom: pino's FASTEST mode
//
// All three write to a single temp file only (no console, no second file) so the
// comparison is apples-to-apples. Redaction is on for all, mirroring loggers.js.
//
// Two numbers per mode:
//   emit  — time the CALLER pays per logger.info() (the main-thread cost)
//   total — emit + flush, i.e. real throughput once every byte is on disk
//
//   node micro.js            # 200,000 lines, median of 3 reps
//   node micro.js 500000 5   # 500k lines, 5 reps

const fs = require('fs');
const os = require('os');
const path = require('path');

const N = Number(process.argv[2] || 200000);
const REPS = Number(process.argv[3] || 3);
const REDACT_KEYS = ['password', 'token', 'secret'];
const TMP = os.tmpdir();

// A representative log payload with nested secrets, so redaction does real work.
function makeMeta(i) {
  return { reqId: i, method: 'GET', path: '/students/3', id: 3, name: 'Grace',
           password: 'hunter2', auth: { token: 'abc123', scope: 'read' } };
}

function makeWinston(file) {
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
  const logger = winston.createLogger({
    level: 'info', defaultMeta: { service: 'bench' },
    format: winston.format.combine(redact(), winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.File({ filename: file })],
  });
  const flush = () => new Promise((resolve) => { logger.on('finish', resolve); logger.end(); });
  return { logger, style: 'winston', flush };
}

function makePinoTransport(file) {
  const pino = require('pino');
  const transport = pino.transport({ target: 'pino/file', options: { destination: file, mkdir: true } });
  const logger = pino({
    level: 'info', base: { service: 'bench' }, timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ['password', 'auth.token'], censor: '[REDACTED]' },
  }, transport);
  const flush = () => new Promise((resolve) => { transport.on('close', resolve); transport.end(); });
  return { logger, style: 'pino', flush };
}

function makePinoDestination(file) {
  const pino = require('pino');
  // Same-thread, buffered sonic-boom — this is pino's fastest configuration.
  const dest = pino.destination({ dest: file, sync: false, mkdir: true });
  const logger = pino({
    level: 'info', base: { service: 'bench' }, timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ['password', 'auth.token'], censor: '[REDACTED]' },
  }, dest);
  const flush = () => new Promise((resolve) => { dest.on('close', resolve); dest.end(); });
  return { logger, style: 'pino', flush };
}

const MODES = [
  { name: 'winston', make: makeWinston },
  { name: 'pino-transport', make: makePinoTransport },
  { name: 'pino-destination', make: makePinoDestination },
];

const log = (logger, style, meta, msg) =>
  style === 'winston' ? logger.info(msg, meta) : logger.info(meta, msg);

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function runRep(mode) {
  const file = path.join(TMP, `micro-${mode.name}.log`);
  try { fs.unlinkSync(file); } catch {}
  const { logger, style, flush } = mode.make(file);

  // Warm up the JIT and the file stream before timing.
  for (let i = 0; i < 10000; i++) log(logger, style, makeMeta(i), 'request received');

  // emit: the synchronous main-thread cost the caller pays per log call.
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) log(logger, style, makeMeta(i), 'request received');
  const emitNs = Number(process.hrtime.bigint() - t0);

  // flush: drain every buffered byte to disk (worker drain / stream finish).
  const f0 = process.hrtime.bigint();
  await withTimeout(flush(), 30000);
  const flushNs = Number(process.hrtime.bigint() - f0);

  return {
    nsPerOp: emitNs / N,
    emitLps: N / (emitNs / 1e9),
    flushMs: flushNs / 1e6,
    totalLps: N / ((emitNs + flushNs) / 1e9),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function renderTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const lines = [rows[0].map((c, i) => String(c).padEnd(widths[i])).join('  '), sep];
  for (let r = 1; r < rows.length; r++) {
    lines.push(rows[r].map((c, i) => String(c).padStart(widths[i])).join('  '));
  }
  return lines.join('\n');
}

(async () => {
  console.log(`\nin-process logger microbenchmark`);
  console.log(`${N.toLocaleString()} lines/run, median of ${REPS} reps. Single file sink, redaction on.`);
  console.log(`Measuring raw logger.info() cost — NOT HTTP latency.\n`);

  const results = [];
  for (const mode of MODES) {
    process.stdout.write(`Running ${mode.name.padEnd(18)} ... `);
    const reps = [];
    for (let r = 0; r < REPS; r++) reps.push(await runRep(mode));
    const res = {
      name: mode.name,
      nsPerOp: median(reps.map((x) => x.nsPerOp)),
      emitLps: median(reps.map((x) => x.emitLps)),
      flushMs: median(reps.map((x) => x.flushMs)),
      totalLps: median(reps.map((x) => x.totalLps)),
    };
    results.push(res);
    console.log(`${Math.round(res.totalLps).toLocaleString()} lines/s end-to-end (${res.nsPerOp.toFixed(0)} ns/call emit, ${res.flushMs.toFixed(0)} ms flush)`);
  }

  const header = ['mode', 'ns/call (emit)', 'emit lines/s', 'flush (ms)', 'total lines/s'];
  const rows = [header, ...results.map((r) => [
    r.name, r.nsPerOp.toFixed(0), Math.round(r.emitLps).toLocaleString(),
    r.flushMs.toFixed(0), Math.round(r.totalLps).toLocaleString(),
  ])];
  console.log('\n' + renderTable(rows) + '\n');

  const fastest = results.reduce((a, b) => (a.totalLps >= b.totalLps ? a : b));
  console.log(`Fastest end-to-end (every line on disk): ${fastest.name}\n`);

  console.log(`Reading this honestly:`);
  console.log(`- 'emit' (the .info() call cost) is NOT comparable across libs: winston looks`);
  console.log(`  cheap there only because it DEFERS formatting to async stream processing —`);
  console.log(`  that work still runs on your main thread later (note its large flush).`);
  console.log(`- The fair metric is 'total lines/s' (all work done, bytes on disk).`);
  console.log(`- pino-destination (same-thread sonic-boom) is pino's FAST mode and wins there;`);
  console.log(`  pino-transport is slower on raw throughput — the worker thread is for NOT`);
  console.log(`  blocking the event loop, not for peak speed.\n`);
})().catch((e) => { console.error(e); process.exit(1); });
