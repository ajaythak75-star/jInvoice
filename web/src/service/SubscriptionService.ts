import { auth } from "../data/AuthStore";

export interface Subscription {
  plan: "free" | "pro_trial" | "pro_paid";
  trial_used: boolean;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  paid_from: string | null;
  paid_until: string | null;
  status: "active" | "cancelled" | "refund_pending";
  cancelled_at: string | null;
  refund_requested_at: string | null;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.token) h["Authorization"] = `Bearer ${auth.token}`;
  return h;
}

async function call(path: string, opts: RequestInit = {}): Promise<Subscription | null> {
  if (!auth.token) return null;
  try {
    const r = await fetch(path, {
      ...opts,
      headers: { ...authHeaders(), ...opts.headers },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export const subscriptionService = {
  get: (): Promise<Subscription | null> => call("/api/subscription"),
  startTrial: (): Promise<Subscription | null> => call("/api/subscription/start-trial", { method: "POST" }),
  cancel: (): Promise<Subscription | null> => call("/api/subscription/cancel", { method: "POST" }),
  requestRefund: (): Promise<Subscription | null> => call("/api/subscription/request-refund", { method: "POST" }),

  async createCheckout(plan: "shared" | "own", billing: "monthly" | "yearly"): Promise<string | null> {
    if (!auth.token) return null;
    try {
      const r = await fetch("/api/stripe-checkout", {
        method: "POST",
        headers: { ...authHeaders(), },
        body: JSON.stringify({ plan, billing }),
      });
      if (!r.ok) return null;
      const { url } = await r.json();
      return url ?? null;
    } catch { return null; }
  },
};

// Helpers to read server subscription state
export function trialDaysLeft(sub: Subscription): number {
  if (!sub.trial_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000));
}

export function isInTrial(sub: Subscription): boolean {
  return sub.plan === "pro_trial" && trialDaysLeft(sub) > 0;
}

export function isProActive(sub: Subscription): boolean {
  return sub.plan === "pro_paid" || isInTrial(sub);
}
