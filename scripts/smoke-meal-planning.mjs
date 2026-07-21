const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
let failures = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const email = `meal-${Date.now()}@test.xz.app`;
await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ email, password: 'test-password-123', email_confirm: true }),
});
const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'test-password-123' }),
});
const token = (await signed.json()).access_token;
const api = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const household = (await api('POST', '/households', { name: 'MEAL', owner_display_name: 'A' }))
  .body;
const [beef, potato, bread] = await Promise.all(
  ['牛肉', '土豆', '面包'].map(
    async (name) => (await api('GET', `/foods?q=${encodeURIComponent(name)}`)).body[0],
  ),
);
await api('POST', '/commands', {
  command_type: 'ADD_INVENTORY',
  household_id: household.id,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `meal-stock-${Date.now()}`,
  payload: {
    items: [
      { food_id: beef.id, quantity: '500', unit: 'g' },
      { food_id: potato.id, quantity: '2', unit: 'piece' },
    ],
  },
});
const suggestions = (await api('GET', `/households/${household.id}/meal-suggestions`)).body;
const beefPotato = suggestions.find((item) => item.name === '牛肉炖土豆');
check('库存齐全的菜谱排为可制作', beefPotato?.can_make === true, JSON.stringify(beefPotato));
const tomatoEgg = suggestions.find((item) => item.name === '番茄炒鸡蛋');
const added = (
  await api('POST', `/households/${household.id}/meal-suggestions/${tomatoEgg.id}/add-missing`, {})
).body;
check('菜谱缺料加入购物清单', added.added_count === 2, `count=${added.added_count}`);

let job = (
  await api('POST', '/voice-jobs', {
    household_id: household.id,
    transcript_text: '购物清单加一包面包',
  })
).body;
check(
  '语音添加购物清单需要确认',
  job.status === 'AWAITING_CONFIRMATION' &&
    job.candidate_command?.command_type === 'ADD_SHOPPING_ITEM',
  job.spoken_prompt,
);
job = (await api('POST', `/voice-jobs/${job.voice_job_id}/reply`, { text: '对' })).body;
check(
  '确认后加入而非下单',
  job.status === 'COMPLETED' && job.spoken_prompt.includes('不会自动下单'),
  job.spoken_prompt,
);
const query = (
  await api('POST', '/voice-jobs', {
    household_id: household.id,
    transcript_text: '查看购物清单有什么',
  })
).body;
check(
  '语音查询返回真实清单',
  query.spoken_prompt.includes('面包') && query.spoken_prompt.includes('西红柿'),
  query.spoken_prompt,
);
const list = (await api('GET', `/households/${household.id}/shopping-list`)).body;
const breadItem = list.find((item) => item.food_id === bread.id);
const purchased = (
  await api('POST', `/households/${household.id}/shopping-list/${breadItem.id}/status`, {
    status: 'PURCHASED',
  })
).body;
check('购物项可以标记已购买', purchased.status === 'PURCHASED');

console.log(failures ? `\n${failures} MEAL CHECKS FAILED` : '\nALL MEAL CHECKS PASSED');
process.exit(failures ? 1 : 0);
