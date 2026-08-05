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
  set outlookConsentGiven(v: boolean) { set("outlook_consent", String(v)); },

  // OPFS (Origin Private File System) handle key stored as name — actual handle is held in memory
  get desktopFolderName(): string | null { return get("desktop_folder_name"); },
  set desktopFolderName(v: string | null) { v == null ? remove("desktop_folder_name") : set("desktop_folder_name", v); },

  get importDocTypes(): string[] {
    const v = get("import_doc_types");
    return v ? v.split(",") : ["invoice", "tax", "coupon", "travel", "other"];
  },
  set importDocTypes(v: string[]) { set("import_doc_types", v.join(",")); },

  get syncMonths(): number { return parseInt(get("sync_months") ?? "1", 10); },
  set syncMonths(v: number) { set("sync_months", String(v)); },

  get isSubscribed(): boolean { return get("subscribed") === "true"; },
  set isSubscribed(v: boolean) { set("subscribed", String(v)); },

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
