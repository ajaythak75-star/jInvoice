import { supabase } from "./supabase";

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
    if (localStorage.getItem("jinvoice:session") === "1") return true;
    if (localStorage.getItem("jinvoice:signed_out") !== "1" && this.hasAccount) {
      localStorage.setItem("jinvoice:session", "1");
      return true;
    }
    return false;
  },

  signInWithGoogle(email: string, name: string): void {
    localStorage.removeItem("jinvoice:signed_out");
    localStorage.setItem("jinvoice:auth_email", email);
    localStorage.setItem("jinvoice:auth_name", name);
    localStorage.setItem("jinvoice:auth_provider", "google");
    localStorage.setItem("jinvoice:session", "1");
  },

  async createAccount(email: string, password: string): Promise<void> {
    if (supabase) {
      const { error: signUpErr } = await supabase.auth.signUp({ email, password });
      if (signUpErr && !signUpErr.message.toLowerCase().includes("already registered")) {
        throw new Error(signUpErr.message);
      }
      // If user already exists in Supabase, sign in instead
      if (signUpErr) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw new Error(signInErr.message);
      }
    }
    // Also store locally for offline use and backward compat
    const hash = await hashPassword(password);
    localStorage.removeItem("jinvoice:signed_out");
    localStorage.setItem("jinvoice:auth_email", email);
    localStorage.setItem("jinvoice:auth_hash", hash);
    localStorage.removeItem("jinvoice:auth_provider");
    localStorage.setItem("jinvoice:session", "1");
  },

  async signIn(password: string): Promise<boolean> {
    const email = this.email;
    if (!email) return false;

    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Fall back to local hash for accounts created before Supabase was added
        const stored = localStorage.getItem("jinvoice:auth_hash");
        if (!stored) return false;
        const hash = await hashPassword(password);
        if (hash !== stored) return false;
      }
    } else {
      const stored = localStorage.getItem("jinvoice:auth_hash");
      if (!stored) return false;
      const hash = await hashPassword(password);
      if (hash !== stored) return false;
    }

    localStorage.removeItem("jinvoice:signed_out");
    localStorage.setItem("jinvoice:session", "1");
    return true;
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    const ok = await this.signIn(oldPassword);
    if (!ok) return false;
    if (supabase) {
      await supabase.auth.updateUser({ password: newPassword });
    }
    const hash = await hashPassword(newPassword);
    localStorage.setItem("jinvoice:auth_hash", hash);
    return true;
  },

  signOut(): void {
    supabase?.auth.signOut().catch(() => {});
    localStorage.removeItem("jinvoice:session");
    localStorage.setItem("jinvoice:signed_out", "1");
  },
};
