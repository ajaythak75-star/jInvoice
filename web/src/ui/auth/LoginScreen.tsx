import { useEffect, useState } from "react";
import { auth } from "../../data/AuthStore";

interface Props {
  onLogin: () => void;
}

type Step = "email" | "sent";

export function LoginScreen({ onLogin }: Props) {
  const [step, setStep]       = useState<Step>("email");
  const [email, setEmail]     = useState(auth.email ?? "");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent]   = useState(false);

  // Poll localStorage — if the user clicked the magic link in another tab or
  // the email client navigated the same tab and React re-mounted, pick it up.
  useEffect(() => {
    if (step !== "sent") return;
    const id = setInterval(() => {
      if (auth.isLoggedIn) {
        clearInterval(id);
        onLogin();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [step, onLogin]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await auth.sendMagicLink(email.trim());
      setStep("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send link. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setResent(false);
    try {
      await auth.sendMagicLink(email.trim());
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend. Try again.");
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo-mark">j</div>
          <div className="auth-logo">Invoice</div>
        </div>

        {step === "email" && (
          <>
            <p className="auth-tagline">Your invoices, on-device.</p>
            <form onSubmit={handleSend} className="auth-form">
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
              {error && <p className="auth-error">{error}</p>}
              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          </>
        )}

        {step === "sent" && (
          <>
            <p className="auth-tagline">Check your email</p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 8, textAlign: "center" }}>
              We sent a sign-in link to <strong>{email}</strong>
            </p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 20, textAlign: "center", opacity: 0.8 }}>
              Click the link in the email to sign in. If you don't see it, check your <strong>spam or junk folder</strong>.
            </p>
            {error && <p className="auth-error">{error}</p>}
            <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }}>
              {resent
                ? <span style={{ color: "var(--color-success, #22c55e)" }}>Link resent!</span>
                : (
                  <button type="button" className="auth-switch" onClick={handleResend}>
                    Didn't receive it? Resend
                  </button>
                )
              }
            </div>
            <button type="button" className="auth-switch" style={{ marginTop: 6 }}
              onClick={() => { setStep("email"); setError(null); }}>
              ← Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
