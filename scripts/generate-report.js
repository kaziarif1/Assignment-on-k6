const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'reports', 'k6-summary.json');
const output = path.join(root, 'reports', 'performance-report.html');
const metricsOutput = path.join(root, 'reports', 'k6-metrics-output.html');
if (!fs.existsSync(input)) {
  console.error('No reports/k6-summary.json found. Run the k6 workload first.');
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(input, 'utf8'));
const metrics = summary.metrics || {};
const names = ['deposit', 'sendmoney', 'payment'];
const phases = ['phase1', 'phase2', 'phase3', 'phase4'];
const value = (metric, key, fallback = 0) => Number(metrics[metric]?.values?.[key] ?? fallback);
const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '—';
const pct = (n) => `${fmt(n * 100)}%`;
const runSeconds = (Number(summary.state?.testRunDurationMs) || 120000) / 1000;
const transactionRequests = names.reduce((total, api) => total + value(`${api}_requests`, 'count'), 0);
const apiThroughput = api => value(`${api}_requests`, 'count') / runSeconds;
const apiRows = names.map(api => {
  const count = value(`${api}_requests`, 'count');
  const duration = `${api}_duration`;
  const failure = value(`${api}_failures`, 'rate');
  const failedRequests = value(`${api}_failures`, 'passes');
  const checks = value(`${api}_transaction_checks`, 'rate');
  return `<tr><th>${api}</th><td>${count}</td><td>${fmt(apiThroughput(api), 2)}</td><td>${fmt(value(duration, 'avg'))} ms</td><td>${fmt(value(duration, 'med'))} ms</td><td>${fmt(value(duration, 'p(90)'))} ms</td><td>${fmt(value(duration, 'p(95)'))} ms</td><td>${fmt(value(duration, 'max'))} ms</td><td>${failedRequests}</td><td>${pct(failure)}</td><td>${pct(checks)}</td></tr>`;
}).join('');
const phaseRows = names.flatMap(api => phases.map(phase => {
  const count = value(`${api}_${phase}_requests`, 'count');
  const duration = `${api}_${phase}_duration`;
  const avg = count ? `${fmt(value(duration, 'avg'))} ms` : '—';
  const p95 = count ? `${fmt(value(duration, 'p(95)'))} ms` : '—';
  return `<tr><th>${api}</th><td>${phase.replace('phase', 'Phase ')}</td><td>${count}</td><td>${fmt(count / 30, 2)}</td><td>${avg}</td><td>${p95}</td></tr>`;
})).join('');
const thresholdRows = Object.entries(metrics).filter(([name]) => name === 'http_req_failed' || name === 'http_req_duration' || name === 'checks' || names.some(api => name === `${api}_duration` || name === `${api}_failures` || name === `${api}_transaction_checks`)).map(([name, metric]) => {
  const statuses = Object.values(metric.thresholds || {});
  const pass = statuses.length ? statuses.every(t => t.ok) : null;
  const expressions = Object.keys(metric.thresholds || {});
  return `<tr><td>${name}</td><td>${expressions.join('; ') || '—'}</td><td class="${pass ? 'pass' : 'fail'}">${pass === null ? 'not configured' : pass ? 'PASS' : 'FAIL'}</td></tr>`;
}).join('');
const overall = metrics.http_req_duration?.values || {};
const overallCount = value('http_reqs', 'count');
const failedHttpRequests = value('http_req_failed', 'passes');
const maxApiThroughput = Math.max(...names.map(apiThroughput), 1);
const throughputBars = names.map(api => `<div class="bar-row"><span>${api}</span><div class="bar-track"><div class="bar" style="width:${fmt(apiThroughput(api) / maxApiThroughput * 100, 1)}%"></div></div><strong>${fmt(apiThroughput(api), 2)} req/s</strong></div>`).join('');
const report = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>dMoney k6 performance report</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#17202a}h1,h2{color:#123b60}table{border-collapse:collapse;width:100%;margin:1rem 0 2rem;font-size:13px}th,td{border:1px solid #d7dee5;padding:.5rem;text-align:right}th:first-child,td:first-child{text-align:left}thead{background:#eef4f8}.cards{display:flex;gap:1rem;flex-wrap:wrap}.card{background:#eef4f8;border-radius:8px;padding:1rem;min-width:160px}.pass{color:#147d35;font-weight:bold}.fail{color:#b42318;font-weight:bold}.note{color:#536273}.bar-row{display:grid;grid-template-columns:110px 1fr 100px;gap:.75rem;align-items:center;margin:.6rem 0}.bar-track{height:18px;background:#edf1f5;border-radius:9px}.bar{height:100%;background:#2673a8;border-radius:9px}</style></head><body>
<h1>dMoney transaction performance report</h1><p>Generated from the actual k6 summary on ${new Date().toISOString()}. Configured workload: 120 seconds; observed run time: ${fmt(runSeconds, 2)} seconds. Transaction throughput uses observed transaction request counts divided by observed run time.</p>
<section class="cards"><div class="card"><strong>Transaction API requests</strong><br>${transactionRequests}</div><div class="card"><strong>All HTTP requests</strong><br>${overallCount} <small>(includes setup login)</small></div><div class="card"><strong>Transaction throughput</strong><br>${fmt(transactionRequests / runSeconds, 2)} req/s</div><div class="card"><strong>Average HTTP duration</strong><br>${fmt(overall.avg)} ms</div><div class="card"><strong>Median duration</strong><br>${fmt(overall.med)} ms</div><div class="card"><strong>p(90) / p(95)</strong><br>${fmt(overall['p(90)'])} / ${fmt(overall['p(95)'])} ms</div><div class="card"><strong>Maximum duration</strong><br>${fmt(overall.max)} ms</div><div class="card"><strong>HTTP failed requests</strong><br>${failedHttpRequests} (${pct(value('http_req_failed', 'rate'))})</div><div class="card"><strong>Checks passed</strong><br>${pct(value('checks', 'rate'))}</div></section>
<h2>API throughput</h2>${throughputBars}
<h2>API comparison</h2><table><thead><tr><th>API</th><th>Requests</th><th>Req/s</th><th>Average</th><th>Median</th><th>p(90)</th><th>p(95)</th><th>Maximum</th><th>Failed requests</th><th>Failure rate</th><th>Transaction checks passed</th></tr></thead><tbody>${apiRows}</tbody></table>
<h2>Phase comparison</h2><table><thead><tr><th>API</th><th>Phase</th><th>Requests</th><th>Req/s</th><th>Average</th><th>p(95)</th></tr></thead><tbody>${phaseRows}</tbody></table>
<h2>Thresholds</h2><table><thead><tr><th>Metric</th><th>Target</th><th>Status</th></tr></thead><tbody>${thresholdRows}</tbody></table>
<p class="note">This report contains observed values only. Empty/missing measurements are shown as zero or an em dash; no values are synthesized. The API controller enforces customer daily transaction-count and wallet-balance limits; the custom metrics record API failures but the k6 summary does not retain response bodies, so error messages are not available from this report. See raw reports/k6-summary.json for metric counts and threshold results.</p></body></html>`;
fs.writeFileSync(output, report);
console.log(`Wrote ${path.relative(root, output)}`);

const metricView = {
  runDurationSeconds: Number(fmt(runSeconds, 2)),
  transactionApiRequests: transactionRequests,
  allHttpRequestsIncludingSetupLogin: overallCount,
  httpRequestFailureRate: value('http_req_failed', 'rate'),
  overallCheckPassRate: value('checks', 'rate'),
  overallHttpDurationMs: overall,
  apis: Object.fromEntries(names.map(api => [api, {
      requests: value(`${api}_requests`, 'count'),
      failures: value(`${api}_failures`, 'passes'),
      failureRate: value(`${api}_failures`, 'rate'),
      transactionCheckPassRate: value(`${api}_transaction_checks`, 'rate'),
      durationMs: metrics[`${api}_duration`]?.values || {},
    }])),
  thresholds: Object.fromEntries(Object.entries(metrics).flatMap(([name, metric]) =>
    Object.entries(metric.thresholds || {}).map(([expression, status]) => [`${name}: ${expression}`, status.ok ? 'PASS' : 'FAIL'])
  )),
};
const escapeHtml = text => text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
const metricsPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>k6 metrics output</title><style>body{margin:0;background:#101820;color:#dce8ef;font:15px/1.5 ui-monospace,Consolas,monospace}header{padding:1.2rem 2rem;background:#172631;color:#8ce3bb}h1{font-size:1.2rem;margin:0}p{color:#a9bac5}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem 2rem;margin:0;font-size:14px}.pass{color:#8ce3bb}.fail{color:#ff8585}</style></head><body><header><h1>k6 metrics output · dMoney transaction workload</h1><p>Derived directly from reports/k6-summary.json. No values are fabricated.</p></header><pre>${escapeHtml(JSON.stringify(metricView, null, 2))}</pre></body></html>`;
fs.writeFileSync(metricsOutput, metricsPage);
console.log(`Wrote ${path.relative(root, metricsOutput)}`);

