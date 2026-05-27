# winston + a students API

`../primary-logger` builds a structured logger by hand to show there's no magic.
This folder shows the **same lessons** using the real [winston](https://github.com/winstonjs/winston)
library, wired into a tiny Express API so you can see logging in a real
request/response flow.

## Run it

```bash
npm install
node app.js          # LOG_LEVEL defaults to info
npm run dev          # LOG_LEVEL=debug — now the debug lines show up too
```

Then, in another terminal:

```bash
curl localhost:3000/students        # list all
curl localhost:3000/students/2      # one student
curl localhost:3000/students/999    # 404 -> logs a warn
curl localhost:3000/boom            # 500 -> logs an error
```

## Generate logs in bulk

`test.sh` starts the server (at `LOG_LEVEL=debug`), fires mixed traffic against
every endpoint, and summarises what each level produced — a quick way to fill
`logs/` with realistic data and see all four levels at once.

```bash
./test.sh        # 20 rounds (default)
./test.sh 100    # 100 rounds
```

## What to notice in the logs

- **Structured** — every line is a JSON object, ready for a log collector.
- **Context** — each line carries `service`, and inside a request also a
  `reqId`, `method`, and `path` (via `logger.child(...)`), so you can trace one
  request end to end.
- **Levels** — run with the default `info` and the `debug` "listing all
  students" line disappears; run `npm run dev` and it comes back. No code change.
- **Secrets** — a redaction format masks `password`, `token`, etc. before they
  ever hit the output.
- **Persisted** — winston writes to the terminal *and* to files at the same
  time (this is what transports are for). After running, check the `logs/`
  folder:
  - `logs/app.log` — every line (info and up).
  - `logs/error.log` — errors only, for quick "what broke?" triage.

## Files

- `logger.js` — winston configured to match `../primary-logger/logger.js`.
- `students.js` — in-memory student list (stand-in for a database).
- `app.js` — the Express server with the two GET endpoints.
- `logs/` — generated at runtime (git-ignored), not committed.
