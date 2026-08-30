import { useState } from "react";
import { auth } from "../../data/AuthStore";

interface Props {
  onLogin: () => void;
}

type Step = "email" | "otp";

export function LoginScreen({ onLogin }: Props) {
  const [step, setStep]       = useState<Step>("email");
  const [email, setEmail]     = useState(auth.email ?? "");
  const [otp, setOtp]         = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent]   = useState(false);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await auth.sendOtp(email.trim());
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = otp.trim().replace(/\s/g, "");
    if (token.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      await auth.verifyOtp(email.trim(), token);
      onLogin();
    } catch {
      setError("Invalid or expired code. Request a new one.");
      setOtp("");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setResent(false);
    try {
      await auth.sendOtp(email.trim());
      setResent(true);
      setTimeout(() => setResent(false), 4000);
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
            <form onSubmit={handleSendCode} className="auth-form">
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
                {loading ? "Sending…" : "Send Code"}
              </button>
            </form>
          </>
        )}

        {step === "otp" && (
          <>
            <p className="auth-tagline">Check your email</p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20, textAlign: "center" }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
            <form onSubmit={handleVerify} className="auth-form">
              <div className="auth-field">
                <label className="auth-label">Verification code</label>
                <input
                  className="auth-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </div>
              {error && <p className="auth-error">{error}</p>}
              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? "Verifying…" : "Verify"}
              </button>
            </form>
            <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }}>
              {resent
                ? <span style={{ color: "var(--color-success, #22c55e)" }}>Code resent!</span>
                : (
                  <button type="button" className="auth-switch" onClick={handleResend}>
                    Didn't receive it? Resend
                  </button>
                )
              }
            </div>
            <button type="button" className="auth-switch" style={{ marginTop: 6 }}
              onClick={() => { setStep("email"); setOtp(""); setError(null); }}>
              ← Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
