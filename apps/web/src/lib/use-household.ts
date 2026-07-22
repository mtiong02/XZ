'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, type HouseholdSummary } from './api';
import { getSupabase } from './supabase';

const HOUSEHOLD_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedHousehold: HouseholdSummary | null = null;
let cachedAt = 0;
let pendingHouseholdRequest: Promise<HouseholdSummary | null> | null = null;

async function resolveHousehold(): Promise<HouseholdSummary | null> {
  const now = Date.now();
  if (cachedHousehold && now - cachedAt < HOUSEHOLD_CACHE_TTL_MS) return cachedHousehold;
  if (pendingHouseholdRequest) return pendingHouseholdRequest;

  pendingHouseholdRequest = (async () => {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session) return null;
    const households = await apiGet<HouseholdSummary[]>('/households');
    const household = households[0] ?? null;
    if (household) {
      cachedHousehold = household;
      cachedAt = Date.now();
    }
    return household;
  })();

  try {
    return await pendingHouseholdRequest;
  } finally {
    pendingHouseholdRequest = null;
  }
}

/** 加载当前登录用户的家庭（MVP：默认使用第一个家庭）。 */
export function useHousehold() {
  const router = useRouter();
  // 页面切换时先复用已验证的家庭上下文，避免每个路由都重新显示整页“加载中”。
  const [household, setHousehold] = useState<HouseholdSummary | null>(() => cachedHousehold);
  const [loading, setLoading] = useState(() => cachedHousehold === null);

  const reload = useCallback(async () => {
    const nextHousehold = await resolveHousehold();
    if (!nextHousehold) {
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      router.replace('/onboarding');
      return;
    }
    setHousehold(nextHousehold);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    reload().catch(() => router.replace('/login'));
  }, [reload, router]);

  return { household, loading };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  cachedHousehold = null;
  cachedAt = 0;
  pendingHouseholdRequest = null;
  window.location.href = '/login';
}
