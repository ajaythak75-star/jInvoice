import { useState } from "react";

const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
  "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh",
  "Uttarakhand","West Bengal","Delhi","Jammu & Kashmir","Ladakh","Chandigarh",
  "Puducherry","Andaman & Nicobar Islands","Dadra & Nagar Haveli","Daman & Diu",
];

const BUSINESS_TYPES = [
  "Sole Proprietor","Partnership","LLP","Private Limited (Pvt. Ltd.)","Public Limited","Trust / NGO","Others",
];

interface BusinessProfile {
  businessType: string;
  address: string;
  pin: string;
  state: string;
  country: string;
  licenses: string;
}

const inpStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg)",
  color: "var(--color-text)", fontSize: 13, boxSizing: "border-box", outline: "none",
};
const lblStyle: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em",
};
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "#ef4444", marginTop: 3 };

export function BusinessProfileModal({
  onConfirm,
  onClose,
  ctaLabel = "Continue to Trial →",
}: {
  onConfirm: () => void;
  onClose: () => void;
  ctaLabel?: string;
}) {
  const [profile, setProfile] = useState<BusinessProfile>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("jinvoice:business_profile") ?? "null") ?? {
          businessType: "", address: "", pin: "", state: "", country: "India", licenses: "",
        }
      );
    } catch {
      return { businessType: "", address: "", pin: "", state: "", country: "India", licenses: "" };
    }
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BusinessProfile, string>>>({});

  const set =
    (k: keyof BusinessProfile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setProfile((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = () => {
    const errs: Partial<Record<keyof BusinessProfile, string>> = {};
    if (!profile.businessType) errs.businessType = "Required";
    if (!profile.address.trim()) errs.address = "Required";
    if (!/^\d{6}$/.test(profile.pin.trim())) errs.pin = "Enter a valid 6-digit PIN";
    if (!profile.state) errs.state = "Required";
    if (!profile.country.trim()) errs.country = "Required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try { localStorage.setItem("jinvoice:business_profile", JSON.stringify(profile)); } catch {}
    onConfirm();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.52)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "28px 24px", maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--color-border)", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text)", margin: "0 0 6px" }}>Business Details</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 22, lineHeight: 1.5 }}>
          A few details to set up your Pro account. Fields marked <span style={{ color: "#ef4444" }}>*</span> are required.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lblStyle}>Business Type <span style={{ color: "#ef4444" }}>*</span></label>
            <select value={profile.businessType} onChange={set("businessType")} style={inpStyle}>
              <option value="">Select type…</option>
              {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {errors.businessType && <div style={errStyle}>{errors.businessType}</div>}
          </div>

          <div>
            <label style={lblStyle}>Business Address <span style={{ color: "#ef4444" }}>*</span></label>
            <textarea value={profile.address} onChange={set("address")} placeholder="Street, building, area…" rows={2}
              style={{ ...inpStyle, resize: "vertical", fontFamily: "inherit" }} />
            {errors.address && <div style={errStyle}>{errors.address}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lblStyle}>PIN Code <span style={{ color: "#ef4444" }}>*</span></label>
              <input type="text" maxLength={6} inputMode="numeric" value={profile.pin} onChange={set("pin")} placeholder="6-digit PIN" style={inpStyle} />
              {errors.pin && <div style={errStyle}>{errors.pin}</div>}
            </div>
            <div>
              <label style={lblStyle}>State <span style={{ color: "#ef4444" }}>*</span></label>
              <select value={profile.state} onChange={set("state")} style={inpStyle}>
                <option value="">Select…</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.state && <div style={errStyle}>{errors.state}</div>}
            </div>
          </div>

          <div>
            <label style={lblStyle}>Country <span style={{ color: "#ef4444" }}>*</span></label>
            <input type="text" value={profile.country} onChange={set("country")} placeholder="India" style={inpStyle} />
            {errors.country && <div style={errStyle}>{errors.country}</div>}
          </div>

          <div>
            <label style={lblStyle}>
              Number of Licenses{" "}
              <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)", fontWeight: 400, textTransform: "none" }}>
                (optional, max 5)
              </span>
            </label>
            <input
              type="number" min={1} max={5} value={profile.licenses} placeholder="e.g. 1" style={inpStyle}
              onChange={(e) => {
                const raw = parseInt(e.target.value, 10);
                const v = isNaN(raw) ? "" : String(Math.min(5, Math.max(1, raw)));
                setProfile((p) => ({ ...p, licenses: v }));
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
