import { getSupabase } from "./supabase";

export const auth = {
  get email(): string | null {
    return localStorage.getItem("jinvoice:auth_email");
  },

  get isLoggedIn(): boolean {
    return localStorage.getItem("jinvoice:session") === "1";
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
    // TODO: magic link — re-enable when Resend domain is verified
    // const data = await res.json();
    // if (data.token_hash) {
    //   const sb = await getSupabase();
    //   if (!sb) throw new Error("Authentication service is not configured.");
    //   const { error } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    //   if (error) throw new Error(error.message);
    // }
    localStorage.removeItem("jinvoice:signed_out");
    localStorage.setItem("jinvoice:auth_email", email);
    localStorage.setItem("jinvoice:session", "1");
  },

  async signOut(): Promise<void> {
    const sb = await getSupabase();
    sb?.auth.signOut().catch(() => {});
    localStorage.removeItem("jinvoice:session");
    localStorage.setItem("jinvoice:signed_out", "1");
  },
};
