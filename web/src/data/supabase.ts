import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazily resolved — fetch config from server so no build-time VITE_* vars are needed.
let _client: SupabaseClient | null = null;
let _ready: Promise<SupabaseClient | null> | null = null;

async function resolve(): Promise<SupabaseClient | null> {
  // Local dev: use build-time env vars if present
  const devUrl  = import.meta.env.VITE_SUPABASE_URL  || "";
  const devAnon = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  if (devUrl && devAnon) {
    return (_client = createClient(devUrl, devAnon));
  }
  try {
    const cfg = await fetch("/api/app-config").then((r) => r.json()) as { supabaseUrl: string; supabaseAnonKey: string };
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      return (_client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey));
    }
  } catch { /* server not running or no config */ }
  return null;
}

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!_ready) _ready = resolve();
  return _ready;
}

// Legacy sync accessor — returns null until resolve() has completed.
// Use getSupabase() in new code that can await.
export const supabase: SupabaseClient | null = null;

export function isSupabaseEnabled(): boolean {
  return _client !== null;
}
