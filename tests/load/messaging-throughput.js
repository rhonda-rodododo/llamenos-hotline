import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const messageSendLatency = new Trend('message_send_latency', true);
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
  scenarios: {
    messaging: {
      executor: 'constant-arrival-rate',
      rate: 17,
      timeUnit: '1m',
      duration: '10m',
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    message_send_latency: ['p(95)<500'],
    errors: ['rate<0.02'],
  },
};

export default function () {
  const messageSid = `SM${randomHex(16)}`;
  const senderNumber = `+1${randomBetween(2000000000, 9999999999)}`;

  const bodies = [
    'I need help urgently',
    'Can someone please call me back?',
    'Thank you for your support',
    'Is there anyone available to talk?',
    'I have a question about services',
    'Please help me find resources',
    'I am in a crisis situation',
    'Can you connect me with a counselor?',
  ];

  const res = http.post(
    `${BASE_URL}/api/test-simulate/incoming-message`,
    JSON.stringify({
      messageSid,
      from: senderNumber,
      to: '+18005551234',
      body: bodies[randomBetween(0, bodies.length - 1)],
      channel: 'sms',
    }),
    { headers }
  );

  const ok = check(res, {
    'message accepted': (r) => r.status === 200,
  });
  errorRate.add(!ok);
  messageSendLatency.add(res.timings.duration);
}
