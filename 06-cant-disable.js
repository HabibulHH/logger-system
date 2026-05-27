// 06 — Problem #5: You can't turn it off, and it leaks secrets.
//
// Run:  node 06-cant-disable.js
//
// A console.log you added while debugging ships to production forever
// unless someone deletes the line and redeploys. There's no runtime
// switch. Worse, debug logs often dump whole objects — including
// passwords, tokens, and PII — straight into your log storage.

const user = {
  id: 42,
  email: 'ada@example.com',
  password: 'hunter2', // <-- should NEVER hit your logs
  sessionToken: 'eyJhbGciOiJIUzI1NiIsIn...', // <-- nor this
};

// "I'll just log the user to see what's going on" — extremely common,
// and now your secrets are sitting in Datadog/CloudWatch indefinitely:
console.log('DEBUG user object:', user);

// To remove this you must: edit code -> open PR -> review -> deploy.
// There is no env var, no log level, no config flag. It's all-or-nothing.
//
// With a real logger you'd:
//   - set LOG_LEVEL=info in prod so debug lines never print
//   - register redaction so `password` / `sessionToken` are masked
//   - flip verbosity at runtime without a redeploy
//
// See logger.js + 07-fixed.js for how this is solved.
