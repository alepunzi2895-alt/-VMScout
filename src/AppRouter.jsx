import { useState, useRef, useEffect } from "react";
import { BrandProvider, useBrand } from "./BrandContext.jsx";
import { AuthProvider, useAuth, LANGS } from "./AuthContext.jsx";
import LoginScreen from "./LoginScreen.jsx";
import Home from "./Home.jsx";
import VisualMarketingScout from "./App.jsx";
import InstagramAnalytics from "./InstagramAnalytics.jsx";
import CanvaStudio from "./CanvaStudio.jsx";
import Dashboard from "./Dashboard.jsx";
import CanvaMark from "./CanvaMark.jsx";
import BrandAvatar from "./BrandAvatar.jsx";

const GOLD = "#C9A96E";
const FLAGS = { it: "🇮🇹", en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪" };

const TABS = [
  { id: "home", label: "Home", icon: "◈" },
  { id: "vmscout", label: "Visual Scout", icon: "🎯" },
  { id: "instagram", label: "Analytics", icon: "📊" },
  { id: "canva", label: "Canva Studio", icon: <CanvaMark size={14} /> },
  { id: "dashboard", label: "Dashboard", icon: "🧭" },
];

function Nav({ activeApp, setActiveApp }) {
  const { brands, activeBrand, activeBrandId, setActiveBrandId } = useBrand();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
      display: "flex", alignItems: "center",
      background: "rgba(8,8,10,0.72)",
      backdropFilter: "blur(16px) saturate(160%)",
      WebkitBackdropFilter: "blur(16px) saturate(160%)",
      borderBottom: "1px solid rgba(201,169,110,0.14)",
      boxShadow: "0 1px 0 rgba(255,255,255,0.03), 0 10px 30px -18px rgba(201,169,110,0.35)",
      height: 46,
    }}>
      {/* Logo */}
      <div style={{
        fontSize: 10, letterSpacing: "0.32em", textTransform: "uppercase",
        color: GOLD, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
        padding: "0 16px", flexShrink: 0,
        textShadow: "0 0 18px rgba(201,169,110,0.45)",
      }}>
        ◈ VMScout
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", flex: 1, height: "100%", overflowX: "auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveApp(tab.id)}
            style={{
              padding: "0 15px", height: "100%",
              border: "none",
              borderBottom: activeApp === tab.id ? `2px solid ${GOLD}` : "2px solid transparent",
              background: activeApp === tab.id ? "linear-gradient(180deg, transparent, rgba(201,169,110,0.10))" : "transparent",
              color: activeApp === tab.id ? GOLD : "#5c5c5c",
              fontSize: 11, fontWeight: activeApp === tab.id ? 600 : 400,
              cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: "0.07em",
              textShadow: activeApp === tab.id ? "0 0 16px rgba(201,169,110,0.5)" : "none",
              display: "flex", alignItems: "center", gap: 5,
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Project switcher */}
      {activeBrand && (
        <div ref={menuRef} style={{ position: "relative", marginRight: 12, flexShrink: 0 }}>
          <button onClick={() => setMenuOpen(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "3px 10px 3px 4px", borderRadius: 20,
              border: `1px solid ${menuOpen ? GOLD + "45" : "rgba(201,169,110,0.18)"}`,
              background: menuOpen ? `${GOLD}08` : "transparent",
              cursor: "pointer", transition: "all 0.2s",
            }}>
            <BrandAvatar brand={activeBrand} size={24} radius={12} />
            <span style={{ fontSize: 11, color: "#A0988E", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeBrand.name}
            </span>
            <span style={{ fontSize: 8, color: "#555" }}>▾</span>
          </button>

          {menuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              background: "#0E0E0E", border: "1px solid #1E1E1E",
              borderRadius: 16, padding: 8, minWidth: 190,
              boxShadow: "0 8px 32px rgba(0,0,0,0.55)", zIndex: 1001,
            }}>
              {brands.map(brand => (
                <button key={brand.id}
                  onClick={() => { setActiveBrandId(brand.id); setMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 9,
                    width: "100%", padding: "8px 10px", borderRadius: 12,
                    border: "none", background: brand.id === activeBrandId ? `${GOLD}12` : "transparent",
                    cursor: "pointer", textAlign: "left", transition: "background 0.15s",
                  }}>
                  <BrandAvatar brand={brand} size={24} radius={12} active={brand.id === activeBrandId} />
                  <span style={{ fontSize: 12, color: brand.id === activeBrandId ? "#E8E0D8" : "#666", fontFamily: "'Space Grotesk', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {brand.name}
                  </span>
                  {brand.id === activeBrandId && (
                    <span style={{ fontSize: 9, color: GOLD, marginLeft: "auto" }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <UserMenu />
    </div>
  );
}

function UserMenu() {
  const { user, lang, setLang, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!user) return null;
  return (
    <div ref={ref} style={{ position: "relative", marginRight: 12, flexShrink: 0 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 20,
          border: `1px solid ${open ? GOLD + "45" : "rgba(201,169,110,0.18)"}`, background: open ? `${GOLD}08` : "transparent", cursor: "pointer" }}>
        <span style={{ fontSize: 12 }}>{FLAGS[lang]}</span>
        <span style={{ fontSize: 11, color: "#A0988E", fontFamily: "'Space Grotesk', sans-serif", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.nickname}</span>
        <span style={{ fontSize: 8, color: "#555" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#0E0E0E", border: "1px solid #1E1E1E", borderRadius: 16, padding: 8, minWidth: 160, boxShadow: "0 8px 32px rgba(0,0,0,0.55)", zIndex: 1001 }}>
          <div style={{ display: "flex", gap: 4, padding: "4px 4px 8px", flexWrap: "wrap" }}>
            {LANGS.map(l => (
              <button key={l} onClick={() => setLang(l)}
                style={{ padding: "4px 7px", borderRadius: 9, border: `1px solid ${lang === l ? GOLD + "55" : "#262626"}`, background: lang === l ? GOLD + "14" : "transparent", cursor: "pointer", fontSize: 13 }}>
                {FLAGS[l]}
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); logout(); }}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "none", background: "transparent", color: "#C4704F", cursor: "pointer", textAlign: "left", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif" }}>
            ↩ Esci
          </button>
        </div>
      )}
    </div>
  );
}

function AppContent() {
  const [activeApp, setActiveApp] = useState("home");
  const [pendingBrief, setPendingBrief] = useState(null);
  const { activeBrand } = useBrand();

  // Handoff da Analytics: un'idea "prossimo post" passa qui il brief già pronto,
  // noi cambiamo tab e VisualMarketingScout lo invia da solo appena montato.
  function goToScoutWithBrief(brief) {
    setPendingBrief(brief);
    setActiveApp("vmscout");
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav activeApp={activeApp} setActiveApp={setActiveApp} />
      <div style={{ paddingTop: 46 }}>
        {activeApp === "home" && <Home onNavigate={setActiveApp} />}
        {activeApp === "vmscout" && (
          <VisualMarketingScout brand={activeBrand} initialBrief={pendingBrief} onConsumeInitialBrief={() => setPendingBrief(null)} />
        )}
        {activeApp === "instagram" && <InstagramAnalytics brand={activeBrand} onSuggestBrief={goToScoutWithBrief} />}
        {activeApp === "canva" && <CanvaStudio />}
        {activeApp === "dashboard" && <Dashboard brand={activeBrand} onSuggestBrief={goToScoutWithBrief} />}
      </div>
    </div>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0A0A0A", color: GOLD, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.3em", fontSize: 11 }}>
        ◈ VMSCOUT
      </div>
    );
  }
  if (!user) return <LoginScreen />;
  return (
    <BrandProvider>
      <AppContent />
    </BrandProvider>
  );
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
