const API = process.env.API_BASE ?? 'http://localhost:3001/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
let failures = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const email = `wellness-${Date.now()}@test.xz.app`;
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
const household = (await api('POST', '/households', { name: 'WELLNESS', owner_display_name: 'A' }))
  .body;
const profile = (
  await api('POST', `/households/${household.id}/wellness/me/profile`, {
    birth_year: 1990,
    height_cm: 170,
    goal: 'WEIGHT_MANAGEMENT',
    allergen_codes: ['FISH'],
    dietary_restrictions: [],
    health_considerations: [],
    share_with_household: false,
  })
).body;
check(
  '个人健康档案可保存',
  profile.goal === 'WEIGHT_MANAGEMENT' && profile.share_with_household === false,
);
await api('POST', `/households/${household.id}/wellness/me/weight`, {
  weight_kg: 70,
  measured_at: '2026-07-01T08:00:00.000Z',
});
await api('POST', `/households/${household.id}/wellness/me/weight`, {
  weight_kg: 69.2,
  measured_at: '2026-07-21T08:00:00.000Z',
});
const trend = (await api('GET', `/households/${household.id}/wellness/me/weight`)).body;
check(
  '体重趋势基于真实记录',
  trend.latest_kg === 69.2 && trend.change_kg === -0.8,
  JSON.stringify(trend),
);
const meals = (await api('GET', `/households/${household.id}/wellness/me/meal-suggestions`)).body;
check(
  '鱼类过敏原强制排除菜谱',
  !meals.suggestions.some((item) => item.name === '清蒸鲈鱼') &&
    meals.excluded_for_allergens.some((item) => item.name === '清蒸鲈鱼'),
);
check(
  '接口明确说明非医疗结论',
  meals.limitations.some((item) => item.includes('不构成诊断')),
);
const missing = await api(
  'GET',
  '/households/00000000-0000-0000-0000-000000000001/wellness/me/profile',
);
check(
  '非成员不能访问其他家庭',
  missing.status === 404 || missing.status === 403,
  `status=${missing.status}`,
);
console.log(failures ? `\n${failures} WELLNESS CHECKS FAILED` : '\nALL WELLNESS CHECKS PASSED');
process.exit(failures ? 1 : 0);
