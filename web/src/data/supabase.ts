import { createClient } from "@supabase/supabase-js";

// Primary: runtime-injected by proxy.mjs into index.html (works on Render without build-time vars).
// Fallback: VITE_SUPABASE_URL baked in at build time (works in local dev).
const w = globalThis as any;
const url = (w.__SB_URL__ as string | undefined) || import.meta.env.VITE_SUPABASE_URL || "";
const key = (w.__SB_ANON__ as string | undefined) || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = url && key ? createClient(url, key) : null;

export function isSupabaseEnabled(): boolean {
  return supabase !== null;
}

