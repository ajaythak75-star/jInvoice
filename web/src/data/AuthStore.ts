import { getSupabase } from "./supabase";

export const auth = {
  get email(): string | null {
    return localStorage.getItem("jinvoice:auth_email");
  },

  get isLoggedIn(): boolean {
    return localStorage.getItem("jinvoice:session") === "1";
  },

  get token(): string | null {
    return localStorage.getItem("jinvoice:session_token");
  },

  async sendOtp(email: string): Promise<void> {
    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed to send code. Try again." }));
      throw new Error(error);
    }
    localStorage.setItem("jinvoice:auth_email", email);
  },

  async verifyOtp(email: string, token: string): Promise<void> {
    const res = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: token }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Invalid or expired code." }));
      throw new Error(error);
    }
    const data = await res.json().catch(() => ({}));
    if (data.token) localStorage.setItem("jinvoice:session_token", data.token);
    localStorage.removeItem("jinvoice:signed_out");
    localStorage.setItem("jinvoice:auth_email", email);
    localStorage.setItem("jinvoice:session", "1");
  },

  async sendMagicLink(email: string): Promise<void> {
    const res = await fetch("/api/auth/send-magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed to send link. Try again." }));
      throw new Error(error);
    }
    localStorage.setItem("jinvoice:auth_email", email);
  },

  async verifyMagicLink(token: string): Promise<void> {
    const res = await fetch(`/api/auth/verify-magic-link?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "This sign-in link has expired or already been used." }));
      throw new Error(error);
    }
    const data = await res.json().catch(() => ({}));
    if (data.token) localStorage.setItem("jinvoice:session_token", data.token);
    if (data.email) localStorage.setItem("jinvoice:auth_email", data.email);
    localStorage.removeItem("jinvoice:signed_out");
    localStorage.setItem("jinvoice:session", "1");
  },

  async signOut(): Promise<void> {
    const sb = await getSupabase();
    sb?.auth.signOut().catch(() => {});
    localStorage.removeItem("jinvoice:session");
    localStorage.removeItem("jinvoice:session_token");
    localStorage.setItem("jinvoice:signed_out", "1");
  },
};
