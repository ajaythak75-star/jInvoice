import React from "react";

interface Props {
  children: React.ReactNode;
  active: string;
  onNav: (tab: string) => void;
}

const NAV_ITEMS = [
  { id: "import",   label: "Import",   icon: "📨" },
  { id: "view",     label: "View",     icon: "📋" },
  { id: "alerts",   label: "Alerts",   icon: "🛡️" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export function MainLayout({ children, active, onNav }: Props) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-logo">jInvoice</span>
      </header>
      <main className="app-main">{children}</main>
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item${active === item.id ? " active" : ""}`}
            onClick={() => onNav(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
