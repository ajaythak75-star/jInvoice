import { useState } from "react";

interface Props {
  provider: "Gmail" | "Outlook";
  onAccept: () => void;
  onDecline: () => void;
}

const DISCLOSURES = (provider: string): string[] => [
  `jInvoice will scan your ${provider} subject lines to find emails likely to contain invoice or receipt PDFs.`,
  "Matching PDF attachments will be downloaded directly to this device. No email content or attachment is ever sent to jInvoice servers.",
  "All invoice data extraction happens entirely in your browser — on this device — nothing leaves your device.",
  `You can revoke ${provider} access at any time from Settings. Revocation stops all background polling immediately.`,
];

export function ConsentModal({ provider, onAccept, onDecline }: Props) {
  const [checked, setChecked] = useState([false, false, false, false]);
  const allChecked = checked.every(Boolean);

  const toggle = (i: number) =>
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Connect {provider}</h2>
        <p className="modal-subtitle">
          Please read and confirm each disclosure before connecting:
        </p>
        <div className="disclosures">
          {DISCLOSURES(provider).map((text, i) => (
            <label key={i} className="disclosure-row">
              <input
                type="checkbox"
                checked={checked[i]}
                onChange={() => toggle(i)}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button
            className="btn-primary"
            disabled={!allChecked}
            onClick={onAccept}
          >
            I understand — Connect {provider}
          </button>
          <button className="btn-ghost" onClick={onDecline}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
