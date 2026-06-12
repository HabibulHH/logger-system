# logger-system

A four-step journey through Node.js logging — from `console.log` to a
worker-thread sidecar — with a benchmark to compare the real cost of each
approach. Built as a teaching/reference project.

## Layout

```
logger/
  primary-logger/   Hand-rolled logger lessons (5 problems → 5 fixes, no deps)
  winstone/         Same lessons rebuilt on `winston` behind an Express API
  pino/             Same API on `pino` with the worker-thread sidecar transport
  bench/            winston vs pino microbenchmark (throughput, lag, drain)
```

Each folder has its own `README.md` with run instructions. This file is the
project-level map and the consolidated take-aways.

## The five logging lessons (the consistent thread)

The four sub-projects all teach the same five points; only the implementation
differs.

| # | Lesson | Why it bites you in production |
|---|---|---|
| 1 | **Levels** (`debug` / `info` / `warn` / `error`) | Without them you can't filter prod noise vs. dev verbosity |
| 2 | **Context** (timestamp, service, `reqId` via `child()`) | Otherwise interleaved async logs are untraceable |
| 3 | **Structured** (one JSON object per line) | Datadog/Loki/CloudWatch can't index unstructured text |
| 4 | **Performance** (don't block the event loop) | Heavy sync logging drives p99 latency through the roof |
| 5 | **Disable / redact** (`LOG_LEVEL` env + secret masking) | Passwords/tokens silently leak into log storage |

`primary-logger/` builds these in plain JS so the concepts are visible.
`winstone/` and `pino/` show the same five solved by real libraries.

## Quick start

```bash
# Lesson 1 — hand-rolled
cd primary-logger && node 07-fixed.js

# Lesson 2 — winston-based Express API
cd winstone && npm install && npm run dev
# in another shell:
curl localhost:3000/students/2
curl localhost:3000/boom            # 500 — logs an error

# Lesson 3 — pino-based version of the same API (worker-thread sidecar)
cd pino && npm install && npm run dev
curl localhost:3000/students/2

# Lesson 4 — benchmark winston vs pino
cd bench && npm install && node bench.js 200000
```

All three Express variants expose the same routes:

- `GET /students` — list all students
- `GET /students/:id` — one student or 404
- `GET /boom` — deliberately throws (500), so the error path logs with a stack

## The pino sidecar pattern (what `pino/logger.js` actually does)

`pino/logger.js` uses **`pino.transport()`** instead of `pino.multistream()`.
The difference is where the work happens.

```
                main thread                    worker thread (pino.transport)
                ────────────                   ────────────────────────────────
 logger.info →  level check
                base + child binding
                redact
                JSON serialize
                postMessage (SharedArrayBuffer)
                                          →    receive bytes
                                               write to fd 1 (stdout)
                                               write to logs/app.log
                                               write to logs/error.log (errors only)
```

Why this matters: the worker thread owns the file IO and target dispatching, so
the main event loop stays free for your request handlers. See the benchmark
section below for the measured impact (12x lower p99 lag than the main-thread
fan-out variant).

The pieces:

- `pino.transport({ targets: [...] })` — spawns the worker, takes one or more
  target modules (here all `pino/file` — the built-in fd/file writer).
- Per-target `level` — same shape as winston's per-transport level (`'trace'`
  on stdout/app.log so the top-level `level` is the single floor; `'error'`
  on `error.log`).
- `base: { service }`, `timestamp: pino.stdTimeFunctions.isoTime`, `redact` —
  applied on the main thread before bytes are shipped to the worker, so
  secrets are masked even if the worker crashed mid-write.
- SIGINT/SIGTERM handler calls `logger.flush(() => process.exit(0))` so the
  worker's ring buffer drains before exit. Without this, a fast exit can
  strand the last few log lines.

### Gotcha: reserved key names in pino's merging object

While testing the sidecar setup we found a real pino gotcha worth knowing:

```js
// BAD — line silently dropped by the transport
logger.info({ port: PORT, level: logger.level }, 'server listening');

// GOOD — rename the conflicting key
logger.info({ port: PORT, logLevel: logger.level }, 'server listening');
```

`level` is a reserved field in pino's merging object (used for per-call level
override). Passing a string value there causes the line to be discarded by the
worker stream with no error. The same caution applies to `time`, `msg`, `pid`,
`hostname` — avoid those as user-meta keys.

## Benchmark results (`bench/`)

`bench/bench.js` spawns one child process per logger config so they can't
share JIT warmups or worker threads. Each runs:

- a warmup pass (2000 lines)
- a timed emission loop (N structured info lines)
- a drain phase that polls the output file size until it stabilises — without
  this, winston looks fake-fast because `logger.info()` just queues into stream
  buffers; the JSON/IO work happens async afterwards

At **N = 200,000** lines per config (typical machine; rerun for your own numbers):

| Config | emit (ms) | end-to-end (ms) | real throughput | lag p99 (ms) |
|---|---:|---:|---:|---:|
| winston (multi-sink) | **46** | 959 | 209k/s | 37 |
| pino multistream | 498 | 801 | **250k/s** | 487 |
| pino transport (worker) | 233 | 1,456 | 137k/s | **24** |

Three different winners, three different stories:

- **winston** has the fastest `logger.info()` return because it just queues
  into stream buffers — but the formatting and file IO still hit your main
  loop later. Don't read 46 ms as "free".
- **pino multistream** has the highest end-to-end throughput because pino's
  JSON path is fast, but it does that work synchronously on the main thread —
  hence the 487 ms p99 lag spike under burst load.
- **pino transport (sidecar)** trades total throughput for **dramatically
  lower main-loop blocking** (~12× lower p99 lag than multistream). Best for
  request-driven services where p99 response time is what you care about.

### When to pick which

| Scenario | Pick |
|---|---|
| API server with p99 latency SLOs, request handlers log on every call | **pino with `transport`** |
| Batch job / pipeline maximising total throughput | **pino with `multistream`** |
| You already have winston everywhere and the change isn't justified | **winston is fine** — just understand its emit time is misleading |

### What "loop lag p99" actually means

The bench measures lag by asking Node to fire a callback every 10 ms via
`setInterval` and recording how late each call actually arrives. If the main
thread is busy serializing JSON for 100 ms, the next 10 ms tick fires ~100 ms
late and that sample's lag is ~90 ms.

`p99` = the 99th percentile of those lag samples. In an HTTP server it's a
direct proxy for "the worst 1% of requests experience this much extra delay
on top of their own work." That's why it's the most production-relevant
metric for these libraries.

## Production recommendations

1. **JSON output, always.** Pretty-printing belongs in dev (`pino-pretty`),
   never in prod log files. Log collectors index JSON.
2. **`LOG_LEVEL` env, never code.** Set verbosity at deploy time, not in code.
   `info` in prod, `debug` in dev. No redeploy to debug.
3. **Use `child()` for per-request bindings.** A `reqId` on every log line
   inside a request is what makes a trace navigable in Datadog/Loki.
4. **Redact at the library boundary.** `redact` in pino, a `format()` step in
   winston. Secrets should never reach the wire — masking at the collector is
   too late.
5. **For high-RPS services on Node ≥ 18, use `pino.transport()`.** The
   single-line config change moves serialization and file IO off your event
   loop. Bench numbers above show why this matters at p99.
6. **Always graceful-shutdown the logger.** `logger.flush(cb)` on SIGINT/SIGTERM
   for pino transport; `logger.end()` + the `'finish'` event for winston.
   Otherwise the last seconds of logs can be lost.
7. **Don't use reserved keys** (`level`, `time`, `msg`, `pid`, `hostname`) in
   pino's merging object. They collide with pino's internals and lines can be
   silently dropped through the transport.

## Files of interest

- [primary-logger/logger.js](primary-logger/logger.js) — the ~70-line hand-rolled
  logger that solves all five problems with no dependencies.
- [winstone/logger.js](winstone/logger.js) — winston configured to match the
  hand-rolled logger's contract.
- [pino/logger.js](pino/logger.js) — pino with the worker-thread sidecar
  transport, ISO timestamps, redact, and SIGINT-aware flush.
- [bench/runner.js](bench/runner.js) — drain-aware per-config benchmark runner.
- [bench/bench.js](bench/bench.js) — orchestrator and table renderer.
