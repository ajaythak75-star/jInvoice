const CACHE_KEY = "jinvoice:config_cache";

export interface UploadLimits {
  free: number;      // -1 = unlimited
  pro_trial: number;
  pro_paid: number;
}

export interface PlanPricing {
  shared: { monthly: number; yearly: number };
  own:    { monthly: number; yearly: number };
}

export interface ProfileEnabled {
  personal:       boolean;
  society:        boolean;
  shopkeeper:     boolean;
  tax_consultant: boolean;
  ca:             boolean;
  real_estate:    boolean;
  advocate:       boolean;
  bookkeeper:     boolean;
  freelancer:     boolean;
  ngo:            boolean;
}

export interface PlanSettings {
  trial_days: number;
  support_response: {
    free:      string;
    pro_trial: string;
    pro:       string;
  };
}

const DEFAULTS = {
  upload_limits: { free: 5, pro_trial: 50, pro_paid: -1 } as UploadLimits,
  plan_pricing: {
    shared: { monthly: 999,  yearly: 9990 },
    own:    { monthly: 499,  yearly: 4990 },
  } as PlanPricing,
  profile_enabled: {
    personal: true, society: true, shopkeeper: true, tax_consultant: true,
    ca: true, real_estate: true, advocate: true, bookkeeper: true,
    freelancer: true, ngo: true,
  } as ProfileEnabled,
  plan_settings: {
    trial_days: 14,
    support_response: { free: "7 days", pro_trial: "7 days", pro: "48 hours" },
  } as PlanSettings,
};

type ConfigKey = keyof typeof DEFAULTS;
type ConfigValue<K extends ConfigKey> = (typeof DEFAULTS)[K];

function readCache(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { return {}; }
}

function writeCache(key: string, value: unknown): void {
  const cache = readCache();
  cache[key] = value;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

export function getCachedConfig<K extends ConfigKey>(key: K): ConfigValue<K> {
  const cached = readCache()[key];
  return (cached as ConfigValue<K>) ?? DEFAULTS[key];
}

export async function fetchAndCacheConfig<K extends ConfigKey>(key: K): Promise<ConfigValue<K>> {
  try {
    const r = await fetch(`/api/config/${key}`);
    if (r.ok) {
      const data = await r.json() as ConfigValue<K>;
      writeCache(key, data);
      return data;
    }
  } catch {}
  return getCachedConfig(key);
}

export async function refreshAllConfig(): Promise<void> {
  await Promise.allSettled([
    fetchAndCacheConfig("upload_limits"),
    fetchAndCacheConfig("plan_pricing"),
    fetchAndCacheConfig("profile_enabled"),
    fetchAndCacheConfig("plan_settings"),
  ]);
}
