import { createClient } from "@supabase/supabase-js";

declare const __SB_URL__:  string;
declare const __SB_ANON__: string;

// __SB_URL__ / __SB_ANON__ are injected by vite.config.ts define — they resolve
// VITE_SUPABASE_URL or the non-prefixed SUPABASE_URL (used by Render for Node).
const url  = (typeof __SB_URL__  !== "undefined" ? __SB_URL__  : "") || import.meta.env.VITE_SUPABASE_URL  || "";
const key  = (typeof __SB_ANON__ !== "undefined" ? __SB_ANON__ : "") || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

console.log("[supabase] url:", url ? url.slice(0, 30) + "…" : "(empty)", "| key:", key ? "set" : "(empty)");
export const supabase = url && key ? createClient(url, key) : null;

export function isSupabaseEnabled(): boolean {
  return supabase !== null;
}

