import { useState } from "react";
import VisualMarketingScout from "./App.jsx";
import LuxyExperience from "./LuxyExperience.jsx";

const GOLD = "#C9A96E";

export default function AppRouter() {
  const [activeApp, setActiveApp] = useState("vmscout");

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Navigation Bar */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
        display: "flex", alignItems: "center", gap: 0,
        background: "#050505", borderBottom: "1px solid rgba(201,169,110,0.2)",
        height: 44, paddingLeft: 16, paddingRight: 16
      }}>
        {/* Logo */}
        <div style={{ fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: GOLD, fontFamily: "'Montserrat', sans-serif", fontWeight: 600, marginRight: 24 }}>
          ◈ VMScout
        </div>

        {/* Nav items */}
        {[
          { id: "vmscout", label: "Visual Marketing Scout", icon: "📸" },
          { id: "luxy", label: "Luxy Experience", icon: "✦" },
        ].map(app => (
          <button key={app.id} onClick={() => setActiveApp(app.id)}
            style={{
              padding: "0 18px", height: "100%",
              border: "none",
              borderBottom: activeApp === app.id ? `2px solid ${GOLD}` : "2px solid transparent",
              background: "transparent",
              color: activeApp === app.id ? GOLD : "#888",
              fontSize: 11, fontWeight: activeApp === app.id ? 600 : 400,
              cursor: "pointer", fontFamily: "'Montserrat', sans-serif",
              letterSpacing: "0.08em", transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: 6
            }}>
            <span>{app.icon}</span>
            <span>{app.label}</span>
            {app.id === "luxy" && (
              <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: `${GOLD}20`, color: GOLD, marginLeft: 2 }}>NEW</span>
            )}
          </button>
        ))}
      </div>

      {/* App Content — push down by navbar height */}
      <div style={{ paddingTop: 44 }}>
        {activeApp === "vmscout" && <VisualMarketingScout />}
        {activeApp === "luxy" && <LuxyExperience />}
      </div>
    </div>
  );
}
