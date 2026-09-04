import React, { useState } from "react";

interface Props {
  children: React.ReactNode;
  active: string;
  onNav: (tab: string) => void;
  alertCount?: number;
  isAdmin?: boolean;
}

const ImportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const ViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.75 12h16.5m-16.5 5.25h16.5M3.75 6.75h16.5" />
  </svg>
);

const AlertsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

const SecurityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a7.723 7.723 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ReportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 16l4-5 4 3 4-7" />
  </svg>
);

const PricingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14.25l1.5 1.5 4.5-4.5" />
    <path d="M12 2l2.4 4.8 5.3.8-3.85 3.75.91 5.3L12 14.1l-4.76 2.55.91-5.3L4.3 7.6l5.3-.8L12 2z" />
  </svg>
);

const RewardsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const FAQIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
    <circle cx="12" cy="12" r="10" />
    <path d="M12 17h.01" />
  </svg>
);

const AboutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

const AdminIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a5 5 0 100 10A5 5 0 0012 2z" />
    <path d="M20.59 21a8 8 0 10-17.18 0" />
    <path d="M18 17l2 2 4-4" />
  </svg>
);

const NAV_ITEMS = [
  { id: "import",   label: "Import",   Icon: ImportIcon   },
  { id: "view",     label: "View",     Icon: ViewIcon     },
  { id: "gst",      label: "Report",   Icon: ReportIcon   },
  { id: "alerts",   label: "Alerts",   Icon: AlertsIcon   },
  { id: "rewards",  label: "Rewards",  Icon: RewardsIcon  },
  { id: "security", label: "Security", Icon: SecurityIcon },
  { id: "pricing",  label: "Price",    Icon: PricingIcon  },
  { id: "settings", label: "Settings",    Icon: SettingsIcon },
  { id: "faq",      label: "FAQ & Support", Icon: FAQIcon   },
  { id: "about",    label: "About",         Icon: AboutIcon },
];

// Primary tabs always visible in the mobile bottom bar
const BOTTOM_PRIMARY = ["import", "view", "alerts", "settings"];

// Items that live in the "More" drawer
const MORE_ITEMS = [
  { id: "rewards",  label: "Rewards",      Icon: RewardsIcon  },
  { id: "pricing",  label: "Price",        Icon: PricingIcon  },
  { id: "faq",      label: "FAQ & Support", Icon: FAQIcon     },
  { id: "about",    label: "About",         Icon: AboutIcon   },
  { id: "gst",      label: "Report",       Icon: ReportIcon   },
  { id: "security", label: "Security",     Icon: SecurityIcon },
];

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
);

export function MainLayout({ children, active, onNav, alertCount = 0, isAdmin = false }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleNav = (id: string) => {
    setDrawerOpen(false);
    onNav(id);
  };

  const navItems = isAdmin
    ? [...NAV_ITEMS, { id: "admin", label: "Admin", Icon: AdminIcon }]
    : NAV_ITEMS;

  const moreItems = isAdmin
    ? [...MORE_ITEMS, { id: "admin", label: "Admin", Icon: AdminIcon }]
    : MORE_ITEMS;

  const moreActive = moreItems.some((item) => item.id === active);

  return (
    <div className="app-shell">
      {/* ── Desktop sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">j</div>
          <span className="sidebar-logo-text">Invoice</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item${active === id ? " active" : ""}`}
              onClick={() => onNav(id)}
            >
              <span className="nav-icon" style={{ position: "relative" }}>
                <Icon />
                {id === "alerts" && alertCount > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -5,
                    minWidth: 14, height: 14, borderRadius: 7,
                    background: "#ef4444", color: "#fff",
                    fontSize: 9, fontWeight: 700, lineHeight: "14px",
                    textAlign: "center", padding: "0 3px", boxSizing: "border-box",
                    pointerEvents: "none",
                  }}>
                    {alertCount > 99 ? "99+" : alertCount}
                  </span>
                )}
              </span>
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="app-main">{children}</main>

      {/* ── Mobile bottom nav ── */}
      <nav className="mobile-bottom-nav" aria-label="Main navigation">
        {navItems.filter((item) => BOTTOM_PRIMARY.includes(item.id)).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`mobile-nav-btn${active === id ? " active" : ""}`}
            onClick={() => handleNav(id)}
          >
            <span className="mobile-nav-icon" style={{ position: "relative" }}>
              <Icon />
              {id === "alerts" && alertCount > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -5,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: "#ef4444", color: "#fff",
                  fontSize: 9, fontWeight: 700, lineHeight: "14px",
                  textAlign: "center", padding: "0 3px", boxSizing: "border-box",
                  pointerEvents: "none",
                }}>
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </span>
            <span className="mobile-nav-label">{label}</span>
          </button>
        ))}

        {/* More button */}
        <button
          className={`mobile-nav-btn${moreActive || drawerOpen ? " active" : ""}`}
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
        >
          <span className="mobile-nav-icon"><MoreIcon /></span>
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>

      {/* ── More drawer ── */}
      {drawerOpen && (
        <div
          className="mobile-drawer-overlay"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <div className={`mobile-drawer${drawerOpen ? " open" : ""}`} aria-hidden={!drawerOpen}>
        <div className="mobile-drawer-handle" />
        <div className="mobile-drawer-grid">
          {moreItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`mobile-drawer-item${active === id ? " active" : ""}`}
              onClick={() => handleNav(id)}
            >
              <span className="mobile-drawer-icon"><Icon /></span>
              <span className="mobile-drawer-label">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
