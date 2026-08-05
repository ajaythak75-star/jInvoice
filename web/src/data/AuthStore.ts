const SALT = "jinvoice_v1_";

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(SALT + password);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const auth = {
  get email(): string | null {
    return localStorage.getItem("jinvoice:auth_email");
  },

  get displayName(): string | null {
    return localStorage.getItem("jinvoice:auth_name");
  },

  get isGoogleAccount(): boolean {
    return localStorage.getItem("jinvoice:auth_provider") === "google";
  },

  get hasAccount(): boolean {
    return !!localStorage.getItem("jinvoice:auth_hash") || this.isGoogleAccount;
  },

  get isLoggedIn(): boolean {
    return sessionStorage.getItem("jinvoice:session") === "1";
  },

  signInWithGoogle(email: string, name: string): void {
    localStorage.setItem("jinvoice:auth_email", email);
    localStorage.setItem("jinvoice:auth_name", name);
    localStorage.setItem("jinvoice:auth_provider", "google");
    sessionStorage.setItem("jinvoice:session", "1");
  },

  async createAccount(email: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    localStorage.setItem("jinvoice:auth_email", email);
    localStorage.setItem("jinvoice:auth_hash", hash);
    localStorage.removeItem("jinvoice:auth_provider");
    sessionStorage.setItem("jinvoice:session", "1");
  },

  async signIn(password: string): Promise<boolean> {
    const stored = localStorage.getItem("jinvoice:auth_hash");
    if (!stored) return false;
    const hash = await hashPassword(password);
    if (hash !== stored) return false;
    sessionStorage.setItem("jinvoice:session", "1");
    return true;
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    const ok = await this.signIn(oldPassword);
    if (!ok) return false;
    const hash = await hashPassword(newPassword);
    localStorage.setItem("jinvoice:auth_hash", hash);
    return true;
  },

  signOut(): void {
    sessionStorage.removeItem("jinvoice:session");
  },
};
