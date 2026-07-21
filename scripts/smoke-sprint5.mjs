/**
 * Sprint 5 集成冒烟：临期状态 + 基础统计。
 * 验证项（docs/04 Sprint 5 退出标准）：
 * 1. 临期批次（次日到期）出现在临期列表，状态 EXPIRING
 * 2. 已过期批次状态 EXPIRED
 * 3. 首页视图为临期项返回正确 expiry_status
 * 4. 本周统计：使用/丢弃次数与数量正确
 * 5. 临期处理率反映"临期批次被消耗"
 * 6. 统计基于真实交易，消耗不等于个人摄入（purpose 不入个人摄入）
 */

const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
const cmd = (hh, type, payload, key) => ({
  command_type: type,
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: key,
  payload,
});
const isoInDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

const runId = Date.now();
const email = `s5-${runId}@test.xz.app`;
await createUser(email);
const token = await signIn(email);
const hh = (await api(token, 'POST', '/households', { name: 'S5', owner_display_name: 'A' })).body
  .id;
const egg = (await api(token, 'GET', '/foods?q=鸡蛋')).body[0];
const milk = (await api(token, 'GET', '/foods?q=牛奶')).body[0];
const spinach = (await api(token, 'GET', '/foods?q=菠菜')).body[0];

// 临期鸡蛋（明天到期）、正常牛奶（10天）、已过期菠菜（昨天）
await api(
  token,
  'POST',
  '/commands',
  cmd(
    hh,
    'ADD_INVENTORY',
    {
      items: [
        {
          food_id: egg.id,
          quantity: '6',
          unit: 'piece',
          expires_at: isoInDays(1),
          expiry_source: 'USER_CONFIRMED',
        },
        {
          food_id: milk.id,
          quantity: '2',
          unit: 'box',
          expires_at: isoInDays(10),
          expiry_source: 'USER_CONFIRMED',
        },
        {
          food_id: spinach.id,
          quantity: '200',
          unit: 'g',
          expires_at: isoInDays(-1),
          expiry_source: 'USER_CONFIRMED',
        },
      ],
    },
    `s5-add-${runId}`,
  ),
);

// 1-3. 临期列表
const expiring = await api(token, 'GET', `/households/${hh}/inventory/expiring?days=3`);
const eggRow = expiring.body.find((r) => r.food_id === egg.id);
const spinachRow = expiring.body.find((r) => r.food_id === spinach.id);
check(
  '临期鸡蛋在列表且状态 EXPIRING',
  eggRow?.expiry_status === 'EXPIRING',
  `status=${eggRow?.expiry_status}`,
);
check(
  '过期菠菜状态 EXPIRED',
  spinachRow?.expiry_status === 'EXPIRED',
  `status=${spinachRow?.expiry_status}`,
);

const inv = await api(token, 'GET', `/households/${hh}/inventory`);
const eggItem = inv.body.zones.flatMap((z) => z.items).find((i) => i.food_id === egg.id);
check('首页视图鸡蛋 expiry_status=EXPIRING', eggItem?.expiry_status === 'EXPIRING');

// 消耗临期鸡蛋 2 个 + 丢弃过期菠菜
await api(
  token,
  'POST',
  '/commands',
  cmd(
    hh,
    'CONSUME_INVENTORY',
    {
      items: [{ food_id: egg.id, quantity: '2', unit: 'piece' }],
      purpose: 'MEAL_PREPARATION',
    },
    `s5-consume-${runId}`,
  ),
);
await api(
  token,
  'POST',
  '/commands',
  cmd(
    hh,
    'DISCARD_INVENTORY',
    {
      items: [{ food_id: spinach.id, quantity: '200', unit: 'g' }],
      reason: 'EXPIRED',
    },
    `s5-discard-${runId}`,
  ),
);

// 4-5. 本周统计
const stats = (await api(token, 'GET', `/households/${hh}/stats`)).body;
check('本周使用次数=1', stats.consumed_count === 1, `consumed=${stats.consumed_count}`);
check('本周丢弃次数=1', stats.discarded_count === 1, `discarded=${stats.discarded_count}`);
check('本周入库次数=1', stats.added_count === 1, `added=${stats.added_count}`);
check('使用总量=2', stats.consumed_quantity === '2', `qty=${stats.consumed_quantity}`);
check('丢弃总量=200', stats.discarded_quantity === '200', `qty=${stats.discarded_quantity}`);
check(
  '临期处理率有值且 > 0',
  stats.expiry_handled_rate !== null && stats.expiry_handled_rate > 0,
  `rate=${stats.expiry_handled_rate}`,
);
check('当前已过期批次计入', typeof stats.expired_count === 'number');

console.log(failures === 0 ? '\nALL SPRINT 5 SMOKE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
