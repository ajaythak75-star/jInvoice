import { auth } from "../data/AuthStore";
import { prefs } from "../data/AutoImportPreferences";

export interface ServerPlan {
  plan: "free" | "pro_trial" | "pro_paid";
  trial_used: boolean;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  paid_from: string | null;
  paid_until: string | null;
  status: "active" | "cancelled" | "refund_pending";
  cancelled_at: string | null;
  refund_requested_at: string | null;
  cloud_upload_enabled?: boolean;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = auth.token;
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function applyPlanToPrefs(plan: ServerPlan): void {
  const trialActive =
    plan.plan === "pro_trial" &&
    !!plan.trial_ends_at &&
    new Date(plan.trial_ends_at) > new Date() &&
    plan.status === "active";

  if (plan.plan === "pro_paid" && plan.status === "active") {
    prefs.isSubscribed = true;
    prefs.customerPlan = "Pro";
    prefs.customerStatus = "Active";
    if (plan.paid_from) prefs.customerAccountCreatedAt = plan.paid_from;
    if (plan.paid_until) prefs.proEndDate = plan.paid_until;
    prefs.trialStartedAt = null;
  } else if (trialActive) {
    prefs.isSubscribed = false;
    prefs.customerPlan = "Free";
    prefs.trialStartedAt = plan.trial_started_at;
  } else {
    prefs.isSubscribed = false;
    prefs.customerPlan = "Free";
    prefs.trialStartedAt = null;
  }
  // Sync per-user feature flags (default true when not set by admin)
  prefs.cloudUploadEnabled = plan.cloud_upload_enabled !== false;
}

async function applyProfileCloudUpload(): Promise<void> {
  try {
    const r = await fetch("/api/config/profile_cloud_upload");
    if (!r.ok) return;
    const cfg: Record<string, boolean> = await r.json();
    const profile = prefs.userType ?? "personal";
    if (cfg[profile] === false) prefs.cloudUploadEnabled = false;
  } catch {
    // silently ignore — don't block app startup
  }
}

export async function syncPlanFromServer(): Promise<ServerPlan | null> {
  if (!auth.token) return null;
  try {
    const r = await fetch("/api/subscription", { headers: authHeaders() });
    if (!r.ok) return null;
    const plan: ServerPlan = await r.json();
    applyPlanToPrefs(plan);
    // Profile-level cloud upload block can override the per-user flag
    await applyProfileCloudUpload();
    return plan;
  } catch {
    return null;
  }
}

export async function startTrial(): Promise<ServerPlan> {
  const r = await fetch("/api/subscription/start-trial", { method: "POST", headers: authHeaders() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Failed to start trial.");
  }
  const plan: ServerPlan = await r.json();
  applyPlanToPrefs(plan);
  return plan;
}

export async function cancelPlan(): Promise<ServerPlan> {
  const r = await fetch("/api/subscription/cancel", { method: "POST", headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to cancel subscription.");
  const plan: ServerPlan = await r.json();
  applyPlanToPrefs(plan);
  return plan;
}

export async function activateDummyPro(
  apiOption: "shared" | "own",
  billing: "monthly" | "yearly",
): Promise<ServerPlan> {
  const r = await fetch("/api/payment/dummy-activate", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ apiOption, billing }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Dummy activation failed.");
  }
  const plan: ServerPlan = await r.json();
  applyPlanToPrefs(plan);
  return plan;
}

export async function requestProAccess(): Promise<void> {
  const r = await fetch("/api/subscription/request-pro", { method: "POST", headers: authHeaders() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Failed to send request.");
  }
}
