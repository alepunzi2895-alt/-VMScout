import { useState, useRef, useEffect } from "react";
import { BrandProvider, useBrand } from "./BrandContext.jsx";
import Home from "./Home.jsx";
import VisualMarketingScout from "./App.jsx";
import InstagramAnalytics from "./InstagramAnalytics.jsx";
import CanvaStudio from "./CanvaStudio.jsx";

const GOLD = "#C9A96E";

const TABS = [
  { id: "home", label: "Home", icon: "◈" },
  { id: "vmscout", label: "Visual Scout", icon: "🎯" },
  { id: "instagram", label: "Analytics", icon: "📊" },
  { id: "canva", label: "Canva Studio", icon: "✦" },
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
      background: "#050505", borderBottom: "1px solid rgba(201,169,110,0.12)",
      height: 44,
    }}>
      {/* Logo */}
      <div style={{
        fontSize: 10, letterSpacing: "0.32em", textTransform: "uppercase",
        color: GOLD, fontFamily: "'Montserrat', sans-serif", fontWeight: 600,
        padding: "0 16px", flexShrink: 0,
      }}>
        ◈ VMScout
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", flex: 1, height: "100%", overflowX: "auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveApp(tab.id)}
            style={{
              padding: "0 14px", height: "100%",
              border: "none",
              borderBottom: activeApp === tab.id ? `2px solid ${GOLD}` : "2px solid transparent",
              background: "transparent",
              color: activeApp === tab.id ? GOLD : "#555",
              fontSize: 11, fontWeight: activeApp === tab.id ? 600 : 400,
              cursor: "pointer", fontFamily: "'Montserrat', sans-serif",
              letterSpacing: "0.07em", transition: "color 0.2s",
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
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: GOLD, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "#000", fontFamily: "'Montserrat', sans-serif",
            }}>
              {activeBrand.name[0].toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "#A0988E", fontFamily: "'Montserrat', sans-serif", fontWeight: 500, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeBrand.name}
            </span>
            <span style={{ fontSize: 8, color: "#555" }}>▾</span>
          </button>

          {menuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              background: "#0E0E0E", border: "1px solid #1E1E1E",
              borderRadius: 12, padding: 8, minWidth: 190,
              boxShadow: "0 8px 32px rgba(0,0,0,0.55)", zIndex: 1001,
            }}>
              {brands.map(brand => (
                <button key={brand.id}
                  onClick={() => { setActiveBrandId(brand.id); setMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 9,
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "none", background: brand.id === activeBrandId ? `${GOLD}12` : "transparent",
                    cursor: "pointer", textAlign: "left", transition: "background 0.15s",
                  }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: brand.id === activeBrandId ? GOLD : "#1E1E1E",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700,
                    color: brand.id === activeBrandId ? "#000" : "#666",
                    fontFamily: "'Montserrat', sans-serif",
                  }}>
                    {brand.name[0].toUpperCase()}
                  </div>
                  <span style={{ fontSize: 12, color: brand.id === activeBrandId ? "#E8E0D8" : "#666", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
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
    </div>
  );
}

function AppContent() {
  const [activeApp, setActiveApp] = useState("home");
  const { activeBrand } = useBrand();

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav activeApp={activeApp} setActiveApp={setActiveApp} />
      <div style={{ paddingTop: 44 }}>
        {activeApp === "home" && <Home onNavigate={setActiveApp} />}
        {activeApp === "vmscout" && <VisualMarketingScout brand={activeBrand} />}
        {activeApp === "instagram" && <InstagramAnalytics brand={activeBrand} />}
        {activeApp === "canva" && <CanvaStudio />}
      </div>
    </div>
  );
}

export default function AppRouter() {
  return (
    <BrandProvider>
      <AppContent />
    </BrandProvider>
  );
}
