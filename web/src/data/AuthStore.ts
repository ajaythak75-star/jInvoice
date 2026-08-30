import { getSupabase } from "./supabase";

export const auth = {
  get email(): string | null {
    return localStorage.getItem("jinvoice:auth_email");
  },

  get isLoggedIn(): boolean {
    return localStorage.getItem("jinvoice:session") === "1";
  },

  async sendOtp(email: string): Promise<void> {
    const sb = await getSupabase();
    if (!sb) throw new Error("Authentication service is not configured.");
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw new Error(error.message);
    localStorage.setItem("jinvoice:auth_email", email);
  },

  async verifyOtp(email: string, token: string): Promise<void> {
    const sb = await getSupabase();
    if (!sb) throw new Error("Authentication service is not configured.");
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw new Error(error.message);
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
