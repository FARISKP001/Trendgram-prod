import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 500 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.WORKER_URL || 'http://localhost:8787';

export default function () {
  const health = http.get(`${BASE}/api/health`, { headers: { accept: 'application/json' } });
  check(health, {
    'health 200': (r) => r.status === 200,
  });

  const faq = http.get(`${BASE}/api/faqs`, { headers: { accept: 'application/json' } });
  check(faq, {
    'faqs 200': (r) => r.status === 200,
  });

  // simple matchmaking pressure without WS
  const userId = `u_${__VU}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const match = http.post(`${BASE}/api/match`, JSON.stringify({
    userId,
    userName: 'LoadUser',
    deviceId: 'k6',
    emotion: '😊',
  }), { headers: { 'content-type': 'application/json' } });
  check(match, {
    'match 200': (r) => r.status === 200,
  });

  sleep(0.2);
}


