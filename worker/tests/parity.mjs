import { setTimeout as delay } from 'timers/promises';
import assert from 'node:assert/strict';

const WORKER = process.env.WORKER_URL || 'http://localhost:8787';
const ORIGIN = process.env.ORIGIN_URL || 'http://localhost:5000';

function jurl(base, path) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, body: text };
  }
}

function normalizeFaqList(obj) {
  // Only compare presence and basic fields
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj.faqs)) {
    return {
      success: !!obj.success,
      faqs: obj.faqs.map((f) => ({
        _id: f._id,
        question: String(f.question || ''),
        answer: String(f.answer || ''),
        category: String(f.category || ''),
      })),
    };
  }
  return obj;
}

async function compare(path) {
  const [a, b] = await Promise.all([
    fetchJson(jurl(WORKER, path)),
    fetchJson(jurl(ORIGIN, path)),
  ]);
  const na = normalizeFaqList(a.body);
  const nb = normalizeFaqList(b.body);
  assert.equal(a.status, b.status, `Status mismatch for ${path}: ${a.status} vs ${b.status}`);
  assert.deepEqual(na, nb, `Body mismatch for ${path}`);
  console.log(`✅ Parity OK: ${path}`);
}

async function main() {
  const paths = [
    '/api/health',
    '/api/faqs',
    '/api/faqs/search/test',
  ];
  for (const p of paths) {
    await compare(p);
    await delay(50);
  }
  console.log('All parity checks passed');
}

main().catch((err) => {
  console.error('Parity failed:', err?.stack || err?.message || err);
  process.exit(1);
});


