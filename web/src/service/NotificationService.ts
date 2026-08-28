import { getActiveSentinels } from "./ExpirySentinel";
import { daysUntilExpiry } from "./ExpirySentinel";
import { prefs } from "../data/AutoImportPreferences";

const todayKey = () => `jinvoice:notified:${new Date().toISOString().slice(0, 10)}`;

function fire(title: string, body: string): void {
  try { new Notification(title, { body }); } catch {}
  localStorage.setItem(todayKey(), "1");
}

async function doCheck(): Promise<void> {
  if (!prefs.notificationsEnabled) return;
  if (typeof Notification === "undefined") return;
  if (localStorage.getItem(todayKey())) return;

  const all = await getActiveSentinels();
  const urgent = all.filter((s) => {
    const d = daysUntilExpiry(s.expiresAt);
    return d >= 0 && d <= 30;
  });
  if (!urgent.length) return;

  const first = urgent[0];
  const days = daysUntilExpiry(first.expiresAt);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const body =
    urgent.length === 1
      ? `${first.label} expires ${when}.`
      : `${first.label} expires ${when} · ${urgent.length - 1} more alert${urgent.length > 2 ? "s" : ""}.`;

  if (Notification.permission === "granted") {
    fire("jInvoice — Expiry Alert", body);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => {
      if (p === "granted") fire("jInvoice — Expiry Alert", body);
    });
  }
}

export function checkAndNotify(): void {
  doCheck().catch(console.error);
}
