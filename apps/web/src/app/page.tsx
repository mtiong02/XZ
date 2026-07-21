'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../lib/supabase';
import { apiGet, type HouseholdSummary } from '../lib/api';

/** 入口路由：未登录 -> /login；无家庭 -> /onboarding；否则 -> /fridge */
export default function IndexPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      try {
        const households = await apiGet<HouseholdSummary[]>('/households');
        if (cancelled) return;
        router.replace(households.length === 0 ? '/onboarding' : '/fridge');
      } catch {
        router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <div className="empty">加载中…</div>;
}
