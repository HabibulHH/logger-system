# console.log at scale — a teaching demo

A zero-dependency Node.js demo showing **why `console.log` is fine for toy code
but breaks down in real, large-scale applications** — and how a proper structured
logger fixes it. Built for a live classroom walkthrough.

> Requires only Node.js (tested on v24). No `npm install` needed.

## How to run

Each step is a standalone script. Run them in order:

```bash
node app.js            # menu of all steps
node 01-naive.js       # or run any step directly
```

Or via npm scripts: `npm run naive`, `npm run levels`, etc.

## The walkthrough

| Step | File | The problem it shows |
|------|------|----------------------|
| 1 | `01-naive.js` | The innocent starting point — `console.log` everywhere. Looks fine. |
| 2 | `02-no-levels.js` | **No levels.** The one critical line is buried in noise. You can't filter. |
| 3 | `03-no-context.js` | **No context.** No timestamp, no request id — interleaved async logs are untraceable. |
| 4 | `04-unstructured.js` | **Unstructured text** can't be searched/counted by log tools (Datadog, ELK, CloudWatch). |
| 5 | `05-performance.js` | **It's slow & synchronous** — `console.log` blocks the event loop. Includes a benchmark. |
| 6 | `06-cant-disable.js` | **Can't turn it off**, and it **leaks secrets** (passwords/tokens) into log storage. |
| ✅ | `logger.js` + `07-fixed.js` | A tiny (~70-line) structured logger that solves all five. |

## Suggested live-demo script (≈10 min)

1. **Run `01-naive.js`.** "Looks great, right? Now scale it to 50 engineers and 2M requests/day."
2. **Run `02-no-levels.js`.** Ask: "Spot the payment failure." It's drowned. Levels fix this.
3. **Run `03-no-context.js`** (run it twice). "Which `db query` belongs to which request?" You can't tell.
4. **Run `04-unstructured.js`.** "Now count today's declined charges." Three formats = three regexes = pain. JSON fixes it.
5. **Run the benchmark:**
   ```bash
   node 05-performance.js > /dev/null
   ```
   (Redirecting to `/dev/null` simulates logs going to a file/collector.) Show the multiplier.
6. **Run `06-cant-disable.js`.** Point at the `[REDACTED]`-worthy password sitting in plain text.
7. **The reveal — open `logger.js`** (only ~70 lines) and walk through how each fix maps to a problem.
8. **Run the fixed app both ways and compare:**
   ```bash
   LOG_LEVEL=info  node 07-fixed.js   # production: clean, no debug, no secrets
   LOG_LEVEL=debug node 07-fixed.js   # dev: verbose, same code, NO redeploy
   ```
   The punchline: the debug lines appear/disappear by changing an env var, not the code.

## The five fixes (how `logger.js` maps to the problems)

| Problem | Fix in `logger.js` |
|---------|--------------------|
| No levels | `LEVELS` + `LOG_LEVEL` threshold filtering |
| No context | `time` on every line + `child({ reqId })` bindings |
| Unstructured | output is one JSON object per line |
| Slow / blocking | early `return` before building filtered logs (real loggers also buffer/async) |
| Can't disable / leaks | `LOG_LEVEL` env var + automatic redaction of secret fields |

## Where this goes in the real world

This hand-rolled logger teaches the *concepts*. In production you'd reach for a
battle-tested library that does all of the above plus async transports, log
rotation, and serializers:

- **[pino](https://github.com/pinojs/pino)** — extremely fast JSON logger (this demo mirrors its model: levels, `child()`, JSON, redaction)
- **[winston](https://github.com/winstonjs/winston)** — flexible, many transports

Try piping this demo through pino's pretty-printer for human-readable dev output:

```bash
LOG_LEVEL=debug node 07-fixed.js | npx --yes pino-pretty
```
