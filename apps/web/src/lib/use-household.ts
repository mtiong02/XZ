'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, type HouseholdSummary } from './api';
import { getSupabase } from './supabase';

/** 加载当前登录用户的家庭（MVP：默认使用第一个家庭）。 */
export function useHousehold() {
  const router = useRouter();
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session) {
      router.replace('/login');
      return;
    }
    const households = await apiGet<HouseholdSummary[]>('/households');
    if (households.length === 0) {
      router.replace('/onboarding');
      return;
    }
    setHousehold(households[0] ?? null);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    reload().catch(() => router.replace('/login'));
  }, [reload, router]);

  return { household, loading };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  window.location.href = '/login';
}
