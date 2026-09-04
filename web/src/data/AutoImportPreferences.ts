export type UserProfile =
  | "personal"
  | "society"
  | "shopkeeper"
  | "tax_consultant"
  | "ca"
  | "real_estate"
  | "advocate"
  | "bookkeeper"
  | "freelancer"
  | "ngo";

const VALID_PROFILES: UserProfile[] = ["society", "shopkeeper", "tax_consultant", "ca", "real_estate", "advocate", "bookkeeper", "freelancer", "ngo"];

const PREFIX = "jinvoice:";

function get(key: string): string | null {
  return localStorage.getItem(PREFIX + key);
}
function set(key: string, value: string): void {
  localStorage.setItem(PREFIX + key, value);
}
function remove(key: string): void {
  localStorage.removeItem(PREFIX + key);
}


export const prefs = {
  get gmailEnabled(): boolean { return get("gmail_enabled") === "true"; },
  set gmailEnabled(v: boolean) { set("gmail_enabled", String(v)); },

  get gmailEmail(): string | null { return get("gmail_email"); },
  set gmailEmail(v: string | null) { v == null ? remove("gmail_email") : set("gmail_email", v); },

  get gmailAccessToken(): string | null { return get("gmail_access_token"); },
  set gmailAccessToken(v: string | null) { v == null ? remove("gmail_access_token") : set("gmail_access_token", v); },

  get gmailRefreshToken(): string | null { return get("gmail_refresh_token"); },
  set gmailRefreshToken(v: string | null) { v == null ? remove("gmail_refresh_token") : set("gmail_refresh_token", v); },

  get gmailConsentGiven(): boolean { return get("gmail_consent") === "true"; },
  set gmailConsentGiven(v: boolean) { set("gmail_consent", String(v)); },

  get outlookEnabled(): boolean { return get("outlook_enabled") === "true"; },
  set outlookEnabled(v: boolean) { set("outlook_enabled", String(v)); },

  get outlookEmail(): string | null { return get("outlook_email"); },
  set outlookEmail(v: string | null) { v == null ? remove("outlook_email") : set("outlook_email", v); },

  get outlookAccessToken(): string | null { return get("outlook_access_token"); },
  set outlookAccessToken(v: string | null) { v == null ? remove("outlook_access_token") : set("outlook_access_token", v); },

  get outlookConsentGiven(): boolean { return get("outlook_consent") === "true"; },

  get imapEnabled(): boolean { return get("imap_enabled") === "true"; },
  set imapEnabled(v: boolean) { set("imap_enabled", String(v)); },

  get imapEmail(): string | null { return get("imap_email"); },
  set imapEmail(v: string | null) { v == null ? remove("imap_email") : set("imap_email", v); },

  get imapFolderPaths(): string[] {
    const v = get("imap_folder_paths");
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  },
  set imapFolderPaths(v: string[]) { set("imap_folder_paths", JSON.stringify(v)); },

  get imapConsentGiven(): boolean { return get("imap_consent") === "true"; },
  set imapConsentGiven(v: boolean) { set("imap_consent", String(v)); },
  set outlookConsentGiven(v: boolean) { set("outlook_consent", String(v)); },

  // OPFS (Origin Private File System) handle key stored as name — actual handle is held in memory
  get desktopFolderName(): string | null { return get("desktop_folder_name"); },
  set desktopFolderName(v: string | null) { v == null ? remove("desktop_folder_name") : set("desktop_folder_name", v); },

  get importDocTypes(): string[] {
    const v = get("import_doc_types");
    return v ? v.split(",") : ["invoice", "tax", "coupon", "travel", "other"];
  },
  set importDocTypes(v: string[]) { set("import_doc_types", v.join(",")); },

  get syncMonths(): number { return parseInt(get("sync_months") ?? "3", 10); },
  set syncMonths(v: number) { set("sync_months", String(v)); },

  get gmailLabelIds(): string[] {
    const v = get("gmail_label_ids");
    try { return v ? JSON.parse(v) : ["INBOX"]; } catch { return ["INBOX"]; }
  },
  set gmailLabelIds(v: string[]) { set("gmail_label_ids", JSON.stringify(v)); },

  get outlookFolderIds(): string[] {
    const v = get("outlook_folder_ids");
    try { return v ? JSON.parse(v) : ["inbox"]; } catch { return ["inbox"]; }
  },
  set outlookFolderIds(v: string[]) { set("outlook_folder_ids", JSON.stringify(v)); },

  get syncSchedule(): "manual" | "daily" {
    const v = get("sync_schedule");
    return v === "daily" ? "daily" : "manual";
  },
  set syncSchedule(v: "manual" | "daily") { set("sync_schedule", v); },

  get syncTime(): string { return get("sync_time") ?? "09:00"; },
  set syncTime(v: string) { set("sync_time", v); },

  get lastAutoSync(): string | null { return get("last_auto_sync"); },
  set lastAutoSync(v: string | null) { v == null ? remove("last_auto_sync") : set("last_auto_sync", v); },

  get isSubscribed(): boolean { return get("subscribed") === "true"; },
  set isSubscribed(v: boolean) { set("subscribed", String(v)); },

  FREE_DAILY_LIMIT: 10,           // email auto-import limit for free users
  FREE_MANUAL_UPLOAD_LIMIT: 5,    // manual upload limit for free users
  TRIAL_MANUAL_UPLOAD_LIMIT: 10,  // manual upload limit during Pro trial
  TRIAL_EMAIL_DAILY_LIMIT: 25,    // email auto-import limit during Pro trial
  PRO_SHARED_DAILY_LIMIT: 50,     // both manual and email limit for paid Pro Shared
  /** @deprecated use effectiveManualUploadLimit */
  MANUAL_UPLOAD_DAILY_LIMIT: 10,

  get todayInvoiceCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    const stored = get("daily_count");
    try {
      const parsed: { date: string; count: number } = JSON.parse(stored ?? "{}");
      return parsed.date === today ? parsed.count : 0;
    } catch { return 0; }
  },

  incrementDailyCount(): void {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.todayInvoiceCount + 1;
    set("daily_count", JSON.stringify({ date: today, count }));
  },

  get effectiveDailyEmailLimit(): number {
    if (this.isSubscribed) return this.planApiOption === "own" ? Infinity : this.PRO_SHARED_DAILY_LIMIT;
    if (this.isInTrial) return this.TRIAL_EMAIL_DAILY_LIMIT;
    return this.FREE_DAILY_LIMIT;
  },

  get isDailyLimitReached(): boolean {
    return this.todayInvoiceCount >= this.effectiveDailyEmailLimit;
  },

  // Manual upload counter — separate from general daily count; only applies to free users
  get todayManualUploadCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    const stored = get("manual_daily_count");
    try {
      const parsed: { date: string; count: number } = JSON.parse(stored ?? "{}");
      return parsed.date === today ? parsed.count : 0;
    } catch { return 0; }
  },

  incrementManualUploadCount(): void {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.todayManualUploadCount + 1;
    set("manual_daily_count", JSON.stringify({ date: today, count }));
  },

  get effectiveManualUploadLimit(): number {
    if (this.isSubscribed) return this.planApiOption === "own" ? Infinity : this.PRO_SHARED_DAILY_LIMIT;
    if (this.isInTrial) return this.TRIAL_MANUAL_UPLOAD_LIMIT;
    return this.FREE_MANUAL_UPLOAD_LIMIT;
  },

  get isManualUploadLimitReached(): boolean {
    const limit = this.effectiveManualUploadLimit;
    if (!isFinite(limit)) return false;
    return this.todayManualUploadCount >= limit;
  },

  // True when the business profile form has been completed (trial start or post-payment)
  get businessProfileCompleted(): boolean { return get("business_profile_completed") === "true"; },
  set businessProfileCompleted(v: boolean) { set("business_profile_completed", String(v)); },

  get trialStartedAt(): string | null { return get("trial_started_at"); },
  set trialStartedAt(v: string | null) { v ? set("trial_started_at", v) : remove("trial_started_at"); },

  get isInTrial(): boolean {
    const s = get("trial_started_at");
    if (!s) return false;
    return Date.now() - new Date(s).getTime() < 14 * 24 * 60 * 60 * 1000;
  },

  // True when the user can use Pro features (subscribed OR within 14-day trial)
  get isProActive(): boolean { return get("subscribed") === "true" || (!!get("trial_started_at") && Date.now() - new Date(get("trial_started_at")!).getTime() < 14 * 24 * 60 * 60 * 1000); },

  startTrial(): void {
    if (!get("trial_started_at")) set("trial_started_at", new Date().toISOString());
  },

  get trialDaysLeft(): number {
    const s = get("trial_started_at");
    if (!s) return 0;
    const ms = 14 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(s).getTime());
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  },

  // Customer profile (filled when user upgrades to Pro)
  get customerName(): string { return get("customer_name") ?? ""; },
  set customerName(v: string) { set("customer_name", v); },

  get customerEmail(): string { return get("customer_email") ?? ""; },
  set customerEmail(v: string) { set("customer_email", v); },

  get customerLocation(): string { return get("customer_location") ?? ""; },
  set customerLocation(v: string) { set("customer_location", v); },

  get customerPin(): string { return get("customer_pin") ?? ""; },
  set customerPin(v: string) { set("customer_pin", v); },

  get customerCountry(): string { return get("customer_country") ?? ""; },
  set customerCountry(v: string) { set("customer_country", v); },

  get customerAccountCreatedAt(): string { return get("customer_created_at") ?? ""; },
  set customerAccountCreatedAt(v: string) { set("customer_created_at", v); },

  get customerPlan(): string { return get("customer_plan") ?? "Free"; },
  set customerPlan(v: string) { set("customer_plan", v); },

  get customerStatus(): string { return get("customer_status") ?? "Active"; },
  set customerStatus(v: string) { set("customer_status", v); },

  get allowedSenders(): string[] {
    const v = get("allowed_senders");
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  },
  set allowedSenders(v: string[]) { set("allowed_senders", JSON.stringify(v)); },

  get notificationsEnabled(): boolean { return get("notifications_enabled") !== "false"; },
  set notificationsEnabled(v: boolean) { set("notifications_enabled", String(v)); },

  get mobileSyncEnabled(): boolean { return get("mobile_sync_enabled") === "true"; },
  set mobileSyncEnabled(v: boolean) { set("mobile_sync_enabled", String(v)); },

  get mobileSyncKey(): string { return get("mobile_sync_key") ?? ""; },
  set mobileSyncKey(v: string) { set("mobile_sync_key", v); },

  // User-configurable Gemini API key (overrides VITE_GEMINI_API_KEY env var)
  get geminiApiKey(): string { return get("gemini_api_key") ?? ""; },
  set geminiApiKey(v: string) { v ? set("gemini_api_key", v) : remove("gemini_api_key"); },

  // User-configurable OpenAI API key (overrides server OPENAI_API_KEY env var)
  get openaiApiKey(): string { return get("openai_api_key") ?? ""; },
  set openaiApiKey(v: string) { v ? set("openai_api_key", v) : remove("openai_api_key"); },

  // Sarvam AI API key — used for Indian-language invoice translation before extraction
  get sarvamApiKey(): string { return get("sarvam_api_key") ?? ""; },
  set sarvamApiKey(v: string) { v ? set("sarvam_api_key", v) : remove("sarvam_api_key"); },

  // jInvoice secret key — used for mobile sync authentication and API access
  get jInvoiceSecret(): string { return get("jinvoice_secret") ?? ""; },
  set jInvoiceSecret(v: string) { v ? set("jinvoice_secret", v) : remove("jinvoice_secret"); },

  // Pro subscription end date (ISO string), set when user activates paid Pro
  get proEndDate(): string | null { return get("pro_end_date"); },
  set proEndDate(v: string | null) { v ? set("pro_end_date", v) : remove("pro_end_date"); },

  // Multiple Gmail accounts (Pro: up to 5 total)
  get gmailAccounts(): Array<{ email: string; accessToken: string; refreshToken: string | null; enabled: boolean }> {
    try { return JSON.parse(get("gmail_accounts") ?? "[]"); } catch { return []; }
  },
  set gmailAccounts(v: Array<{ email: string; accessToken: string; refreshToken: string | null; enabled: boolean }>) {
    set("gmail_accounts", JSON.stringify(v));
  },

  // Multiple Outlook accounts (Pro: up to 5 total)
  get outlookAccounts(): Array<{ email: string; accessToken: string; enabled: boolean }> {
    try { return JSON.parse(get("outlook_accounts") ?? "[]"); } catch { return []; }
  },
  set outlookAccounts(v: Array<{ email: string; accessToken: string; enabled: boolean }>) {
    set("outlook_accounts", JSON.stringify(v));
  },

  // Total connected accounts across Gmail + Outlook
  get totalAccountCount(): number {
    const g = this.gmailAccounts.length + (this.gmailEmail && !this.gmailAccounts.find(a => a.email === this.gmailEmail) ? 1 : 0);
    const o = this.outlookAccounts.length + (this.outlookEmail && !this.outlookAccounts.find(a => a.email === this.outlookEmail) ? 1 : 0);
    return g + o;
  },

  get clientTags(): string[] {
    const v = get("client_tags");
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  },
  set clientTags(v: string[]) { set("client_tags", JSON.stringify(v)); },

  get projects(): string[] {
    const v = get("projects");
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  },
  set projects(v: string[]) { set("projects", JSON.stringify(v)); },

  get planApiOption(): "shared" | "own" {
    return get("plan_api_option") === "own" ? "own" : "shared";
  },
  set planApiOption(v: "shared" | "own") { set("plan_api_option", v); },

  // Locked profile type — set once during upgrade flow, never revert
  get userType(): UserProfile {
    const v = get("user_type") as UserProfile | null;
    return VALID_PROFILES.includes(v as UserProfile) ? (v as UserProfile) : "personal";
  },
  set userType(v: UserProfile) { set("user_type", v); },

  // Active view mode — freely switchable between "personal" and the locked type
  get activeMode(): UserProfile {
    const type = this.userType;
    if (type === "personal") return "personal";
    return get("active_mode") === "personal" ? "personal" : type;
  },
  set activeMode(v: UserProfile) { set("active_mode", v); },

  get societyName(): string { return get("society_name") ?? ""; },
  set societyName(v: string) { v ? set("society_name", v) : remove("society_name"); },

  get customSocietyCategories(): string[] {
    const v = get("custom_society_categories");
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  },
  set customSocietyCategories(v: string[]) { set("custom_society_categories", JSON.stringify(v)); },

  revokeGmail(): void {
    this.gmailEnabled = false;
    this.gmailConsentGiven = false;
    this.gmailEmail = null;
    this.gmailAccessToken = null;
    this.gmailRefreshToken = null;
  },

  revokeOutlook(): void {
    this.outlookEnabled = false;
    this.outlookConsentGiven = false;
    this.outlookEmail = null;
    this.outlookAccessToken = null;
  },
};
