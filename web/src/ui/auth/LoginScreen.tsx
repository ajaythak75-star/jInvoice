import { useState } from "react";
import { auth } from "../../data/AuthStore";
import { AUTH_BASE } from "../../config";

interface Props {
  onLogin: () => void;
}

type Mode = "signin" | "create" | "reset";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
    <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

export function LoginScreen({ onLogin }: Props) {
  const hasAccount   = auth.hasAccount;
  const isGoogleAcct = auth.isGoogleAccount;

  const [mode, setMode]         = useState<Mode>(!hasAccount ? "create" : "signin");
  const [email, setEmail]       = useState(auth.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [newPwd, setNewPwd]     = useState("");
  const [newConfirm, setNewConfirm] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const clearForm = () => {
    setPassword(""); setConfirm(""); setNewPwd(""); setNewConfirm(""); setError(null);
  };

  const handleGoogleLogin = () => {
    if (!AUTH_BASE) {
      setError("Google sign-in is not available in this build. Use email + password instead.");
      return;
    }
    const returnTo = encodeURIComponent(window.location.origin);
    window.location.href = `${AUTH_BASE}/auth/google/login/start?return_to=${returnTo}`;
  };

  const switchTo = (m: Mode) => { clearForm(); setMode(m); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "create") {
      if (!email.trim() || !email.includes("@")) { setError("Enter a valid email address."); return; }
      if (password.length < 6)                    { setError("Password must be at least 6 characters."); return; }
      if (password !== confirm)                   { setError("Passwords do not match."); return; }
      setLoading(true);
      await auth.createAccount(email.trim(), password);
      setLoading(false);
      onLogin();

    } else if (mode === "signin") {
      setLoading(true);
      const ok = await auth.signIn(password);
      setLoading(false);
      if (!ok) { setError("Incorrect password. Try again."); setPassword(""); return; }
      onLogin();

    } else if (mode === "reset") {
      if (newPwd.length < 6)        { setError("Password must be at least 6 characters."); return; }
      if (newPwd !== newConfirm)    { setError("Passwords do not match."); return; }
      setLoading(true);
      await auth.createAccount(auth.email ?? email.trim(), newPwd);
      setLoading(false);
      onLogin();
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo-mark">j</div>
          <div className="auth-logo">Invoice</div>
        </div>
        <p className="auth-tagline">
          {mode === "reset" ? "Reset your password" : "Your invoices, on-device."}
        </p>

        {/* ── Reset password ───────────────────────────── */}
        {mode === "reset" && (
          <form onSubmit={handleSubmit} className="auth-form">
            {auth.email && (
              <div className="auth-field">
                <div className="auth-label">Account</div>
                <div className="auth-email-display">{auth.email}</div>
              </div>
            )}
            <div className="auth-field">
              <label className="auth-label">New password</label>
              <input className="auth-input" type="password" placeholder="Create a new password"
                value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                autoComplete="new-password" autoFocus required />
            </div>
            <div className="auth-field">
              <label className="auth-label">Confirm new password</label>
              <input className="auth-input" type="password" placeholder="Repeat new password"
                value={newConfirm} onChange={(e) => setNewConfirm(e.target.value)}
                autoComplete="new-password" required />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Please wait…" : "Set New Password"}
            </button>
            <button type="button" className="auth-switch" onClick={() => switchTo("signin")}>
              ← Back to sign in
            </button>
          </form>
        )}

        {/* ── Sign in — Google account ─────────────────── */}
        {mode === "signin" && isGoogleAcct && (
          <>
            <div className="auth-field" style={{ marginBottom: 18 }}>
              <div className="auth-label">Signed in as</div>
              <div className="auth-email-display">{auth.email}</div>
            </div>
            <button className="btn-google" onClick={handleGoogleLogin}>
              <GoogleIcon />
              Continue with Google
            </button>
            <button type="button" className="auth-switch"
              onClick={() => { auth.signOut(); clearForm(); setEmail(""); switchTo("create"); }}>
              Use a different account
            </button>
          </>
        )}

        {/* ── Sign in — password account ───────────────── */}
        {mode === "signin" && !isGoogleAcct && (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field">
              <div className="auth-label">Email</div>
              <div className="auth-email-display">{auth.email}</div>
            </div>
            <div className="auth-field">
              <div className="auth-field-header">
                <label className="auth-label">Password</label>
                <button type="button" className="auth-forgot" onClick={() => switchTo("reset")}>
                  Forgot password?
                </button>
              </div>
              <input className="auth-input" type="password" placeholder="Enter your password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" autoFocus required />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Please wait…" : "Sign In"}
            </button>
            <div className="auth-divider"><span>or</span></div>
            <button type="button" className="btn-google" onClick={handleGoogleLogin}>
              <GoogleIcon />
              Continue with Google
            </button>
            <button type="button" className="auth-switch"
              onClick={() => { clearForm(); setEmail(""); switchTo("create"); }}>
              Use a different account
            </button>
          </form>
        )}

        {/* ── Create account ───────────────────────────── */}
        {mode === "create" && (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input className="auth-input" type="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" autoFocus required />
            </div>
            <div className="auth-field">
              <label className="auth-label">Password</label>
              <input className="auth-input" type="password" placeholder="Create a password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" required />
            </div>
            <div className="auth-field">
              <label className="auth-label">Confirm password</label>
              <input className="auth-input" type="password" placeholder="Repeat password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" required />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Please wait…" : "Create Account"}
            </button>
            <div className="auth-divider"><span>or</span></div>
            <button type="button" className="btn-google" onClick={handleGoogleLogin}>
              <GoogleIcon />
              Sign up with Google
            </button>
            {hasAccount && (
              <button type="button" className="auth-switch"
                onClick={() => { clearForm(); setEmail(auth.email ?? ""); switchTo("signin"); }}>
                Already have an account? Sign in
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
