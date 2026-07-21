/**
 * 多轮语音对话集成冒烟。模拟"识别 -> 系统播报确认 -> 用户语音回应"的完整回合。
 * 验证：
 * 1. 确认流：说"加两盒牛奶" -> 系统播报确认 -> 回"对" -> 执行入库
 * 2. 修正流：说"加两盒牛奶" -> 回"不是两盒是三盒" -> 系统改成三盒重新确认 -> 回"对" -> 入 3 盒
 * 3. 追问流：说"加牛奶"(没说数量) -> 系统追问"多少" -> 回"两盒" -> 确认 -> 回"对" -> 入库
 * 4. 拒绝流：说"加牛奶两盒" -> 回"不对" -> 取消，不入库
 * 5. 食材修正：说"用两个鸡蛋" -> 回"是三个鸡蛋" -> 改 3 -> 确认执行
 * 6. 系统每轮都产出 spoken_prompt（供 TTS 播报），且对话回合被记录
 */

const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
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
let token;
async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const say = (hh, text) => api('POST', '/voice-jobs', { household_id: hh, transcript_text: text });
const reply = (id, text) => api('POST', `/voice-jobs/${id}/reply`, { text });

const runId = Date.now();
const email = `dlg-${runId}@test.xz.app`;
await createUser(email);
token = await signIn(email);
const hh = (await api('POST', '/households', { name: 'DLG', owner_display_name: 'A' })).body.id;
const milk = (await api('GET', '/foods?q=牛奶')).body[0];
const egg = (await api('GET', '/foods?q=鸡蛋')).body[0];
const pork = (await api('GET', '/foods?q=猪肉')).body[0];
const qty = (inv, id) =>
  Number(inv.zones.flatMap((z) => z.items).find((i) => i.food_id === id)?.total_quantity ?? '0');

// ---- 1. 确认流 ----
let job = (await say(hh, '加两盒牛奶')).body;
check('1a 识别后进入确认状态', job.status === 'AWAITING_CONFIRMATION', `status=${job.status}`);
check(
  '1b 系统给出播报文案(供TTS)',
  typeof job.spoken_prompt === 'string' && job.spoken_prompt.includes('对吗'),
  job.spoken_prompt,
);
let done = (await reply(job.voice_job_id, '对')).body;
// 回复必须返回"呈现后的任务"：含 COMPLETED 状态 + 已执行交易 + 执行播报（前端据此判终态）
check(
  '1c 回"对"后返回 COMPLETED 任务',
  done.status === 'COMPLETED' && done.executed_transaction_id && done.spoken_prompt?.includes('已'),
  `status=${done.status} txn=${done.executed_transaction_id}`,
);
let inv = (await api('GET', `/households/${hh}/inventory`)).body;
check('1d 牛奶入库 2 盒', qty(inv, milk.id) === 2, `qty=${qty(inv, milk.id)}`);

// ---- 2. 修正流 "不是两盒是三盒" ----
job = (await say(hh, '加两盒牛奶')).body;
let step = (await reply(job.voice_job_id, '不是两盒是三盒')).body;
check('2a 修正后仍在确认态', step.status === 'AWAITING_CONFIRMATION', `status=${step.status}`);
check(
  '2b 播报改成三盒',
  step.spoken_prompt.includes('3') || step.spoken_prompt.includes('三'),
  step.spoken_prompt,
);
check(
  '2c 候选数量已改为 3',
  step.candidate_command?.payload?.items?.[0]?.quantity === '3',
  `q=${step.candidate_command?.payload?.items?.[0]?.quantity}`,
);
await reply(job.voice_job_id, '对');
inv = (await api('GET', `/households/${hh}/inventory`)).body;
check('2d 牛奶累计 5 盒(2+3)', qty(inv, milk.id) === 5, `qty=${qty(inv, milk.id)}`);

// ---- 3. 追问流 "加牛奶"(缺数量) ----
job = (await say(hh, '加牛奶')).body;
check('3a 缺数量进入追问态', job.status === 'AWAITING_CLARIFICATION', `status=${job.status}`);
check('3b 追问文案含"多少"', job.spoken_prompt.includes('多少'), job.spoken_prompt);
step = (await reply(job.voice_job_id, '两盒')).body;
check('3c 补数量后转确认', step.status === 'AWAITING_CONFIRMATION', `status=${step.status}`);
await reply(job.voice_job_id, '对');
inv = (await api('GET', `/households/${hh}/inventory`)).body;
check('3d 牛奶累计 7 盒(5+2)', qty(inv, milk.id) === 7, `qty=${qty(inv, milk.id)}`);

// ---- 4. 拒绝流 ----
job = (await say(hh, '加两盒牛奶')).body;
step = (await reply(job.voice_job_id, '不对')).body;
check('4a 回"不对"取消', step.status === 'CANCELLED', `status=${step.status}`);
check('4b 取消播报', step.spoken_prompt.includes('取消'), step.spoken_prompt);
inv = (await api('GET', `/households/${hh}/inventory`)).body;
check('4c 拒绝后牛奶仍是 7 盒', qty(inv, milk.id) === 7, `qty=${qty(inv, milk.id)}`);

// ---- 5. 食材+数量修正 "是三个鸡蛋" ----
await api('POST', '/commands', {
  command_type: 'ADD_INVENTORY',
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `dlg-egg-${runId}`,
  payload: { items: [{ food_id: egg.id, quantity: '10', unit: 'piece' }] },
});
job = (await say(hh, '用两个鸡蛋')).body;
step = (await reply(job.voice_job_id, '是三个鸡蛋')).body;
check(
  '5a 食材修正数量为 3',
  step.candidate_command?.payload?.items?.[0]?.quantity === '3',
  `q=${step.candidate_command?.payload?.items?.[0]?.quantity}`,
);
await reply(job.voice_job_id, '对');
inv = (await api('GET', `/households/${hh}/inventory`)).body;
check('5b 鸡蛋 10-3=7', qty(inv, egg.id) === 7, `qty=${qty(inv, egg.id)}`);

// ---- 6. 对话回合被记录 ----
const finalJob = (await api('GET', `/voice-jobs/${job.voice_job_id}`)).body;
check(
  '6a 对话回合已记录',
  Array.isArray(finalJob.dialogue_turns) && finalJob.dialogue_turns.length >= 3,
  `turns=${finalJob.dialogue_turns?.length}`,
);
check(
  '6b 含用户与系统两种角色',
  finalJob.dialogue_turns.some((t) => t.role === 'user') &&
    finalJob.dialogue_turns.some((t) => t.role === 'system'),
);

// ---- 7. 提醒独立多轮状态机 + ASR 语境纠错 ----
job = (await say(hh, '明天提醒我吃掉')).body;
check(
  '7a 缺食材时追问食材而非确认或追问库存数量',
  job.status === 'AWAITING_CLARIFICATION' && job.spoken_prompt.includes('哪种食材'),
  `${job.status} ${job.spoken_prompt}`,
);
step = (await reply(job.voice_job_id, '民间中午十二点提醒我吃掉一千克的猪肉')).body;
check(
  '7b ASR 将“民间中午”按提醒语境纠正为明天中午',
  step.status === 'AWAITING_CONFIRMATION' && step.spoken_prompt.includes('12:00'),
  `${step.status} ${step.spoken_prompt}`,
);
check(
  '7c 提醒保留食材与明确数量，不路由成库存扣减',
  step.candidate_command?.command_type === 'CREATE_REMINDER' &&
    step.candidate_command?.payload?.food_id === pork.id &&
    step.candidate_command?.payload?.reminder_text?.includes('1千克猪肉'),
  JSON.stringify(step.candidate_command),
);
await api('POST', `/voice-jobs/${job.voice_job_id}/cancel`, {});

// ---- 8. 提醒中的“一半”按真实库存换算，不能被“可以了”误判为确认 ----
await api('POST', '/commands', {
  command_type: 'ADD_INVENTORY',
  household_id: hh,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `dlg-pork-${runId}`,
  payload: { items: [{ food_id: pork.id, quantity: '1400', unit: 'g' }] },
});
job = (await say(hh, '明天中午十二点提醒我吃掉猪肉')).body;
step = (await reply(job.voice_job_id, '我只要吃掉一半就可以了')).body;
check(
  '8a 后续说“一半”会更新候选而非直接创建提醒',
  step.status === 'AWAITING_CONFIRMATION',
  `${step.status} ${step.spoken_prompt}`,
);
check(
  '8b 猪肉1400克的一半换算为700克',
  step.candidate_command?.payload?.reminder_text === '吃掉700克猪肉' &&
    step.spoken_prompt.includes('700克猪肉'),
  JSON.stringify(step.candidate_command),
);
await api('POST', `/voice-jobs/${job.voice_job_id}/cancel`, {});

// ---- 9. “把原提醒改成”必须更新旧任务，不能再新建一条 ----
job = (await say(hh, '明天中午十二点提醒我把猪肉吃完')).body;
await reply(job.voice_job_id, '对');
let reminders = (await api('GET', `/households/${hh}/notifications/reminders`)).body;
const originalReminder = reminders.find((reminder) => reminder.food_name === '猪肉');
job = (await say(hh, '我明天不是说要提醒我把猪肉吃完吗把它改成只吃一半的猪肉')).body;
check(
  '9a “改成”路由为更新原提醒',
  job.candidate_command?.command_type === 'UPDATE_REMINDER' &&
    job.candidate_command?.payload?.reminder_id === originalReminder?.id,
  JSON.stringify(job.candidate_command),
);
step = (await reply(job.voice_job_id, '不对是明天中午十二点把那个猪肉吃完改成只吃一半的猪肉')).body;
await reply(job.voice_job_id, '对');
reminders = (await api('GET', `/households/${hh}/notifications/reminders`)).body;
const porkReminders = reminders.filter((reminder) => reminder.food_name === '猪肉');
check('9b 修改后仍只有一条猪肉提醒', porkReminders.length === 1, `count=${porkReminders.length}`);
check(
  '9c 原提醒被更新为700克且时间为中午十二点',
  porkReminders[0]?.id === originalReminder?.id &&
    porkReminders[0]?.reminder_text === '吃掉700克猪肉' &&
    new Date(porkReminders[0]?.scheduled_for).toISOString().includes('T04:00:00.000Z'),
  JSON.stringify(porkReminders[0]),
);

console.log(failures === 0 ? '\nALL DIALOGUE SMOKE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
