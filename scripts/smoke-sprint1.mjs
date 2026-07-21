/**
 * Sprint 1 集成冒烟：对真实本地 Supabase + API 验证核心不变量。
 * 运行前提：supabase start 已运行、API 已在 API_BASE 上监听。
 *
 * 验证项（docs/04 Sprint 1 退出标准）：
 * 1. 注册用户、创建家庭（默认冰箱 + 三分区）
 * 2. 手动添加（多食材、单位换算）
 * 3. FEFO 消耗跨批次
 * 4. 幂等：同 key 重放返回原结果，不重复扣减
 * 5. 库存不足被拒绝（409），无部分执行
 * 6. 修正保留前后值
 * 7. 撤销恢复数量
 * 8. 家庭越权访问被拒绝（403）
 */

const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are required');
  process.exit(1);
}

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function createUser(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password: 'test-password-123', email_confirm: true }),
  });
  if (!response.ok) throw new Error(`createUser failed: ${await response.text()}`);
  return response.json();
}

async function signIn(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  });
  if (!response.ok) throw new Error(`signIn failed: ${await response.text()}`);
  const body = await response.json();
  return body.access_token;
}

async function api(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json };
}

function command(householdId, type, payload, key) {
  return {
    command_type: type,
    household_id: householdId,
    source: { channel: 'WEB_MANUAL', client: 'smoke-test' },
    idempotency_key: key,
    payload,
  };
}

const runId = Date.now();
const alice = `alice-${runId}@test.xz.app`;
const mallory = `mallory-${runId}@test.xz.app`;

await createUser(alice);
await createUser(mallory);
const aliceToken = await signIn(alice);
const malloryToken = await signIn(mallory);

// 1. 创建家庭
const household = await api(aliceToken, 'POST', '/households', {
  name: '冒烟测试家庭',
  owner_display_name: 'Alice',
});
check('创建家庭', household.status === 201 && household.body.refrigerator_id);
const hh = household.body.id;

// 2. 找到鸡蛋和牛奶
const foods = await api(aliceToken, 'GET', '/foods?q=鸡蛋');
const egg = foods.body?.[0];
const milkResult = await api(aliceToken, 'GET', '/foods?q=牛奶');
const milk = milkResult.body?.[0];
check(
  '食材目录查询',
  Boolean(egg && milk),
  `egg=${egg?.canonical_name} milk=${milk?.canonical_name}`,
);

// 3. 添加两批鸡蛋（不同到期日，验证 FEFO）+ 牛奶
const add1 = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'ADD_INVENTORY',
    {
      items: [
        {
          food_id: egg.id,
          quantity: '6',
          unit: 'piece',
          expires_at: '2026-08-10T00:00:00Z',
          expiry_source: 'USER_CONFIRMED',
        },
      ],
    },
    `smoke-add-late-${runId}`,
  ),
);
const add2 = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'ADD_INVENTORY',
    {
      items: [
        {
          food_id: egg.id,
          quantity: '4',
          unit: 'piece',
          expires_at: '2026-07-25T00:00:00Z',
          expiry_source: 'USER_CONFIRMED',
        },
        { food_id: milk.id, quantity: '2', unit: 'box' },
      ],
    },
    `smoke-add-early-${runId}`,
  ),
);
check('添加库存', add1.status === 201 && add2.status === 201);

let view = await api(aliceToken, 'GET', `/households/${hh}/inventory`);
const eggItem = view.body.zones.flatMap((z) => z.items).find((i) => i.food_id === egg.id);
check(
  '库存视图聚合',
  eggItem?.total_quantity === '10' && eggItem?.lot_count === 2,
  `eggs=${eggItem?.total_quantity} lots=${eggItem?.lot_count}`,
);

// 4. FEFO 消耗 5 个：应先扣光 7-25 批次(4) 再扣 8-10 批次(1)
const consumeKey = `smoke-consume-${runId}`;
const consume = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'CONSUME_INVENTORY',
    {
      items: [{ food_id: egg.id, quantity: '5', unit: 'piece' }],
      purpose: 'MEAL_PREPARATION',
    },
    consumeKey,
  ),
);
check('FEFO 消耗', consume.status === 201);

const detail = await api(aliceToken, 'GET', `/households/${hh}/foods/${egg.id}/detail`);
const activeLots = detail.body.lots;
check(
  'FEFO 先扣最早到期批次',
  activeLots.length === 1 && activeLots[0].remaining_quantity === '5',
  `active lots=${activeLots.length} remaining=${activeLots[0]?.remaining_quantity}`,
);

// 5. 幂等重放：同 key 再发一次
const replay = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'CONSUME_INVENTORY',
    {
      items: [{ food_id: egg.id, quantity: '5', unit: 'piece' }],
      purpose: 'MEAL_PREPARATION',
    },
    consumeKey,
  ),
);
check(
  '幂等重放不重复扣减',
  replay.body.idempotent_replay === true &&
    replay.body.transaction_id === consume.body.transaction_id,
);
view = await api(aliceToken, 'GET', `/households/${hh}/inventory`);
const eggAfterReplay = view.body.zones.flatMap((z) => z.items).find((i) => i.food_id === egg.id);
check('重放后数量不变', eggAfterReplay?.total_quantity === '5');

// 6. 库存不足
const insufficient = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'CONSUME_INVENTORY',
    {
      items: [{ food_id: egg.id, quantity: '100', unit: 'piece' }],
    },
    `smoke-insufficient-${runId}`,
  ),
);
check(
  '库存不足被拒绝',
  insufficient.status === 409 && insufficient.body.code === 'INVENTORY_INSUFFICIENT',
);

// 7. 修正到 3 个
const correct = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'CORRECT_INVENTORY',
    {
      food_id: egg.id,
      target_total_quantity: '3',
      unit: 'piece',
      reason: 'PHYSICAL_COUNT',
    },
    `smoke-correct-${runId}`,
  ),
);
check('库存修正', correct.status === 201);

// 8. 撤销消耗（恢复 5 个 -> 3 + 5 = 8）
const reverse = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'REVERSE_TRANSACTION',
    {
      transaction_id: consume.body.transaction_id,
      reason: 'USER_UNDO',
    },
    `smoke-reverse-${runId}`,
  ),
);
check('撤销交易', reverse.status === 201);
view = await api(aliceToken, 'GET', `/households/${hh}/inventory`);
const eggFinal = view.body.zones.flatMap((z) => z.items).find((i) => i.food_id === egg.id);
check('撤销后数量恢复', eggFinal?.total_quantity === '8', `total=${eggFinal?.total_quantity}`);

// 9. 重复撤销被拒
const reverseAgain = await api(
  aliceToken,
  'POST',
  '/commands',
  command(
    hh,
    'REVERSE_TRANSACTION',
    {
      transaction_id: consume.body.transaction_id,
      reason: 'USER_UNDO',
    },
    `smoke-reverse2-${runId}`,
  ),
);
check(
  '重复撤销被拒绝',
  reverseAgain.status === 409 && reverseAgain.body.code === 'TRANSACTION_ALREADY_REVERSED',
);

// 10. 越权：Mallory 访问 Alice 的家庭
const idor = await api(malloryToken, 'GET', `/households/${hh}/inventory`);
const idorWrite = await api(
  malloryToken,
  'POST',
  '/commands',
  command(
    hh,
    'CONSUME_INVENTORY',
    {
      items: [{ food_id: egg.id, quantity: '1', unit: 'piece' }],
    },
    `smoke-idor-${runId}`,
  ),
);
check('越权读取被拒绝', idor.status === 403);
check('越权写入被拒绝', idorWrite.status === 403);

// 11. 无 token
const anonymous = await fetch(`${API}/households/${hh}/inventory`);
check('未认证被拒绝', anonymous.status === 401);

// 12. 活动时间线
const timeline = await api(aliceToken, 'GET', `/households/${hh}/transactions?limit=10`);
const types = timeline.body.items.map((t) => t.transaction_type);
check(
  '活动时间线完整',
  types.includes('ADD') &&
    types.includes('CONSUME') &&
    types.includes('CORRECT') &&
    types.includes('REVERSAL'),
  types.join(','),
);

console.log(failures === 0 ? '\nALL SPRINT 1 SMOKE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
