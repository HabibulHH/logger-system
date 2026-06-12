// app.js — a simple Express API that demonstrates the pino logger in a
// request/response setting. Two GET endpoints:
//
//   GET /students       -> list all students
//   GET /students/:id   -> one student, or 404
//   GET /boom           -> deliberately throws, to demo the error level
//
// Run it:  node app.js   (then curl the endpoints below)
//   curl localhost:3000/students
//   curl localhost:3000/students/2
//   curl localhost:3000/students/999   -> 404
//   curl localhost:3000/boom           -> 500 (logs an error)
//
// Watch the logs: every line is JSON, carries the service name, and inside a
// request also carries a reqId so you can trace one request end-to-end.
//
// Note: pino's call signature is `log.info({ ...meta }, 'message')` — the
// metadata object goes FIRST and the message string SECOND. winston is the
// other way round.

const express = require('express');
const logger = require('./logger');
const students = require('./students');

const app = express();
let nextReqId = 1;

// Per-request child logger: every log inside this request is stamped with the
// same reqId, method, and path. This is the CONTEXT lesson in action.
app.use((req, res, next) => {
  req.log = logger.child({ reqId: nextReqId++, method: req.method, path: req.path });
  req.log.info('request received');
  next();
});

// GET /students — return the whole list.
app.get('/students', (req, res) => {
  req.log.debug({ count: students.length }, 'listing all students');
  res.json(students);
});

// GET /students/:id — return one student or 404.
app.get('/students/:id', (req, res) => {
  const id = Number(req.params.id);
  const student = students.find((s) => s.id === id);

  if (!student) {
    req.log.warn({ id }, 'student not found');
    return res.status(404).json({ error: 'student not found' });
  }

  req.log.info({ id, name: student.name }, 'student found');
  res.json(student);
});

// GET /boom — a route that deliberately throws, so we can see the ERROR level
// and the logs/error.log file in action.
app.get('/boom', (req, res) => {
  throw new Error('simulated failure for the logging demo');
});

// Error-handling middleware (4 args is how Express recognises it). This is the
// ERROR lesson: log the failure with its stack, then return a clean 500.
// pino has a built-in `err` serializer — pass the Error itself and it
// expands into { type, message, stack } automatically.
app.use((err, req, res, next) => {
  req.log.error({ err }, 'request failed');
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // Note: don't use the key `level` in pino's merging object — pino treats
  // it as a reserved field for per-call level override, and a string value
  // there can cause the line to be dropped silently by the transport.
  logger.info({ port: PORT, logLevel: logger.level }, 'server listening');
});
