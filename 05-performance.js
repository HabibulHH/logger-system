// 05 — Problem #4: console.log is SLOW and BLOCKS the event loop.
//
// Run:  node 05-performance.js
//
// This is the one that surprises people. console.log to a terminal or
// pipe is SYNCHRONOUS in Node. Every call blocks the single-threaded
// event loop until the write finishes. At scale this throttles your
// whole server — your request handler is literally waiting on stdout.
//
// We also pay to BUILD the log message even when nobody reads it.

const N = 100_000;

// (a) Cost of the work itself (baseline) ------------------------------
let sink = 0;
let t = Date.now();
for (let i = 0; i < N; i++) {
  sink += i; // trivial "real work"
}
const baseline = Date.now() - t;

// (b) Same loop, but with a console.log each iteration ----------------
// Redirect this script's output to /dev/null to simulate logs going to
// a file/collector:   node 05-performance.js > /dev/null
t = Date.now();
for (let i = 0; i < N; i++) {
  sink += i;
  console.log('iteration ' + i + ' value=' + sink); // string built every time
}
const withLogging = Date.now() - t;

// Print the verdict to stderr so it survives `> /dev/null`.
console.error('\n--- RESULTS (' + N.toLocaleString() + ' iterations) ---');
console.error('work only:        ' + baseline + 'ms');
console.error('work + console.log: ' + withLogging + 'ms');
console.error(
  'console.log made it ~' +
    Math.round(withLogging / Math.max(baseline, 1)) +
    'x slower'
);
console.error(
  '\nKey point: that cost is paid SYNCHRONOUSLY on the event loop,'
);
console.error('so every other request waits. Real loggers buffer/async this.');


