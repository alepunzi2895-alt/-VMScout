import { useState, useEffect, useCallback } from "react";
import { useT } from "./i18n/index.jsx";

const GOLD = "#C9A96E";
const CANVA_TEAL = "#00C4CC";
const FB_BLUE = "#4A90E2";
const OFF_WHITE = "#F0EBE3";
const WARM_GREY = "#8A8070";

const REDIRECT_CANVA = "https://vmscout.vercel.app/api/canva-auth";
const REDIRECT_FB = "https://vmscout.vercel.app/api/instagram";

async function api(action, opts = {}) {
  const res = await fetch(`/api/history?action=${action}`, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { res, data };
}

function Card({ children, accent }) {
  return (
    <div style={{ background: "#0C0C0C", border: `1px solid ${accent ? accent + "33" : "#1C1C1C"}`, borderRadius: 20, padding: 24, marginBottom: 20 }}>
      {children}
    </div>
  );
}

function Field({ label, type = "text", value, onChange, placeholder, mono }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 5, fontFamily: "'Space Grotesk', sans-serif" }}>{label}</div>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: "100%", background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 9,
          color: OFF_WHITE, padding: "10px 12px", fontSize: 12, boxSizing: "border-box",
          fontFamily: mono ? "'JetBrains Mono', monospace" : "'Space Grotesk', sans-serif", outline: "none",
        }}
      />
    </div>
  );
}

function Steps({ items, accent }) {
  return (
    <div style={{ marginTop: 8, marginBottom: 16 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
          <span style={{ minWidth: 22, height: 22, borderRadius: "50%", background: accent + "22", border: `1px solid ${accent}44`, color: accent, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
          <div style={{ fontSize: 12.5, color: WARM_GREY, lineHeight: 1.6 }}>{it}</div>
        </div>
      ))}
    </div>
  );
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 5, fontFamily: "'Space Grotesk', sans-serif" }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code style={{ flex: 1, minWidth: 220, background: "#0a0a0a", border: "1px solid #1E1E1E", borderRadius: 8, color: "#B9AE98", padding: "8px 10px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", overflowX: "auto", whiteSpace: "nowrap" }}>{value}</code>
        <button onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: copied ? "#5ABA5A" : GOLD, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap" }}>
          {copied ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const t = useT();
  const [cfg, setCfg] = useState(null);
  const [canvaId, setCanvaId] = useState("");
  const [canvaSecret, setCanvaSecret] = useState("");
  const [fbId, setFbId] = useState("");
  const [fbSecret, setFbSecret] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [canvaStatus, setCanvaStatus] = useState(null);

  const loadCfg = useCallback(async () => {
    const { data } = await api("get_app_config");
    if (data?.ok) {
      setCfg(data);
      setCanvaId(data.canvaClientId || "");
      setFbId(data.fbAppId || "");
    }
  }, []);

  useEffect(() => { loadCfg(); }, [loadCfg]);
  useEffect(() => {
    fetch("/api/canva-auth?action=status").then(r => r.json())
      .then(d => setCanvaStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setCanvaStatus("disconnected"));
  }, []);
  useEffect(() => {
    const onMsg = e => {
      if (e.data === "canva_connected") setCanvaStatus("connected");
      if (e.data === "fb_connected") loadCfg();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [loadCfg]);

  async function save(fields, which) {
    setSavedMsg("");
    const { data } = await api("save_app_config", { method: "POST", body: fields });
    if (data?.ok) {
      setSavedMsg(which);
      setCanvaSecret(""); setFbSecret("");
      loadCfg();
      setTimeout(() => setSavedMsg(""), 2500);
    }
  }

  const canvaConfigured = cfg?.canvaClientId || cfg?.canvaSecretSet || cfg?.source?.canva === "env";
  const fbConfigured = cfg?.fbAppId || cfg?.fbSecretSet || cfg?.source?.fb === "env";

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: OFF_WHITE, fontFamily: "'Space Grotesk', sans-serif", padding: "44px 20px 80px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: GOLD, marginBottom: 10, fontWeight: 600 }}>⚙ {t("nav.settings")}</div>
          <h2 style={{ fontSize: 28, fontWeight: 300, margin: "0 0 6px" }}>{t("set.title")}</h2>
          <div style={{ fontSize: 12.5, color: WARM_GREY, lineHeight: 1.6 }}>{t("set.subtitle")}</div>
        </div>

        {/* ── CANVA ───────────────────────────────── */}
        <Card accent={CANVA_TEAL}>
          <div style={{ fontSize: 14, fontWeight: 600, color: CANVA_TEAL, marginBottom: 4 }}>Canva</div>
          <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.6, marginBottom: 16 }}>{t("set.canva.intro")}</div>

          <Steps accent={CANVA_TEAL} items={[
            <>{t("set.canva.s1")} <a href="https://www.canva.com/developers/apps" target="_blank" rel="noreferrer" style={{ color: CANVA_TEAL }}>canva.com/developers ↗</a></>,
            t("set.canva.s2"),
            t("set.canva.s3"),
            t("set.canva.s4"),
          ]} />

          <CopyRow label={t("set.redirectUrl")} value={REDIRECT_CANVA} />
          <div style={{ fontSize: 11, color: WARM_GREY, marginBottom: 4 }}>{t("set.canva.scopes")}</div>
          <code style={{ display: "block", background: "#0a0a0a", border: "1px solid #1E1E1E", borderRadius: 8, color: "#B9AE98", padding: "8px 10px", fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", marginBottom: 16, overflowX: "auto", whiteSpace: "nowrap" }}>
            design:content:write design:meta:read asset:read asset:write
          </code>

          <Field label="Client ID" value={canvaId} onChange={setCanvaId} placeholder="OC-xxxxxxxxxxxxxxxx" mono />
          <Field label={cfg?.canvaSecretSet ? t("set.secretSet") : "Client Secret"} type="password" value={canvaSecret} onChange={setCanvaSecret} placeholder={cfg?.canvaSecretSet ? "••••••••••••" : "cnvca..."} mono />
          <button onClick={() => save({ canvaClientId: canvaId, ...(canvaSecret ? { canvaClientSecret: canvaSecret } : {}) }, "canva")}
            style={{ padding: "9px 18px", borderRadius: 12, border: `1px solid ${GOLD}45`, background: savedMsg === "canva" ? "#3A7A3A20" : `${GOLD}12`, color: savedMsg === "canva" ? "#5ABA5A" : GOLD, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
            {savedMsg === "canva" ? "✓ " + t("common.save") : t("common.save")}
          </button>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #1A1A1A", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: canvaStatus === "connected" ? "#5ABA5A" : "#888" }}>
              {canvaStatus === "connected" ? "● " + t("canva.connected") : "○ " + t("canva.notConnected")}
            </span>
            {canvaStatus !== "connected" ? (
              <button onClick={() => window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700")}
                disabled={!canvaConfigured}
                style={{ padding: "8px 16px", borderRadius: 12, border: `1px solid ${CANVA_TEAL}45`, background: `${CANVA_TEAL}12`, color: CANVA_TEAL, fontSize: 11, fontWeight: 600, cursor: canvaConfigured ? "pointer" : "not-allowed", opacity: canvaConfigured ? 1 : 0.4, fontFamily: "'Space Grotesk', sans-serif" }}>
                {t("set.canva.connect")}
              </button>
            ) : (
              <button onClick={() => fetch("/api/canva-auth?action=logout").then(() => setCanvaStatus("disconnected"))}
                style={{ padding: "7px 14px", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#666", fontSize: 11, cursor: "pointer" }}>
                {t("common.disconnect")}
              </button>
            )}
          </div>
        </Card>

        {/* ── FACEBOOK / META ─────────────────────── */}
        <Card accent={FB_BLUE}>
          <div style={{ fontSize: 14, fontWeight: 600, color: FB_BLUE, marginBottom: 4 }}>Facebook · Meta Ads</div>
          <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.6, marginBottom: 16 }}>{t("set.fb.intro")}</div>

          <Steps accent={FB_BLUE} items={[
            <>{t("set.fb.s1")} <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" style={{ color: FB_BLUE }}>developers.facebook.com ↗</a></>,
            t("set.fb.s2"),
            t("set.fb.s3"),
            t("set.fb.s4"),
          ]} />

          <CopyRow label={t("set.redirectUrl")} value={REDIRECT_FB} />

          <Field label="App ID" value={fbId} onChange={setFbId} placeholder="1234567890123456" mono />
          <Field label={cfg?.fbSecretSet ? t("set.secretSet") : "App Secret"} type="password" value={fbSecret} onChange={setFbSecret} placeholder={cfg?.fbSecretSet ? "••••••••••••" : "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} mono />
          <button onClick={() => save({ fbAppId: fbId, ...(fbSecret ? { fbAppSecret: fbSecret } : {}) }, "fb")}
            style={{ padding: "9px 18px", borderRadius: 12, border: `1px solid ${GOLD}45`, background: savedMsg === "fb" ? "#3A7A3A20" : `${GOLD}12`, color: savedMsg === "fb" ? "#5ABA5A" : GOLD, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
            {savedMsg === "fb" ? "✓ " + t("common.save") : t("common.save")}
          </button>

          <div style={{ marginTop: 16, fontSize: 11.5, color: WARM_GREY, lineHeight: 1.6 }}>
            {t("set.fb.tokenNote")}
          </div>
        </Card>

        <div style={{ fontSize: 10.5, color: "#555", lineHeight: 1.6, textAlign: "center" }}>{t("set.privacy")}</div>
      </div>
    </div>
  );
}
