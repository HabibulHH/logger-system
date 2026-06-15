// report.js — runs every benchmark scenario back-to-back and writes a single
// self-contained HTML report (report.html) with per-scenario tables and p99
// bar charts. Each scenario reuses k6bench's runScenario(), so the numbers are
// identical to running the npm scripts individually.
//
//   node report.js          # runs all scenarios, writes report.html
//   npm run report
//
// The point of the report is to show the SAME two loggers flipping winner as
// the workload changes — see the three scenarios below.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScenario } = require('./k6bench');

const SCENARIOS = [
  {
    key: 'stress',
    title: 'Stress — light route, high rate',
    rate: 5000, duration: '15s', reqPath: '/students/',
    blurb: 'Near-no-op endpoint at 5,000 req/s. Logging is most of the per-request cost and the machine is not yet saturated, so pino offloading log I/O to a worker thread keeps request latency low.',
  },
  {
    key: 'realistic',
    title: 'Realistic — busy main thread (production-shaped)',
    rate: 2500, duration: '15s', reqPath: '/report/',
    blurb: 'Real per-request CPU work plus a DB-like wait at 2,500 req/s — the way an actual handler behaves. The main thread is the scarce resource and spare cores exist for the worker, so moving log work off-thread (pino) frees the event loop to serve customers.',
  },
  {
    key: 'extreme',
    title: 'Extreme — light route, saturating rate',
    rate: 10000, duration: '15s', reqPath: '/students/',
    blurb: 'Near-no-op endpoint at 10,000 req/s. The whole machine is CPU-saturated, so pino\'s worker thread has no free core to run on and its cross-thread handoff becomes overhead — winston\'s simple in-process write wins.',
  },
];

const f1 = (n) => (typeof n === 'number' ? n.toFixed(1) : String(n));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cls = (cfg) => (cfg === 'winston' ? 'winston' : 'pino');

function host() {
  const v = (pkg) => { try { return require(pkg + '/package.json').version; } catch { return '?'; } };
  return {
    cores: os.cpus().length,
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
    pino: v('pino'),
    winston: v('winston'),
  };
}

function tableRows(results) {
  return results.map((r) => `
        <tr class="${cls(r.config)}">
          <td class="cfg">${esc(r.config)}</td>
          <td>${Math.round(r.achievedRps).toLocaleString()}</td>
          <td>${f1(r.avgMs)}</td>
          <td>${f1(r.p95Ms)}</td>
          <td><strong>${f1(r.p99Ms)}</strong></td>
          <td>${f1(r.maxMs)}</td>
          <td>${r.dropped.toLocaleString()}</td>
          <td>${(r.failRate * 100).toFixed(2)}</td>
        </tr>`).join('');
}

function p99Chart(results) {
  const max = Math.max(...results.map((r) => r.p99Ms), 0.001);
  return results.map((r) => {
    const pct = Math.max((r.p99Ms / max) * 100, 2);
    return `
        <div class="bar-row">
          <span class="bar-label">${esc(r.config)}</span>
          <div class="bar-track"><div class="bar ${cls(r.config)}" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="bar-val">${f1(r.p99Ms)} ms</span>
        </div>`;
  }).join('');
}

function scenarioSection(s, results) {
  const ok = results.filter((r) => r.config);
  const winner = ok.length ? ok.reduce((a, b) => (a.p99Ms <= b.p99Ms ? a : b)) : null;
  return `
    <section class="card">
      <div class="card-head">
        <h2>${esc(s.title)}</h2>
        ${winner ? `<span class="badge ${cls(winner.config)}">winner: ${esc(winner.config)}</span>` : ''}
      </div>
      <p class="meta">${s.rate.toLocaleString()} req/s &middot; ${esc(s.duration)} &middot; route <code>${esc(s.reqPath)}:id</code></p>
      <p class="blurb">${esc(s.blurb)}</p>

      <div class="chart">
        <div class="chart-title">p99 latency <span class="hint">(lower is better)</span></div>
        ${p99Chart(ok)}
      </div>

      <table>
        <thead>
          <tr><th>config</th><th>req/s</th><th>avg</th><th>p95</th><th>p99</th><th>max</th><th>dropped</th><th>fail %</th></tr>
        </thead>
        <tbody>${tableRows(ok)}</tbody>
      </table>
    </section>`;
}

function buildHtml(sections, h, stamp) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Logger benchmark report — winston vs pino</title>
<style>
  :root {
    --bg:#0f172a; --card:#1e293b; --ink:#e2e8f0; --muted:#94a3b8; --line:#334155;
    --winston:#f59e0b; --pino:#2dd4bf;
  }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
         background:var(--bg); color:var(--ink); padding:32px 20px 64px; }
  .wrap { max-width:900px; margin:0 auto; }
  h1 { font-size:26px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 8px; }
  .host { color:var(--muted); font-size:13px; margin:0 0 28px; }
  .host code { color:var(--ink); }
  .legend { display:flex; gap:18px; margin:0 0 28px; flex-wrap:wrap; }
  .legend span { display:flex; align-items:center; gap:7px; font-size:13px; color:var(--muted); }
  .dot { width:11px; height:11px; border-radius:3px; display:inline-block; }
  .dot.winston { background:var(--winston); } .dot.pino { background:var(--pino); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:22px 24px; margin:0 0 22px; }
  .card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  h2 { font-size:18px; margin:0; }
  .badge { font-size:12px; font-weight:600; padding:4px 11px; border-radius:999px; color:#0b1220; }
  .badge.winston { background:var(--winston); } .badge.pino { background:var(--pino); }
  .meta { color:var(--muted); font-size:13px; margin:6px 0 10px; }
  .meta code { background:#0b1220; padding:1px 6px; border-radius:5px; }
  .blurb { color:#cbd5e1; margin:0 0 18px; }
  .chart { margin:0 0 18px; }
  .chart-title { font-size:13px; color:var(--muted); margin:0 0 10px; }
  .hint { opacity:.7; }
  .bar-row { display:grid; grid-template-columns:120px 1fr 80px; align-items:center; gap:12px; margin:0 0 8px; }
  .bar-label { font-size:13px; color:var(--ink); }
  .bar-track { background:#0b1220; border-radius:6px; height:22px; overflow:hidden; }
  .bar { height:100%; border-radius:6px; min-width:3px; transition:width .3s; }
  .bar.winston { background:var(--winston); } .bar.pino { background:var(--pino); }
  .bar-val { font-size:13px; text-align:right; color:var(--ink); }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-top:4px; }
  th, td { text-align:right; padding:7px 8px; border-bottom:1px solid var(--line); }
  th:first-child, td:first-child { text-align:left; }
  th { color:var(--muted); font-weight:600; }
  td.cfg { font-weight:600; }
  tr.winston td.cfg { color:var(--winston); } tr.pino td.cfg { color:var(--pino); }
  .takeaway { background:#0b1220; border:1px solid var(--line); border-radius:14px; padding:20px 24px; }
  .takeaway h2 { margin:0 0 10px; }
  .takeaway li { margin:0 0 7px; color:#cbd5e1; }
  footer { color:var(--muted); font-size:12px; text-align:center; margin-top:28px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Logger benchmark — winston vs pino</h1>
    <p class="sub">End-to-end HTTP latency under identical k6 traffic. Same two loggers; the winner changes with the workload.</p>
    <p class="host">${h.platform} &middot; ${h.cores} cores &middot; Node ${esc(h.node)} &middot; pino ${esc(h.pino)} &middot; winston ${esc(h.winston)} &middot; generated ${esc(stamp)}</p>

    <div class="legend">
      <span><i class="dot winston"></i> winston — logs on the main thread</span>
      <span><i class="dot pino"></i> pino-transport — logs on a worker thread</span>
    </div>

    ${sections}

    <div class="takeaway">
      <h2>Takeaway</h2>
      <ul>
        <li><strong>"Faster logger" is context-dependent.</strong> The same two loggers swap places as the workload changes — no single winner.</li>
        <li><strong>Pino wins when the main thread is busy and cores are spare</strong> (stress &amp; realistic): moving log I/O to a worker frees the event loop to serve requests.</li>
        <li><strong>Winston wins when the machine is fully saturated</strong> (extreme): pino's worker has no free core, so the cross-thread handoff becomes pure overhead.</li>
        <li>Always read a benchmark together with its load level and where the CPU is spent.</li>
      </ul>
    </div>

    <footer>Generated by report.js — re-run with <code>npm run report</code>.</footer>
  </div>
</body>
</html>`;
}

(async () => {
  const sections = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== Scenario: ${s.title} ===`);
    const results = await runScenario({ rate: s.rate, duration: s.duration, reqPath: s.reqPath });
    sections.push(scenarioSection(s, results));
  }

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const html = buildHtml(sections.join('\n'), host(), stamp);
  const out = path.join(__dirname, 'report.html');
  fs.writeFileSync(out, html);
  console.log(`\nReport written: ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
