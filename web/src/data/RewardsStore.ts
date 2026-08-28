import { supabase } from "./supabase";

const P = "jinvoice:rewards:";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function ls(k: string): string | null {
  try { return localStorage.getItem(P + k); } catch { return null; }
}
function lsSet(k: string, v: string): void {
  try { localStorage.setItem(P + k, v); } catch {}
}
function lsDel(k: string): void {
  try { localStorage.removeItem(P + k); } catch {}
}

export interface RewardEvent {
  points: number;
  reason: string;
  at: string;
}

function getUserEmail(): string | null {
  try { return localStorage.getItem("jinvoice:auth_email"); } catch { return null; }
}

async function pushToSupabase(): Promise<void> {
  if (!supabase) return;
  const email = getUserEmail();
  if (!email) return;
  try {
    await supabase.from("rewards").upsert({
      user_email:      email,
      points:          rewards.totalPoints,
      upload_count:    rewards.uploadCount,
      cloud_sync_count: rewards.cloudSyncCount,
      history:         rewards.history,
      last_used_at:    rewards.lastUsedAt,
      disabled_at:     rewards.disabledAt,
      updated_at:      new Date().toISOString(),
    }, { onConflict: "user_email" });
  } catch (e) {
    console.warn("[RewardsStore] Supabase sync failed", e);
  }
}

function award(points: number, reason: string): void {
  if (rewards.isDisabled) return;

  const prev = parseInt(ls("pts") ?? "0", 10);
  lsSet("pts", String(prev + points));

  let hist: RewardEvent[] = [];
  try { hist = JSON.parse(ls("hist") ?? "[]"); } catch {}
  hist.unshift({ points, reason, at: new Date().toISOString() });
  lsSet("hist", JSON.stringify(hist.slice(0, 200)));

  // Update lastUsedAt on every award
  lsSet("last_used", new Date().toISOString());
  // Clear disabled state if user is active again
  lsDel("disabled_at");

  pushToSupabase().catch(() => {});
}

export const rewards = {
  get totalPoints(): number    { return parseInt(ls("pts") ?? "0", 10); },
  get uploadCount(): number    { return parseInt(ls("cnt") ?? "0", 10); },
  get cloudSyncCount(): number { return parseInt(ls("csync") ?? "0", 10); },
  get lastUsedAt(): string | null { return ls("last_used"); },
  get disabledAt(): string | null { return ls("disabled_at"); },

  get history(): RewardEvent[] {
    try { return JSON.parse(ls("hist") ?? "[]"); } catch { return []; }
  },

  // Returns true if the user hasn't used the rewards system in 90+ days
  get isDisabled(): boolean {
    const da = ls("disabled_at");
    if (da) return true;
    const lu = ls("last_used");
    if (!lu) return false;
    const inactive = Date.now() - new Date(lu).getTime() > NINETY_DAYS_MS;
    if (inactive) {
      // Stamp disabled_at now so we don't re-compute on every access
      lsSet("disabled_at", new Date().toISOString());
      pushToSupabase().catch(() => {});
    }
    return inactive;
  },

  recordUpload(complete: boolean): void {
    if (this.isDisabled) return;
    const cnt = this.uploadCount + 1;
    lsSet("cnt", String(cnt));
    award(10, "Manual invoice upload (+10 pts)");
    if (complete) award(5, "Complete invoice — all fields filled (+5 pts)");
    if (cnt % 5 === 0)  award(25, `${cnt} invoices milestone — streak bonus! (+25 pts)`);
    if (cnt % 25 === 0) award(100, `${cnt} invoices — Champion bonus! (+100 pts)`);
  },

  recordCloudSync(): void {
    if (this.isDisabled) return;
    const csync = this.cloudSyncCount + 1;
    lsSet("csync", String(csync));
    award(5, "Invoice saved to cloud (+5 pts)");
  },

  // Load rewards from Supabase and merge — Supabase wins on points if higher,
  // but we never reduce local points (local is always at least as high).
  async loadFromCloud(): Promise<void> {
    if (!supabase) return;
    const email = getUserEmail();
    if (!email) return;
    try {
      const { data } = await supabase
        .from("rewards")
        .select("points,upload_count,cloud_sync_count,history,last_used_at,disabled_at")
        .eq("user_email", email)
        .maybeSingle();
      if (!data) return;

      // Merge: take the higher points value
      const localPts = this.totalPoints;
      if (data.points > localPts) lsSet("pts", String(data.points));

      const localCnt = this.uploadCount;
      if (data.upload_count > localCnt) lsSet("cnt", String(data.upload_count));

      const localCsync = this.cloudSyncCount;
      if (data.cloud_sync_count > localCsync) lsSet("csync", String(data.cloud_sync_count));

      // Disabled state: if Supabase says disabled, apply locally too
      if (data.disabled_at && !ls("disabled_at")) {
        lsSet("disabled_at", data.disabled_at);
      }
    } catch (e) {
      console.warn("[RewardsStore] loadFromCloud failed", e);
    }
  },
};

// Load from cloud on first import (non-blocking)
rewards.loadFromCloud().catch(() => {});
