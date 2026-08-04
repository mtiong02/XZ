/**
 * 多轮语音对话回放（07/22-23 线上会话里的推荐类多轮场景）。
 * 复现：追问人数后死循环、推荐后"我想改一下"丢上下文、修正人数等。
 */
const API = 'http://localhost:3001/api/v1';
const SU = 'http://127.0.0.1:54321';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
let pass = 0,
  fail = 0;
function check(name, cond, detail = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (ok) pass += 1;
  else fail += 1;
}
async function mkUser(email) {
  await fetch(`${SU}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SRK, authorization: `Bearer ${SRK}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123', email_confirm: true }),
  });
}
async function signIn(email) {
  const r = await fetch(`${SU}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  });
  return (await r.json()).access_token;
}
let TOK, HH;
async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOK}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const say = (text) => api('POST', '/voice-jobs', { household_id: HH, transcript_text: text });
const reply = (jobId, text) => api('POST', `/voice-jobs/${jobId}/reply`, { text });
const foodId = async (q) => (await api('GET', `/foods?q=${encodeURIComponent(q)}`)).body?.[0]?.id;
const cmd = (type, payload, key) =>
  api('POST', '/commands', {
    command_type: type,
    household_id: HH,
    source: { channel: 'WEB_MANUAL' },
    idempotency_key: key,
    payload,
  });
const notReask = (p) => !/几个人吃|多少人|请告诉我今天几个人/.test(p ?? '');
const notLost = (p) => !/没完全听|没听懂|没有听明白|这句没有听|请把动作/.test(p ?? '');

const run = Date.now();
await mkUser(`mt-${run}@test.xz.app`);
TOK = await signIn(`mt-${run}@test.xz.app`);
HH = (await api('POST', '/households', { name: '多轮', owner_display_name: 't' })).body.id;
// 预置较丰富的库存以便推荐
for (const [q, unit, name] of [
  ['鸡胸肉', 'g', '250'],
  ['西红柿', 'piece', '5'],
  ['鸡蛋', 'piece', '6'],
  ['牛肉', 'g', '500'],
  ['酸奶', 'box', '2'],
  ['苹果', 'piece', '3'],
]) {
  const fid = await foodId(q);
  if (fid)
    await cmd(
      'ADD_INVENTORY',
      { items: [{ food_id: fid, quantity: name, unit }] },
      `s-${q}-${run}`,
    );
}

console.log('\n===== 段2: 追问人数 -> 裸数字回答不应死循环 =====');
{
  let j = await say('今天晚上想吃点什么你帮我推荐一下');
  check(
    '推荐请求进入澄清或直接给建议',
    j.body.status === 'AWAITING_CLARIFICATION' || j.body.status === 'COMPLETED',
    `status=${j.body.status} prompt=${(j.body.spoken_prompt ?? '').slice(0, 30)}`,
  );
  if (j.body.status === 'AWAITING_CLARIFICATION') {
    const r = await reply(j.body.voice_job_id, '两个');
    check(
      '回答“两个”后不再重复追问人数（推进到偏好或直接推荐）',
      notReask(r.body.spoken_prompt) && notLost(r.body.spoken_prompt),
      `status=${r.body.status} prompt=${(r.body.spoken_prompt ?? '').slice(0, 50)}`,
    );
    // 再答偏好后应给出真实推荐
    const r2 = await reply(r.body.voice_job_id, '清淡一点');
    check(
      '答完人数+偏好后给出真实推荐',
      /推荐|做法|蒸|煮|炖|这一餐|建议|不会自动扣减/.test(r2.body.spoken_prompt ?? '') &&
        notReask(r2.body.spoken_prompt),
      `status=${r2.body.status} prompt=${(r2.body.spoken_prompt ?? '').slice(0, 50)}`,
    );
  }
}

console.log('\n===== 段2/3: 推荐后“我想改一下”不应丢上下文 =====');
{
  let j = await say('晚餐四个人吃，按冰箱食材给我推荐');
  // 若还在澄清，补齐偏好
  if (j.body.status === 'AWAITING_CLARIFICATION') j = await reply(j.body.voice_job_id, '清淡一点');
  const r = await reply(j.body.voice_job_id ?? j.body.voice_job_id, '我想改一下');
  check(
    '“我想改一下”被理解为换一个推荐，而非听不懂',
    notLost(r.body.spoken_prompt),
    `status=${r.body.status} prompt=${(r.body.spoken_prompt ?? '').slice(0, 50)}`,
  );
}

console.log('\n===== 段3: 推荐后细化“我想要能量满满的早餐” =====');
{
  let j = await say('帮我推荐一个明天的早餐');
  if (j.body.status === 'AWAITING_CLARIFICATION') j = await reply(j.body.voice_job_id, '两个人');
  const r = await reply(j.body.voice_job_id, '我想要一个能量满满的早餐');
  check(
    '细化偏好不丢上下文',
    notLost(r.body.spoken_prompt),
    `status=${r.body.status} prompt=${(r.body.spoken_prompt ?? '').slice(0, 50)}`,
  );
}

console.log('\n===== 段8: “继续刚才的食谱” =====');
{
  let j = await say('晚上一个人吃，推荐个减脂餐');
  if (j.body.status === 'AWAITING_CLARIFICATION') j = await reply(j.body.voice_job_id, '清淡少油');
  const r = await reply(j.body.voice_job_id, '继续刚才的食谱');
  check(
    '“继续刚才的食谱”不判为听不懂',
    notLost(r.body.spoken_prompt),
    `status=${r.body.status} prompt=${(r.body.spoken_prompt ?? '').slice(0, 50)}`,
  );
}

console.log(`\n===== 汇总: ${pass} PASS / ${fail} FAIL =====`);
process.exit(0);
