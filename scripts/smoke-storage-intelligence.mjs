const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
let failures = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const email = `storage-${Date.now()}@test.xz.app`;
const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ email, password: 'test-password-123', email_confirm: true }),
});
const user = await created.json();
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
const household = (await api('POST', '/households', { name: 'STORAGE', owner_display_name: 'A' }))
  .body;
const inventory = (await api('GET', `/households/${household.id}/inventory`)).body;
const zone = Object.fromEntries(inventory.zones.map((item) => [item.code, item.zone_id]));
const [potato, milk] = await Promise.all(
  ['土豆', '牛奶'].map(
    async (name) => (await api('GET', `/foods?q=${encodeURIComponent(name)}`)).body[0],
  ),
);
const add = (food, suffix, storage_zone_id) =>
  api('POST', '/commands', {
    command_type: 'ADD_INVENTORY',
    household_id: household.id,
    source: { channel: 'WEB_MANUAL' },
    idempotency_key: `storage-${suffix}-${Date.now()}`,
    payload: {
      items: [
        {
          food_id: food.id,
          quantity: '1',
          unit: food.default_unit_code,
          ...(storage_zone_id ? { storage_zone_id } : {}),
        },
      ],
    },
  });

await add(potato, 'potato-default');
let view = (await api('GET', `/households/${household.id}/inventory`)).body;
check(
  '土豆自动进入常温区',
  view.zones
    .find((item) => item.code === 'PANTRY')
    .items.some((item) => item.food_id === potato.id),
);
await add(potato, 'potato-fridge', zone.FRIDGE);
let audit = (await api('GET', `/households/${household.id}/inventory/storage-audit`)).body;
const potatoAdvice = audit.find((item) => item.food_id === potato.id);
check(
  '存量冷藏土豆产生科学存放建议',
  potatoAdvice?.recommended_zone_name === '常温区' && potatoAdvice?.suitability === 'ACCEPTABLE',
);
const moved = await api('POST', '/commands', {
  command_type: 'MOVE_INVENTORY',
  household_id: household.id,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `storage-move-${Date.now()}`,
  payload: {
    lot_ids: potatoAdvice.lot_ids,
    target_storage_zone_id: potatoAdvice.recommended_zone_id,
    reason: 'STORAGE_RECOMMENDATION',
  },
});
check('确认后移动库存批次', moved.status === 201, JSON.stringify(moved.body));
audit = (await api('GET', `/households/${household.id}/inventory/storage-audit`)).body;
check('移动后建议消失', !audit.some((item) => item.food_id === potato.id));
const reversed = await api('POST', '/commands', {
  command_type: 'REVERSE_TRANSACTION',
  household_id: household.id,
  source: { channel: 'WEB_MANUAL' },
  idempotency_key: `storage-reverse-${Date.now()}`,
  payload: { transaction_id: moved.body.transaction_id, reason: 'USER_UNDO' },
});
check('区域移动可以撤销', reversed.status === 201, JSON.stringify(reversed.body));
const frozenPotato = await add(potato, 'potato-freezer', zone.FREEZER);
check(
  '禁止完整生土豆直接冷冻',
  frozenPotato.status === 400 && frozenPotato.body?.code === 'FOOD_STORAGE_ZONE_PROHIBITED',
);
await add(milk, 'milk-default');
view = (await api('GET', `/households/${household.id}/inventory`)).body;
check(
  '鲜奶默认进入冷藏室',
  view.zones.find((item) => item.code === 'FRIDGE').items.some((item) => item.food_id === milk.id),
);
const pantryMilk = await add(milk, 'milk-pantry', zone.PANTRY);
check(
  '需冷藏牛奶不能放常温区',
  pantryMilk.status === 400 && pantryMilk.body?.code === 'FOOD_STORAGE_ZONE_PROHIBITED',
);

await api('DELETE', `/households/${household.id}`);
await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
  method: 'DELETE',
  headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
});
console.log(failures ? `\n${failures} STORAGE CHECKS FAILED` : '\nALL STORAGE CHECKS PASSED');
process.exit(failures ? 1 : 0);
