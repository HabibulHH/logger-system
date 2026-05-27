// 07 — The same app, now with the structured logger. Every problem solved.
//
// Run it like production:   LOG_LEVEL=info node 07-fixed.js
// Run it like dev (verbose): LOG_LEVEL=debug node 07-fixed.js
// Pretty-print for humans:    LOG_LEVEL=info node 07-fixed.js | npx --yes pino-pretty 2>/dev/null || cat
//
// Same business logic as 01-naive.js — compare them side by side.

const log = require('./logger');

function getUser(id) {
  log.debug('fetching user', { id }); // gone in prod (LOG_LEVEL=info)
  return {
    id,
    name: 'Ada',
    email: 'ada@example.com',
    password: 'hunter2', // will be auto-redacted if ever logged
  };
}

function charge(reqLog, user, amount) {
  reqLog.debug('charging', { amount });
  if (amount > 100) {
    reqLog.warn('large charge', { amount }); // a real, filterable WARNING
  }
  if (amount > 1000) {
    reqLog.error('charge rejected: over limit', { amount });
    return { ok: false };
  }
  return { ok: true, amount };
}

function handleRequest(id, reqId) {
  // child() binds reqId -> EVERY log line in this request is traceable (#2)
  const reqLog = log.child({ reqId });
  reqLog.info('request received', { id });

  const user = getUser(id);
  // Even if we log the whole user, the password is redacted (#5):
  reqLog.debug('loaded user', { user });

  const result = charge(reqLog, user, 150);
  reqLog.info('request complete', { ok: result.ok });
  return result;
}

// Two interleaved requests — now fully distinguishable by reqId (#2),
// each line is JSON (#3), levels let you filter (#1), and debug/secrets
// vanish in prod (#5).
handleRequest(42, 'req-aaa');
handleRequest(99, 'req-bbb');

// Try the two LOG_LEVEL runs above and watch the debug lines appear/disappear
// with NO code change. That's the whole point.
