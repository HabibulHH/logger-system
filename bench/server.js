// server.js — a real Express API used for the k6 load test. Mirrors the routes
// of ../pino/app.js (per-request child logger, a few log lines per request,
// an error route) but builds its logger from the shared loggers.js so we can
// swap winston / pino-multistream / pino-transport via the LOGGER env var and
// load-test each under identical traffic.
//
//   LOGGER=pino-transport PORT=3100 node server.js
//
// Prints "READY <port>" to STDERR once listening (stdout is the logger's own
// output, redirected to /dev/null by the orchestrator).

const express = require('express');
const crypto = require('crypto');
const { createLogger, filesFor } = require('./loggers');

const config = process.env.LOGGER || 'pino-transport';
const PORT = Number(process.env.PORT || 3100);
// Per-request CPU work for the realistic /report route (hash rounds). Tunable
// so the busy-server scenario can be dialed to the host without code edits.
const WORK = Number(process.env.WORK || 100);

const files = filesFor('k6', config);
const { logger, style, flush } = createLogger(config, files);

// winston is logger.info(msg, meta); pino is logger.info(meta, msg). One helper
// so the routes read the same regardless of which library is active.
const L = (log, meta, msg) => style === 'winston' ? log.info(msg, meta) : log.info(meta, msg);

const students = [
  { id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }, { id: 3, name: 'Grace' },
  { id: 4, name: 'Dennis' }, { id: 5, name: 'Margaret' },
];

const app = express();
let nextReqId = 1;

// Per-request child logger — the CONTEXT pattern, same as the real app.
app.use((req, res, next) => {
  req.log = logger.child({ reqId: nextReqId++, method: req.method, path: req.path });
  L(req.log, {}, 'request received');
  next();
});

app.get('/students', (req, res) => {
  L(req.log, { count: students.length }, 'listing all students');
  res.json(students);
});

app.get('/students/:id', (req, res) => {
  const id = Number(req.params.id);
  const student = students.find((s) => s.id === id);
  if (!student) {
    L(req.log, { id }, 'student not found');
    return res.status(404).json({ error: 'student not found' });
  }
  L(req.log, { id, name: student.name }, 'student found');
  res.json(student);
});

// A realistic business endpoint. Unlike /students/:id (which does almost
// nothing, so logging is most of the per-request cost), this does real CPU work
// the way a production handler does — serialization, validation, crypto — plus
// a simulated downstream call. Here the MAIN THREAD is the scarce resource, so
// WHERE the logging runs matters: winston formats+writes on this same thread,
// stealing cycles from the business work, while pino ships it to a worker on
// another core and leaves the event loop free to serve customers. This is the
// scenario pino's worker-thread transport is actually built for.
app.get('/report/:id', async (req, res) => {
  const id = Number(req.params.id);
  L(req.log, { id }, 'building report');

  // Business-logic CPU (representative real work, not logging): a chained hash.
  let acc = `seed:${id}`;
  for (let i = 0; i < WORK; i++) acc = crypto.createHash('sha256').update(acc).digest('hex');

  // Simulate a downstream DB/cache call — frees the event loop while waiting,
  // so many requests are in flight at once (as in a real service).
  await new Promise((r) => setTimeout(r, 3));

  L(req.log, { id, checksum: acc.slice(0, 12) }, 'report ready');
  res.json({ id, checksum: acc.slice(0, 12) });
});

app.get('/boom', (req, res) => { throw new Error('simulated failure'); });

app.use((err, req, res, next) => {
  L(req.log, { err: String(err && err.stack || err) }, 'request failed');
  res.status(500).json({ error: 'internal server error' });
});

const server = app.listen(PORT, () => {
  process.stderr.write(`READY ${PORT}\n`);
});

// Graceful shutdown so the logger flushes before exit (the orchestrator hits
// this between configs). Without it, in-flight log lines could be dropped.
function shutdown() {
  server.close(async () => {
    try { await flush(); } catch {}
    process.exit(0);
  });
  // Safety net if close() hangs on keep-alive sockets.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
