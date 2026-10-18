import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_NAMES = ['deposit', 'sendmoney', 'payment'];
const PHASES = ['phase1', 'phase2', 'phase3', 'phase4'];
const requests = {};
const failures = {};
const transactionChecks = {};
const durations = {};
const phaseRequests = {};

for (const api of API_NAMES) {
  requests[api] = new Counter(`${api}_requests`);
  failures[api] = new Rate(`${api}_failures`);
  transactionChecks[api] = new Rate(`${api}_transaction_checks`);
  durations[api] = new Trend(`${api}_duration`, true);
  for (const phase of PHASES) {
    phaseRequests[`${api}_${phase}`] = new Counter(`${api}_${phase}_requests`);
    durations[`${api}_${phase}`] = new Trend(`${api}_${phase}_duration`, true);
  }
}

function env(name, fallback) {
  return __ENV[name] || fallback;
}

const vus = Number(env('DMONEY_VUS_PER_FLOW', '1'));
if (!Number.isInteger(vus) || vus < 1 || vus > 5) {
  throw new Error('DMONEY_VUS_PER_FLOW must be an integer from 1 to 5 for a local run.');
}

const userDefinitions = {
  agent1: ['AGENT1_IDENTIFIER', 'AGENT1_PASSWORD'],
  agent2: ['AGENT2_IDENTIFIER', 'AGENT2_PASSWORD'],
  customer1: ['CUSTOMER1_IDENTIFIER', 'CUSTOMER1_PASSWORD'],
  customer2: ['CUSTOMER2_IDENTIFIER', 'CUSTOMER2_PASSWORD'],
  merchant1: ['MERCHANT1_IDENTIFIER', 'MERCHANT1_PASSWORD'],
  merchant2: ['MERCHANT2_IDENTIFIER', 'MERCHANT2_PASSWORD'],
};

const baseUrl = env('DMONEY_BASE_URL', 'http://127.0.0.1:5000').replace(/\/$/, '');
const partnerKey = __ENV.DMONEY_PARTNER_KEY;
const defaultOtp = env('DMONEY_DEFAULT_OTP', '0000');
const requestTimeout = env('DMONEY_REQUEST_TIMEOUT', '10s');
const amounts = {
  deposit: Number(env('DMONEY_DEPOSIT_AMOUNT', '10')),
  sendmoney: Number(env('DMONEY_SEND_AMOUNT', '10')),
  payment: Number(env('DMONEY_PAYMENT_AMOUNT', '10')),
};

const flowDefinitions = [
  ['p1_customer1_sends', 'phase1', 'sendmoney', 'customer1', 'customer2', 0],
  ['p1_customer2_pays', 'phase1', 'payment', 'customer2', 'merchant1', 0],
  ['p2_customer2_sends', 'phase2', 'sendmoney', 'customer2', 'customer1', 30],
  ['p2_agent1_deposits', 'phase2', 'deposit', 'agent1', 'customer2', 30],
  ['p2_customer1_pays', 'phase2', 'payment', 'customer1', 'merchant1', 30],
  ['p3_agent1_deposits', 'phase3', 'deposit', 'agent1', 'customer1', 60],
  ['p3_agent2_deposits', 'phase3', 'deposit', 'agent2', 'customer2', 60],
  ['p3_customer1_sends', 'phase3', 'sendmoney', 'customer1', 'customer2', 60],
  ['p3_customer2_pays', 'phase3', 'payment', 'customer2', 'merchant2', 60],
  ['p4_agent1_pays', 'phase4', 'payment', 'agent1', 'merchant1', 90],
  ['p4_agent2_pays', 'phase4', 'payment', 'agent2', 'merchant2', 90],
  ['p4_customer1_pays', 'phase4', 'payment', 'customer1', 'merchant1', 90],
  ['p4_customer2_pays', 'phase4', 'payment', 'customer2', 'merchant2', 90],
];

const scenarios = {};
for (const [name, phase, api, sender, recipient, start] of flowDefinitions) {
  scenarios[name] = {
    executor: 'constant-vus',
    exec: 'runFlow',
    vus,
    duration: '30s',
    startTime: `${start}s`,
    gracefulStop: '0s',
    tags: { phase, api },
    env: { FLOW_NAME: name, PHASE: phase, API: api, SENDER: sender, RECIPIENT: recipient },
  };
}

export const options = {
  scenarios,
  discardResponseBodies: false,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    checks: ['rate>=0.99'],
  },
};

for (const api of API_NAMES) {
  options.thresholds[`${api}_duration`] = ['p(95)<1000'];
  options.thresholds[`${api}_failures`] = ['rate<0.01'];
  options.thresholds[`${api}_transaction_checks`] = ['rate>=0.99'];
}

function safeJson(response) {
  try { return response.json(); } catch (_) { return {}; }
}

export function setup() {
  if (!partnerKey) throw new Error('DMONEY_PARTNER_KEY is required for transaction authentication.');
  for (const [user, [identifierKey, passwordKey]] of Object.entries(userDefinitions)) {
    if (!__ENV[identifierKey] || !__ENV[passwordKey]) {
      throw new Error(`Missing credentials for ${user}; set ${identifierKey} and ${passwordKey}.`);
    }
  }
  for (const [api, amount] of Object.entries(amounts)) {
    if (!Number.isFinite(amount) || amount < 10) throw new Error(`${api} amount must be a number of at least 10 Tk.`);
  }

  const tokens = {};
  for (const [user, [identifierKey, passwordKey]] of Object.entries(userDefinitions)) {
    const identifier = __ENV[identifierKey];
    const login = http.post(`${baseUrl}/user/login`, JSON.stringify({
      [identifier.includes('@') ? 'email' : 'phone_number']: identifier,
      password: __ENV[passwordKey],
    }), { headers: { 'Content-Type': 'application/json' }, timeout: requestTimeout, tags: { name: 'login' } });
    let body = safeJson(login);
    if (login.status !== 200) throw new Error(`Login failed for ${user} (HTTP ${login.status}); workload was not started.`);

    if (body.otpRequired === true) {
      const verify = http.post(`${baseUrl}/user/verify-otp?env=dev`, JSON.stringify({ identifier, otp: defaultOtp }), {
        headers: { 'Content-Type': 'application/json' }, timeout: requestTimeout, tags: { name: 'verify_otp' },
      });
      body = safeJson(verify);
      if (verify.status !== 200) throw new Error(`OTP verification failed for ${user} (HTTP ${verify.status}); workload was not started.`);
    }
    if (body.message !== 'Login successful' || typeof body.token !== 'string' || !body.token) {
      throw new Error(`Authentication response for ${user} did not contain the expected login result and token.`);
    }
    tokens[user] = body.token;
  }
  return { tokens };
}

export function runFlow(data) {
  const api = __ENV.API;
  const phase = __ENV.PHASE;
  const sender = __ENV.SENDER;
  const recipient = __ENV.RECIPIENT;
  const paths = { deposit: '/transaction/deposit', sendmoney: '/transaction/sendmoney', payment: '/transaction/payment' };
  const amount = amounts[api];
  const payload = { from_account: __ENV[`${sender.toUpperCase()}_IDENTIFIER`], to_account: __ENV[`${recipient.toUpperCase()}_IDENTIFIER`], amount };
  const response = http.post(`${baseUrl}${paths[api]}`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.tokens[sender]}`,
      'X-AUTH-SECRET-KEY': partnerKey,
    },
    timeout: requestTimeout,
    tags: { api, phase, flow: __ENV.FLOW_NAME },
  });
  const body = safeJson(response);
  const okStatus = response.status === 201;
  const okMessage = body.message === ({ deposit: 'Deposit successful', sendmoney: 'Send money successful', payment: 'Payment successful' })[api];
  const okId = typeof body.trnxId === 'string' && body.trnxId.length > 0;
  const passed = okStatus && okMessage && okId;

  requests[api].add(1, { phase });
  phaseRequests[`${api}_${phase}`].add(1);
  failures[api].add(!passed, { phase });
  transactionChecks[api].add(passed, { phase });
  durations[api].add(response.timings.duration, { phase });
  durations[`${api}_${phase}`].add(response.timings.duration);
  check(response, {
    [`${api} ${phase}: HTTP 201`]: () => okStatus,
    [`${api} ${phase}: successful message`]: () => okMessage,
    [`${api} ${phase}: transaction ID`]: () => okId,
  });
  check(response, { [`${api} ${phase}: transaction succeeded`]: () => passed });
}

export function handleSummary(data) {
  return { 'reports/k6-summary.json': JSON.stringify(data, null, 2) };
}




