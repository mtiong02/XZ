'use client';

import { useEffect, useRef } from 'react';
import { getSupabase } from './supabase';

/**
 * 订阅家庭实时频道（docs/02 §11）。
 * 收到变更通知后触发回调（通常是重新拉取 authoritative snapshot）。
 * 断线由 supabase-js 自动重连；重连后调用一次 onChange 以补齐可能错过的变更。
 */
export function useRealtimeInventory(householdId: string | null, onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!householdId) return;
    // 线上当前只部署了 GoTrue 鉴权服务，没有 Supabase Realtime Gateway。
    // 不要让客户端盲连 /realtime/v1（会产生 504）；默认用权威 HTTP 快照轮询。
    // 将来部署完整 Realtime 服务后才显式打开这个开关。
    if (process.env.NEXT_PUBLIC_ENABLE_SUPABASE_REALTIME !== 'true') {
      const timer = window.setInterval(() => onChangeRef.current(), 30_000);
      return () => window.clearInterval(timer);
    }
    const supabase = getSupabase();
    const channel = supabase
      .channel(`household:${householdId}`, { config: { private: false } })
      .on('broadcast', { event: 'inventory_changed' }, () => {
        onChangeRef.current();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // 首次订阅/重连成功后拉一次，保证一致
          onChangeRef.current();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId]);
}
