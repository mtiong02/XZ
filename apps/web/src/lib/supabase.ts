'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (typeof window !== 'undefined') {
      const isLocal =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!url || url.includes('127.0.0.1') || url.includes('localhost')) {
        url = isLocal ? 'http://127.0.0.1:54321' : window.location.origin;
      }
    } else {
      url = url || 'http://127.0.0.1:54321';
    }

    anonKey =
      anonKey ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

    client = createClient(url, anonKey);
  }
  return client;
}
