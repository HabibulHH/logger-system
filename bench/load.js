// load.js — k6 load script. Drives a constant request RATE (not just N virtual
// users) so every logger config faces identical traffic, then reports the real
// HTTP latency distribution. dropped_iterations > 0 means k6 could not launch
// requests fast enough — i.e. the server fell behind the target rate.
//
//   k6 run -e RATE=2000 -e DURATION=15s -e BASE=http://localhost:3100 \
//          -e OUT=k6-pino-transport.json load.js

import http from 'k6/http';

const RATE = Number(__ENV.RATE || 2000);
const DURATION = __ENV.DURATION || '15s';
const BASE = __ENV.BASE || 'http://localhost:3100';
// Which route to hammer. Default is the near-no-op /students/:id; the realistic
// busy-server scenario points this at /report/ (real per-request CPU work).
const PATH = __ENV.PATH || '/students/';

export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 100,
      maxVUs: 2000,
    },
  },
  // Keep the summary quiet; the orchestrator reads the JSON export.
  summaryTrendStats: ['avg', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  // Hit valid students only (ids 1..5) so http_req_failed reflects real errors,
  // not intentional 404s — keeps the failure metric meaningful.
  const id = 1 + Math.floor(Math.random() * 5);
  http.get(`${BASE}${PATH}${id}`);
}

export function handleSummary(data) {
  const out = __ENV.OUT || 'k6-summary.json';
  return { [out]: JSON.stringify(data) };
}
// infra
// scale
// ram ssd hdd
// internet
// andwith 
// se
// age 
// default time 