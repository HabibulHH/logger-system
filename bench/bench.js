// bench.js — orchestrator. Spawns runner.js in a separate Node process per
// config so loggers don't share state, JIT warmups, or worker threads.
// Each child's stdout (the logger's actual output) is redirected to
// /dev/null so we measure logger work, not terminal IO.
//
// Usage:
//   node bench.js              # default 100,000 iterations per config
//   node bench.js 500000       # 500k iterations per config

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const N = Number(process.argv[2] || 100000);
const CONFIGS = ['winston', 'pino-multistream', 'pino-transport'];

function runOne(cfg) {
  return new Promise((resolve, reject) => {
    const devnull = fs.openSync('/dev/null', 'w');
    const child = spawn(process.execPath, ['runner.js', cfg, String(N)], {
      stdio: ['ignore', devnull, 'pipe'],
      cwd: __dirname,
    });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('exit', (code) => {
      fs.closeSync(devnull);
      if (code !== 0) return reject(new Error(`${cfg} exited ${code}\n${stderr}`));
      const last = stderr.trim().split('\n').filter(Boolean).pop();
      try { resolve(JSON.parse(last)); }
      catch { reject(new Error(`${cfg} produced unparseable output:\n${stderr}`)); }
    });
  });
}

function renderTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const lines = [];
  lines.push(rows[0].map((c, i) => String(c).padEnd(widths[i])).join('  '));
  lines.push(sep);
  for (let r = 1; r < rows.length; r++) {
    lines.push(rows[r].map((c, i) => String(c).padStart(widths[i])).join('  '));
  }
  return lines.join('\n');
}

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}

(async () => {
  console.log(`\nBenchmark: ${N.toLocaleString()} log lines per config`);
  console.log(`Each runner: console + 2 file sinks, JSON, redact, service base meta.`);
  console.log(`Child stdout redirected to /dev/null so terminal IO is excluded.\n`);

  const results = [];
  for (const cfg of CONFIGS) {
    process.stdout.write(`Running ${cfg.padEnd(18)} ... `);
    const t0 = Date.now();
    try {
      const r = await runOne(cfg);
      results.push(r);
      console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
                  `(emit ${r.emitWallMs} ms, end-to-end ${r.endToEndMs} ms, wrote ${(r.finalBytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      console.log(`FAILED`);
      console.error(e.message);
      process.exit(1);
    }
  }

  // Sanity: every config should have written roughly the same number of bytes
  // (same N, same payload shape). If one is way smaller, it dropped lines.
  const bytes = results.map((r) => r.finalBytes);
  const maxBytes = Math.max(...bytes);
  const minBytes = Math.min(...bytes);
  if (maxBytes > 0 && minBytes / maxBytes < 0.9) {
    console.log(`\n[warn] output sizes differ by >10% — a config may have dropped lines.`);
    for (const r of results) console.log(`  ${r.config}: ${(r.finalBytes/1024/1024).toFixed(2)} MB`);
  }

  const header = [
    'Config', 'emit (ms)', 'end-to-end (ms)',
    'emit throughput', 'real throughput', 'per-call (µs)',
    'lag p50 (ms)', 'lag p99 (ms)', 'lag max (ms)',
  ];
  const rows = [
    header,
    ...results.map((r) => [
      r.config,
      fmt(r.emitWallMs),
      fmt(r.endToEndMs),
      fmt(r.emitThroughput),
      fmt(r.endToEndThroughput),
      fmt(r.perCallUs),
      fmt(r.lagP50Ms),
      fmt(r.lagP99Ms),
      fmt(r.lagMaxMs),
    ]),
  ];

  console.log('\n' + renderTable(rows) + '\n');

  // Headline: emit throughput (what blocks your request handler) and real
  // throughput (when bytes actually reach disk) tell different stories.
  const fastestEmit = results.reduce((a, b) => a.emitThroughput > b.emitThroughput ? a : b);
  const fastestReal = results.reduce((a, b) => a.endToEndThroughput > b.endToEndThroughput ? a : b);
  console.log(`Fastest emit (main-thread blocking):  ${fastestEmit.config}`);
  console.log(`Fastest end-to-end (incl. flush):     ${fastestReal.config}\n`);
})().catch((e) => { console.error(e); process.exit(1); });
