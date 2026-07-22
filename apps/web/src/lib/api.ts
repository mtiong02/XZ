'use client';

import type { CommandResult, InventoryView } from '@xz/contracts';
import { getSupabase } from './supabase';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export interface ProblemDetails {
  title: string;
  status: number;
  code: string;
  detail: string;
  trace_id: string;
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
  }
}

async function responseBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const request = async () => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(await authHeaders())) headers.set(name, value);
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  try {
    return await request();
  } catch (error) {
    // Development hot reload and brief service restarts can leave the API port unavailable.
    // Retry network failures once; HTTP errors still return immediately and are never hidden.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return request().catch(() => Promise.reject(error));
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path);
  if (!response.ok) throw new ApiError(await responseBody<ProblemDetails>(response));
  return responseBody<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(await responseBody<ProblemDetails>(response));
  return responseBody<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path, { method: 'DELETE' });
  if (!response.ok) throw new ApiError(await responseBody<ProblemDetails>(response));
  return responseBody<T>(response);
}

// ---- typed helpers ----

export interface HouseholdSummary {
  id: string;
  name: string;
  timezone: string;
  role: 'OWNER' | 'MEMBER';
  member_id: string;
  refrigerator_id: string;
}

export interface FoodSummary {
  id: string;
  canonical_name: string;
  category: string;
  default_unit_code: string;
  preferred_unit_codes: string[];
  default_shelf_life_days: number | null;
  aliases: string[];
  category_code?: string;
  category_path?: string[];
  is_custom?: boolean;
  data_source?: string;
  source_reference?: string | null;
  allergen_codes?: string[];
  review_status?: 'CURATED' | 'VERIFIED' | 'HOUSEHOLD';
}

export interface FoodCategorySummary {
  code: string;
  parent_code: string | null;
  name_zh: string;
  name_path: string[];
}

export interface UnitSummary {
  code: string;
  name_zh: string;
  kind: 'COUNT' | 'MASS' | 'VOLUME';
}

export type CommandType =
  | 'ADD_INVENTORY'
  | 'CONSUME_INVENTORY'
  | 'DISCARD_INVENTORY'
  | 'CORRECT_INVENTORY'
  | 'MOVE_INVENTORY'
  | 'REVERSE_TRANSACTION';

/** 所有写操作走统一命令通道，客户端生成幂等 key（FR-017）。 */
export async function executeCommand(
  householdId: string,
  commandType: CommandType,
  payload: unknown,
): Promise<CommandResult> {
  return apiPost<CommandResult>('/commands', {
    command_type: commandType,
    household_id: householdId,
    source: { channel: 'WEB_MANUAL', client: 'pwa' },
    idempotency_key: `web-${crypto.randomUUID()}`,
    payload,
  });
}

export function fetchInventory(householdId: string): Promise<InventoryView> {
  return apiGet<InventoryView>(`/households/${householdId}/inventory`);
}

export interface StorageAuditItem {
  food_id: string;
  food_name: string;
  current_zone_id: string;
  current_zone_code: string;
  current_zone_name: string;
  recommended_zone_id: string;
  recommended_zone_name: string;
  suitability: 'ACCEPTABLE' | 'NOT_RECOMMENDED' | 'PROHIBITED' | 'UNKNOWN';
  condition_note: string;
  source_reference: string;
  lot_ids: string[];
  quantity: string;
  unit: string;
}

export function fetchStorageAudit(householdId: string): Promise<StorageAuditItem[]> {
  return apiGet(`/households/${householdId}/inventory/storage-audit`);
}

export interface WeeklyStats {
  window_days: number;
  consumed_quantity: string;
  consumed_count: number;
  discarded_quantity: string;
  discarded_count: number;
  added_count: number;
  active_items: number;
  expiring_count: number;
  expired_count: number;
  expiry_handled_rate: number | null;
}

export function fetchWeeklyStats(householdId: string): Promise<WeeklyStats> {
  return apiGet<WeeklyStats>(`/households/${householdId}/stats`);
}

export interface NotificationView {
  id: string;
  notification_type: 'EXPIRING' | 'EXPIRED' | 'DAILY_SUMMARY' | 'RESTOCK';
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'UNREAD' | 'READ' | 'SNOOZED' | 'ACTIONED';
  metadata: Record<string, unknown>;
  available_at: string;
  snoozed_until: string | null;
}
export function fetchNotifications(householdId: string): Promise<NotificationView[]> {
  return apiGet(`/households/${householdId}/notifications`);
}
export function actOnNotification(
  householdId: string,
  notificationId: string,
  action: 'READ' | 'SNOOZE' | 'ACTIONED',
) {
  return apiPost(`/households/${householdId}/notifications/${notificationId}/action`, {
    action,
    idempotency_key: `notification-${crypto.randomUUID()}`,
  });
}
export interface ReminderTaskView {
  id: string;
  reminder_text: string;
  scheduled_for: string;
  status: string;
  food_name: string | null;
}
export interface ReminderPreferences {
  daily_briefing_enabled: boolean;
  daily_briefing_time: string;
  voice_enabled: boolean;
  expiry_days: number;
  quiet_start: string;
  quiet_end: string;
}
export interface DailyBriefing {
  text: string;
  should_speak: boolean;
  preferences: ReminderPreferences;
  urgent: NotificationView[];
  tasks: ReminderTaskView[];
}
export function fetchReminderTasks(householdId: string): Promise<ReminderTaskView[]> {
  return apiGet(`/households/${householdId}/notifications/reminders`);
}
export function cancelReminder(householdId: string, reminderId: string) {
  return apiDelete(`/households/${householdId}/notifications/reminders/${reminderId}`);
}
export function fetchDailyBriefing(householdId: string): Promise<DailyBriefing> {
  return apiGet(`/households/${householdId}/notifications/daily-briefing`);
}
export function fetchReminderPreferences(householdId: string): Promise<ReminderPreferences> {
  return apiGet(`/households/${householdId}/notifications/preferences`);
}
export function updateReminderPreferences(
  householdId: string,
  input: ReminderPreferences,
): Promise<ReminderPreferences> {
  return apiPost(`/households/${householdId}/notifications/preferences`, input);
}

export type NutritionGroupCode =
  | 'PROTEIN'
  | 'VEGETABLE'
  | 'FRUIT'
  | 'STAPLE'
  | 'DAIRY'
  | 'LEGUME'
  | 'HEALTHY_FAT'
  | 'SEAFOOD'
  | 'SEASONING'
  | 'OTHER';
export interface NutritionGroupView {
  code: NutritionGroupCode;
  label: string;
  present: boolean;
  food_count: number;
  foods: string[];
}
export interface NutritionObservationView {
  code: string;
  severity: 'POSITIVE' | 'ATTENTION' | 'INFO';
  title: string;
  detail: string;
  evidence_foods: string[];
}
export interface NutritionStructureView {
  household_id: string;
  generated_at: string;
  inventory_food_count: number;
  groups: NutritionGroupView[];
  observations: NutritionObservationView[];
  evidence: {
    inventory_revision: number;
    profiled_food_count: number;
    unprofiled_food_count: number;
    profile_completeness: number;
  };
  limitations: string[];
}
export function fetchNutritionStructure(householdId: string): Promise<NutritionStructureView> {
  return apiGet(`/households/${householdId}/nutrition/structure`);
}

export interface MealIngredientView {
  food_id: string;
  food_name: string;
  quantity: string | null;
  unit_code: string | null;
  available: boolean;
  inventory_quantity: string | null;
  inventory_unit: string | null;
  expiry_status: string | null;
  allergen_codes: string[];
}

export type WellnessGoal =
  'GENERAL_WELLNESS' | 'WEIGHT_MANAGEMENT' | 'MUSCLE_SUPPORT' | 'BALANCED_DIET';
export type ActivityLevel = 'LOW' | 'MODERATE' | 'HIGH';
export interface WellnessProfile {
  birth_year: number | null;
  height_cm: number | null;
  goal: WellnessGoal;
  activity_level: ActivityLevel;
  allergen_codes: string[];
  dietary_restrictions: string[];
  health_considerations: string[];
  share_with_household: boolean;
}
interface WellnessProfileResponse extends Omit<WellnessProfile, 'height_cm' | 'activity_level'> {
  height_cm: string | number | null;
  activity_level?: ActivityLevel;
}
export interface WeightTrend {
  entries: Array<{ id: string; value: string; measured_at: string; note: string | null }>;
  latest_kg: number | null;
  change_kg: number | null;
}
export interface PersonalizedMeals {
  goal: WellnessGoal;
  suggestions: MealSuggestionView[];
  excluded_for_allergens: Array<{ id: string; name: string }>;
  limitations: string[];
}
export async function fetchWellnessProfile(householdId: string): Promise<WellnessProfile | null> {
  const profile = await apiGet<WellnessProfileResponse | null>(
    `/households/${householdId}/wellness/me/profile`,
  );
  if (!profile) return null;
  return {
    birth_year: profile.birth_year,
    height_cm: profile.height_cm == null ? null : Number(profile.height_cm),
    goal: profile.goal,
    activity_level: profile.activity_level ?? 'MODERATE',
    allergen_codes: profile.allergen_codes,
    dietary_restrictions: profile.dietary_restrictions,
    health_considerations: profile.health_considerations,
    share_with_household: profile.share_with_household,
  };
}
export function saveWellnessProfile(householdId: string, profile: WellnessProfile) {
  return apiPost<WellnessProfile>(`/households/${householdId}/wellness/me/profile`, {
    birth_year: profile.birth_year,
    height_cm: profile.height_cm == null ? null : Number(profile.height_cm),
    goal: profile.goal,
    activity_level: profile.activity_level,
    allergen_codes: profile.allergen_codes,
    dietary_restrictions: profile.dietary_restrictions,
    health_considerations: profile.health_considerations,
    share_with_household: profile.share_with_household,
  });
}
export function fetchWeightTrend(householdId: string) {
  return apiGet<WeightTrend>(`/households/${householdId}/wellness/me/weight`);
}
export function addWeightEntry(householdId: string, weight_kg: number, measured_at: string) {
  return apiPost(`/households/${householdId}/wellness/me/weight`, { weight_kg, measured_at });
}
export type MeasurementMetric =
  'WEIGHT' | 'WAIST_CIRCUMFERENCE' | 'BODY_FAT_PERCENT' | 'RESTING_HEART_RATE' | 'BLOOD_PRESSURE';
export interface BodyMeasurementEntry {
  id: string;
  metric_type: MeasurementMetric;
  value: number;
  secondary_value: number | null;
  unit_code: string;
  measured_at: string;
  source: 'MANUAL';
  note: string | null;
}
export interface BodyMeasurementTrend {
  metric_type: MeasurementMetric;
  label: string;
  unit: string;
  entries: BodyMeasurementEntry[];
  latest_value: number;
  latest_secondary_value: number | null;
  change: number;
}
export interface BodyMeasurementSummary {
  metrics: BodyMeasurementTrend[];
  derived: {
    bmi: { value: number; measured_at: string; based_on: string[] } | null;
  };
  total_entries: number;
  evidence: {
    source: 'USER_RECORDED';
    profile_height_available: boolean;
    measurement_count: number;
  };
  limitations: string[];
}
export function fetchBodyMeasurements(householdId: string) {
  return apiGet<BodyMeasurementSummary>(`/households/${householdId}/wellness/me/measurements`);
}
export function addBodyMeasurement(
  householdId: string,
  input: {
    metric_type: MeasurementMetric;
    value: number;
    secondary_value?: number;
    measured_at: string;
    note?: string;
  },
) {
  return apiPost<BodyMeasurementEntry>(
    `/households/${householdId}/wellness/me/measurements`,
    input,
  );
}
export function deleteBodyMeasurement(householdId: string, measurementId: string) {
  return apiDelete<{ deleted: boolean }>(
    `/households/${householdId}/wellness/me/measurements/${measurementId}`,
  );
}
export function fetchPersonalizedMeals(householdId: string) {
  return apiGet<PersonalizedMeals>(`/households/${householdId}/wellness/me/meal-suggestions`);
}
export interface MealSuggestionView {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  tags: string[];
  servings: number;
  ingredients: MealIngredientView[];
  coverage: number;
  can_make: boolean;
  missing: MealIngredientView[];
  expiring_ingredient_count: number;
}
export interface ShoppingListItemView {
  id: string;
  food_id: string;
  food_name: string;
  quantity: string | null;
  unit_code: string | null;
  status: string;
  source: string;
  recipe_id: string | null;
  recipe_name: string | null;
  created_at: string;
}
export interface AddMissingRecipeItemsResult {
  recipe_id: string;
  added_count: number;
  items: Array<{
    id: string;
    food_id: string;
    quantity: string | null;
    unit_code: string | null;
    status: string;
    source: string;
    recipe_id: string | null;
  }>;
}
export function fetchMealSuggestions(householdId: string): Promise<MealSuggestionView[]> {
  return apiGet(`/households/${householdId}/meal-suggestions`);
}
export function addMissingRecipeItems(
  householdId: string,
  recipeId: string,
): Promise<AddMissingRecipeItemsResult> {
  return apiPost(`/households/${householdId}/meal-suggestions/${recipeId}/add-missing`, {});
}
export function fetchShoppingList(householdId: string): Promise<ShoppingListItemView[]> {
  return apiGet(`/households/${householdId}/shopping-list`);
}
export function updateShoppingItemStatus(
  householdId: string,
  itemId: string,
  status: 'PURCHASED' | 'CANCELLED',
) {
  return apiPost(`/households/${householdId}/shopping-list/${itemId}/status`, { status });
}
