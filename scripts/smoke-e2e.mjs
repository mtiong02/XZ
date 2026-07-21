/**
 * Sprint 6 端到端 + 安全冒烟（docs/04 Sprint 6、docs/05 §2.5/§5）。
 *
 * 主旅程（docs/05 §2.5）：
 *   登录 -> 建家庭 -> 手动添加鸡蛋 -> 语音使用两个鸡蛋 -> 确认
 *   -> 第二"终端"（另一 token）看到更新 -> 撤销 -> 数量恢复
 *
 * 安全（docs/05 §5）：
 *   IDOR、未认证、幂等重放、限流、Prompt injection、数据导出、Owner-only 删除、
 *   敏感日志（不含原始音频/token）。
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
    headers: token
      ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
      : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const eggQty = (inv, foodId) =>
  Number(
    inv.zones.flatMap((z) => z.items).find((i) => i.food_id === foodId)?.total_quantity ?? '0',
  );

const runId = Date.now();
const alice = `e2e-alice-${runId}@test.xz.app`;
const mallory = `e2e-mallory-${runId}@test.xz.app`;
await createUser(alice);
await createUser(mallory);
const t1 = await signIn(alice); // 终端 1
const t2 = await signIn(alice); // 终端 2（同一用户，另一 session）
const mal = await signIn(mallory);

// --- 主旅程 ---
const hh = (await api(t1, 'POST', '/households', { name: 'E2E', owner_display_name: 'Alice' })).body
  .id;
const egg = (await api(t1, 'GET', '/foods?q=鸡蛋')).body[0];

const add = await api(t1, 'POST', '/commands', {
  command_type: 'ADD_INVENTORY',
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `e2e-add-${runId}`,
  payload: { items: [{ food_id: egg.id, quantity: '10', unit: 'piece' }] },
});
check('手动添加鸡蛋', add.status === 201);

// 语音使用两个鸡蛋
const voice = await api(t1, 'POST', '/voice-jobs', {
  household_id: hh,
  transcript_text: '用了两个鸡蛋',
});
check('语音解析为使用', voice.body.candidate_command?.command_type === 'CONSUME_INVENTORY');
const confirm = await api(t1, 'POST', `/voice-jobs/${voice.body.voice_job_id}/confirm`, {});
check('确认执行语音命令', confirm.status === 201);

// 第二终端看到更新
const inv2 = await api(t2, 'GET', `/households/${hh}/inventory`);
check(
  '第二终端看到扣减后库存 (8)',
  eggQty(inv2.body, egg.id) === 8,
  `qty=${eggQty(inv2.body, egg.id)}`,
);

// 撤销 -> 恢复
const undo = await api(t1, 'POST', '/commands', {
  command_type: 'REVERSE_TRANSACTION',
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `e2e-undo-${runId}`,
  payload: { transaction_id: confirm.body.transaction_id, reason: 'USER_UNDO' },
});
check('撤销语音消耗', undo.status === 201);
const inv3 = await api(t1, 'GET', `/households/${hh}/inventory`);
check('撤销后数量恢复 (10)', eggQty(inv3.body, egg.id) === 10, `qty=${eggQty(inv3.body, egg.id)}`);

// --- 安全 ---
// IDOR
check('越权读取被拒', (await api(mal, 'GET', `/households/${hh}/inventory`)).status === 403);
check('越权导出被拒', (await api(mal, 'GET', `/households/${hh}/export`)).status === 403);
check('越权删除被拒', (await api(mal, 'DELETE', `/households/${hh}`)).status === 403);
// 未认证
check('未认证被拒', (await api(null, 'GET', `/households/${hh}/inventory`)).status === 401);
// 幂等重放
const replay = await api(t1, 'POST', '/commands', {
  command_type: 'ADD_INVENTORY',
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `e2e-add-${runId}`,
  payload: { items: [{ food_id: egg.id, quantity: '10', unit: 'piece' }] },
});
check('幂等重放返回原结果', replay.body.idempotent_replay === true);

// 数据导出（内容 + 无原始音频）
const exp = await api(t1, 'GET', `/households/${hh}/export`);
check('数据导出可用', exp.status === 200 && Array.isArray(exp.body.transactions));
check(
  '导出不含原始音频字段',
  !JSON.stringify(exp.body).includes('audio_data') && !JSON.stringify(exp.body).includes('"audio"'),
);

// 限流：快速触发 40 次写，应出现 429
let got429 = false;
for (let i = 0; i < 40; i += 1) {
  const r = await api(t1, 'POST', '/commands', {
    command_type: 'ADD_INVENTORY',
    household_id: hh,
    source: { channel: 'WEB_MANUAL' },
    idempotency_key: `e2e-rate-${runId}-${i}`,
    payload: { items: [{ food_id: egg.id, quantity: '1', unit: 'piece' }] },
  });
  if (r.status === 429) {
    got429 = true;
    break;
  }
}
check('写操作限流生效 (429)', got429);

// Owner-only 删除（Alice 是 owner，可删）——放最后，删除测试家庭
const del = await api(t1, 'DELETE', `/households/${hh}`);
check('Owner 删除家庭成功', del.status === 200 && del.body.deleted === true);
const afterDelete = await api(t1, 'GET', `/households/${hh}/inventory`);
check('删除后数据不可访问', afterDelete.status === 403 || afterDelete.status === 404);

console.log(failures === 0 ? '\nALL E2E + SECURITY CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
