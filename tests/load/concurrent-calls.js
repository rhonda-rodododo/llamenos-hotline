import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const callSetupLatency = new Trend('call_setup_latency', true);
const callAnswerLatency = new Trend('call_answer_latency', true);
const errorRate = new Rate('errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_SECRET = __ENV.TEST_SECRET || 'test-secret';

const headers = {
  'Content-Type': 'application/json',
  'X-Test-Secret': TEST_SECRET,
};

function randomHex(bytes) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < bytes * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '2m', target: 25 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    call_setup_latency: ['p(95)<2000'],
    call_answer_latency: ['p(95)<1000'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  const callSid = `CA${randomHex(16)}`;
  const callerNumber = `+1${randomBetween(2000000000, 9999999999)}`;

  // 1. Incoming call
  const incomingRes = http.post(
    `${BASE_URL}/api/test-simulate/incoming-call`,
    JSON.stringify({
      callSid,
      from: callerNumber,
      to: '+18005551234',
    }),
    { headers }
  );

  const setupOk = check(incomingRes, {
    'incoming call status 200': (r) => r.status === 200,
  });
  errorRate.add(!setupOk);
  callSetupLatency.add(incomingRes.timings.duration);

  if (!setupOk) return;

  sleep(randomBetween(1, 3));

  // 2. Answer call
  const answerRes = http.post(
    `${BASE_URL}/api/test-simulate/answer-call`,
    JSON.stringify({
      callSid,
      volunteerId: `vol-${randomHex(8)}`,
    }),
    { headers }
  );

  const answerOk = check(answerRes, {
    'answer call status 200': (r) => r.status === 200,
  });
  errorRate.add(!answerOk);
  callAnswerLatency.add(answerRes.timings.duration);

  // Simulate call duration
  sleep(randomBetween(5, 15));

  // 3. End call
  const endRes = http.post(
    `${BASE_URL}/api/test-simulate/end-call`,
    JSON.stringify({
      callSid,
      duration: randomBetween(30, 300),
    }),
    { headers }
  );

  check(endRes, {
    'end call status 200': (r) => r.status === 200,
  });

  sleep(1);
}
