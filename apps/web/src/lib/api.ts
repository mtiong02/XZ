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

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: await authHeaders() });
  if (!response.ok) throw new ApiError((await response.json()) as ProblemDetails);
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError((await response.json()) as ProblemDetails);
  return (await response.json()) as T;
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
  default_shelf_life_days: number | null;
  aliases: string[];
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
