// k6bench.js — end-to-end load-test orchestrator. For each logger config it:
//   1. boots server.js with that LOGGER on its own port (stdout -> /dev/null)
//   2. waits for the "READY" marker on stderr
//   3. runs k6 (load.js) at a fixed request rate, exporting a JSON summary
//   4. SIGTERMs the server (graceful flush) and parses the real HTTP latency
//
// This measures what a user actually feels — full Express + child-logger +
// redact path under real HTTP traffic — unlike the in-process microbenchmarks.
//
// Usage:
//   node k6bench.js                 # 2000 req/s, 15s
//   node k6bench.js 5000 15s        # 5000 req/s, 15s
//   node k6bench.js <rate> <duration>

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONFIGS } = require('./loggers');

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (b) => {
      buf += b.toString();
      if (buf.includes('READY')) { child.stderr.off('data', onData); resolve(); }
    };
    child.stderr.on('data', onData);
    child.on('exit', (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error('server did not become ready in 10s')), 10000);
  });
}

function startServer(cfg, port) {
  const devnull = fs.openSync(os.devNull, 'w');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, LOGGER: cfg, PORT: String(port) },
    stdio: ['ignore', devnull, 'pipe'],
  });
  child._devnull = devnull;
  return child;
}

function runK6(port, outFile, rate, duration, reqPath) {
  return new Promise((resolve, reject) => {
    const args = ['run',
      '-e', `RATE=${rate}`, '-e', `DURATION=${duration}`,
      '-e', `BASE=http://localhost:${port}`, '-e', `OUT=${outFile}`,
      '-e', `PATH=${reqPath}`,
      '--quiet', 'load.js'];
    const child = spawn('k6', args, { cwd: __dirname, stdio: ['ignore', 'ignore', 'ignore'], shell: true });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`k6 exited ${code}`)));
    child.on('error', reject);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.on('exit', () => { try { fs.closeSync(child._devnull); } catch {} resolve(); });
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 4000);
  });
}

function parseSummary(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const m = data.metrics || {};
  const dur = (m.http_req_duration && m.http_req_duration.values) || {};
  const reqs = (m.http_reqs && m.http_reqs.values) || {};
  const dropped = (m.dropped_iterations && m.dropped_iterations.values) || {};
  const failed = (m.http_req_failed && m.http_req_failed.values) || {};
  return {
    avgMs: dur.avg || 0,
    p95Ms: dur['p(95)'] || 0,
    p99Ms: dur['p(99)'] || 0,
    maxMs: dur.max || 0,
    reqCount: reqs.count || 0,
    achievedRps: reqs.rate || 0,
    dropped: dropped.count || 0,
    failRate: failed.rate || 0,
  };
}

function renderTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const lines = [rows[0].map((c, i) => String(c).padEnd(widths[i])).join('  '), sep];
  for (let r = 1; r < rows.length; r++) {
    lines.push(rows[r].map((c, i) => String(c).padStart(widths[i])).join('  '));
  }
  return lines.join('\n');
}

const f1 = (n) => (typeof n === 'number' ? n.toFixed(1) : String(n));

// Run one scenario (rate/duration/route) across every logger config, booting a
// fresh server per config. Returns the parsed per-config results; logs progress
// as it goes. Reused by both the CLI below and report.js.
async function runScenario({ rate, duration = '15s', reqPath = '/students/' }) {
  console.log(`\nk6 end-to-end load test`);
  console.log(`Target: ${rate.toLocaleString()} req/s for ${duration}, real HTTP to ${reqPath}:id.`);
  console.log(`Each config: fresh server, same traffic. Measuring real request latency.\n`);

  const results = [];
  for (let i = 0; i < CONFIGS.length; i++) {
    const cfg = CONFIGS[i];
    const port = 3100 + i;
    const outFile = `k6-${cfg}.json`;
    process.stdout.write(`Running ${cfg.padEnd(18)} ... `);
    const server = startServer(cfg, port);
    try {
      await waitForReady(server);
      await runK6(port, outFile, rate, duration, reqPath);
      const r = parseSummary(path.join(__dirname, outFile));
      r.config = cfg;
      results.push(r);
      const keep = r.dropped > 0 ? `BEHIND (${r.dropped} dropped)` : 'kept up';
      console.log(`p99 ${f1(r.p99Ms)} ms, avg ${f1(r.avgMs)} ms, ${Math.round(r.achievedRps).toLocaleString()} req/s, ${keep}`);
    } catch (e) {
      console.log('FAILED'); console.error('  ' + e.message);
    } finally {
      await stopServer(server);
    }
  }
  return results;
}

function printTable(results) {
  const header = ['Config', 'achieved req/s', 'avg (ms)', 'p95 (ms)', 'p99 (ms)', 'max (ms)', 'dropped', 'fail %'];
  const rows = [header, ...results.map((r) => [
    r.config, Math.round(r.achievedRps).toLocaleString(),
    f1(r.avgMs), f1(r.p95Ms), f1(r.p99Ms), f1(r.maxMs),
    r.dropped.toLocaleString(), (r.failRate * 100).toFixed(2),
  ])];
  console.log('\n' + renderTable(rows) + '\n');
}

module.exports = { runScenario, printTable, f1 };

// CLI: node k6bench.js [rate] [duration] [path]
if (require.main === module) {
  const rate = Number(process.argv[2] || 2000);
  const duration = process.argv[3] || '15s';
  const reqPath = process.argv[4] || '/students/';
  runScenario({ rate, duration, reqPath }).then((results) => {
    if (!results.length) { console.error('No results.'); process.exit(1); }
    printTable(results);
    const best = results.reduce((a, b) => a.p99Ms <= b.p99Ms ? a : b);
    console.log(`Lowest real request latency p99: ${best.config}\n`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
