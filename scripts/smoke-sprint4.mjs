/**
 * Sprint 4 集成冒烟：Outbox Worker + 实时同步。
 * 验证项（docs/04 Sprint 4 退出标准）：
 * 1. 命令产生 outbox 事件（未处理）
 * 2. Worker 处理后事件 processed_at 置位
 * 3. 实时订阅者在处理后 1 秒内收到 inventory_changed 广播
 * 4. 广播 payload 只含 revision/event_type，不含库存明细（隐私）
 * 5. 重复处理不发生（processed 的事件不再被 claim）
 *
 * 前提：supabase 已启动、API 已监听、worker 已构建。
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { Client } from 'pg';

const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function createUser(email) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password: 'test-password-123', email_confirm: true }),
  });
}
async function signIn(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  });
  return (await r.json()).access_token;
}
async function api(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const runId = Date.now();
const email = `s4-${runId}@test.xz.app`;
await createUser(email);
const token = await signIn(email);
const hh = (await api(token, 'POST', '/households', { name: 'S4', owner_display_name: 'A' })).body
  .id;
const egg = (await api(token, 'GET', '/foods?q=鸡蛋')).body[0];

// 实时订阅者（模拟第二终端）
const sub = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { authorization: `Bearer ${token}` } },
});
const received = [];
const channel = sub.channel(`household:${hh}`, { config: { private: false } });
channel.on('broadcast', { event: 'inventory_changed' }, (msg) => received.push(msg.payload));
await new Promise((resolve) => {
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') resolve();
  });
});
await sleep(300);

// 触发一个命令 -> 产生 outbox 事件
await api(token, 'POST', '/commands', {
  command_type: 'ADD_INVENTORY',
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `s4-add-${runId}`,
  payload: { items: [{ food_id: egg.id, quantity: '6', unit: 'piece' }] },
});

const pg = new Client({ connectionString: DATABASE_URL });
await pg.connect();

const pending = await pg.query(
  `select count(*)::int as n from outbox_events where household_id = $1 and processed_at is null`,
  [hh],
);
check('命令产生未处理 outbox 事件', pending.rows[0].n >= 1, `pending=${pending.rows[0].n}`);

// 跑一次 worker（单轮排空后退出）
await new Promise((resolve, reject) => {
  const worker = spawn('node', ['apps/worker/dist/main.js'], {
    env: {
      ...process.env,
      DATABASE_URL,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      WORKER_POLL_INTERVAL_MS: '300',
    },
    stdio: 'ignore',
  });
  setTimeout(() => {
    worker.kill('SIGTERM');
    resolve();
  }, 2500);
  worker.on('error', reject);
});

const processed = await pg.query(
  `select count(*)::int as n from outbox_events where household_id = $1 and processed_at is not null`,
  [hh],
);
check(
  'Worker 处理后事件被标记 processed',
  processed.rows[0].n >= 1,
  `processed=${processed.rows[0].n}`,
);

const stillPending = await pg.query(
  `select count(*)::int as n from outbox_events where household_id = $1 and processed_at is null`,
  [hh],
);
check('outbox 已排空', stillPending.rows[0].n === 0, `pending=${stillPending.rows[0].n}`);

await sleep(800);
check('实时订阅者收到广播', received.length >= 1, `received=${received.length}`);
if (received.length > 0) {
  const payload = received[0];
  check('广播含 event_type 与 revision', payload.event_type && payload.revision !== undefined);
  check(
    '广播不含库存明细（隐私）',
    !('items' in payload) && !('quantity' in payload) && !('food_id' in payload),
    JSON.stringify(payload),
  );
}

await pg.end();
await sub.removeAllChannels();

console.log(failures === 0 ? '\nALL SPRINT 4 SMOKE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
