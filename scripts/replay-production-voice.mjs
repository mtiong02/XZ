/**
 * 线上真实对话回放诊断（只读式探查，不写入回归基线）。
 * 用真实 seed 目录，复现 07/22-23 用户对话里最棘手的语句，报告当前行为。
 * 目的：找出「同事已改了一轮之后仍然失败」的语音问题，指导下一步优化。
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

const run = Date.now();
await mkUser(`replay-${run}@test.xz.app`);
TOK = await signIn(`replay-${run}@test.xz.app`);
HH = (await api('POST', '/households', { name: '回放', owner_display_name: '测试' })).body.id;

// 预置库存以复现消耗类对话
const chicken = await foodId('鸡胸肉');
const yogurt = await foodId('酸奶');
await cmd(
  'ADD_INVENTORY',
  { items: [{ food_id: chicken, quantity: '250', unit: 'g' }] },
  `s-c-${run}`,
);
await cmd(
  'ADD_INVENTORY',
  { items: [{ food_id: yogurt, quantity: '2', unit: 'box' }] },
  `s-y-${run}`,
);

console.log('\n===== 段1: 同食材幽灵拆分 =====');
{
  const j = await say('鸡胸肉已经被我吃完了用掉两百五十克鸡胸肉');
  const items = j.body.candidate_command?.payload?.items ?? [];
  check(
    '“用掉250克鸡胸肉”只产出1条250克（无幽灵1克）',
    items.length === 1 && items[0]?.quantity === '250',
    `items=${JSON.stringify(items.map((i) => `${i.quantity}${i.unit}`))} status=${j.body.status}`,
  );
}

console.log('\n===== 段1: 确认词与修正 =====');
{
  const j = await say('用掉一盒酸奶');
  check(
    '“用掉一盒酸奶”进入确认',
    j.body.status === 'AWAITING_CONFIRMATION',
    `status=${j.body.status}`,
  );
  const r = await reply(j.body.voice_job_id, '是的用掉了');
  check(
    '“是的用掉了”被识别为确认并执行',
    r.body.status === 'COMPLETED',
    `status=${r.body.status} prompt=${r.body.spoken_prompt}`,
  );
}
{
  await cmd(
    'ADD_INVENTORY',
    { items: [{ food_id: yogurt, quantity: '2', unit: 'box' }] },
    `s-y2-${run}`,
  );
  const j = await say('用掉两盒酸奶');
  const r = await reply(j.body.voice_job_id, '不是的我只用掉一');
  const items = r.body.candidate_command?.payload?.items ?? [];
  check(
    '“不是的我只用掉一”修正为1（非取消）',
    r.body.status !== 'CANCELLED' && items[0]?.quantity === '1',
    `status=${r.body.status} items=${JSON.stringify(items.map((i) => i.quantity + i.unit))}`,
  );
}

console.log('\n===== 段3: 中文日常单位不逼换算 =====');
for (const text of ['我想添加三斤羊肉', '加一袋香菇']) {
  const j = await say(text);
  const it = j.body.candidate_command?.payload?.items?.[0];
  const prompt = j.body.spoken_prompt ?? '';
  check(
    `“${text}”接受单位不说“请按克记录”`,
    !/按克记录|通常按克|克记录/.test(prompt) && j.body.status === 'AWAITING_CONFIRMATION',
    `status=${j.body.status} unit=${it?.unit} prompt=${prompt}`,
  );
}

console.log('\n===== 段4: 专业食材可入库 =====');
for (const text of ['薏米一盒', '两盒南乳', '石斛一斤', '加一袋五指毛桃']) {
  const j = await say(text);
  const it = j.body.candidate_command?.payload?.items?.[0];
  check(
    `“${text}”识别出食材`,
    j.body.status === 'AWAITING_CONFIRMATION' && it && !String(it.food_id).startsWith('custom_'),
    `status=${j.body.status} food=${it?.display_text ?? it?.food_id} err=${j.body.error_code}`,
  );
}

console.log('\n===== 段7/8: 推荐类意图（不应只回库存清单）=====');
for (const text of [
  '有什么推荐的菜',
  '帮我搭配一下今天晚上的菜',
  '我要一个食谱',
  '我想吃个减脂餐冰箱里有什么可以做',
]) {
  const j = await say(text);
  const ct = j.body.candidate_command?.command_type;
  const prompt = j.body.spoken_prompt ?? '';
  const looksLikeRecommend =
    ct === 'MEAL_RECOMMENDATION' || /推荐|做法|菜谱|食谱|蒸|煮|炖|搭配|这一餐|建议/.test(prompt);
  check(
    `“${text}”走推荐而非“听不懂”`,
    looksLikeRecommend && !/没完全听|没听懂|没有听/.test(prompt),
    `ct=${ct} prompt=${prompt.slice(0, 40)}`,
  );
}

console.log('\n===== 段3: 提醒时间解析 =====');
{
  const j = await say('明天早上九点钟提醒我吃鸡胸肉');
  const prompt = j.body.spoken_prompt ?? '';
  check(
    '“明天早上九点”不落成17:00，且无“提醒你我”病句',
    !/17:00|提醒你我/.test(prompt),
    `prompt=${prompt}`,
  );
}

console.log(`\n===== 汇总: ${pass} PASS / ${fail} FAIL =====`);
process.exit(0);
