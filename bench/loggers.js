// loggers.js — shared logger factories for the k6 load test. The two configs
// (winston, pino-transport) are defined here so server.js can swap between
// them via the LOGGER env var.
//
// createLogger(config, files) returns { logger, flush, style }:
//   logger — the configured logger instance
//   flush  — async () => Promise that resolves only once every byte is on disk
//   style  — 'winston' | 'pino' (the two call signatures differ)

const fs = require('fs');
const os = require('os');
const path = require('path');

const REDACT_KEYS = ['password', 'token', 'secret'];
const TMP = os.tmpdir();

// File paths keyed by a tag so separate runs never clobber each other's output.
function filesFor(tag, config) {
  return {
    app: path.join(TMP, `bench-${tag}-${config}-app.log`),
    err: path.join(TMP, `bench-${tag}-${config}-error.log`),
  };
}

function makeWinston(files) {
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
    level: 'info',
    defaultMeta: { service: 'bench' },
    format: winston.format.combine(redact(), winston.format.timestamp(), winston.format.json()),
    transports: [
      new winston.transports.Console({ stderrLevels: [] }),
      new winston.transports.File({ filename: files.app }),
      new winston.transports.File({ filename: files.err, level: 'error' }),
    ],
  });
  // end() flushes all transports; 'finish' fires when the writable side has
  // drained every queued write to its sink.
  const flush = () => new Promise((resolve) => {
    logger.on('finish', resolve);
    logger.end();
  });
  return { logger, flush, style: 'winston' };
}

function makePinoTransport(files) {
  const pino = require('pino');
  const transport = pino.transport({
    targets: [
     // { target: 'pino/file', level: 'trace', options: { destination: 1 } },
      { target: 'pino/file', level: 'trace', options: { destination: files.app, mkdir: true } },
      { target: 'pino/file', level: 'error', options: { destination: files.err, mkdir: true } },
    ],
  });
  const logger = pino({
    level: 'info',
    base: { service: 'bench' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_KEYS, censor: '[REDACTED]' },
  }, transport);
  // The worker thread writes asynchronously. end() tells it to drain every
  // queued line and close; 'close' fires only after the worker is done. This
  // is the fix for the dropped-lines bug — process.exit() would otherwise kill
  // the worker mid-flush.
  const flush = () => new Promise((resolve) => {
    transport.on('close', resolve);
    transport.end();
  });
  return { logger, flush, style: 'pino' };
}

const FACTORIES = {
  'winston': makeWinston,
  'pino-transport': makePinoTransport,
};

function createLogger(config, files) {
  const make = FACTORIES[config];
  if (!make) throw new Error(`unknown config: ${config}`);
  // Truncate output files so each run measures a fresh append.
  for (const f of [files.app, files.err]) { try { fs.unlinkSync(f); } catch {} }
  return make(files);
}

const CONFIGS = Object.keys(FACTORIES);

module.exports = { REDACT_KEYS, CONFIGS, filesFor, createLogger };
