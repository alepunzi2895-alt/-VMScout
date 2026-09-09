import { useState } from "react";
import { useAuth, LANGS } from "./AuthContext.jsx";
import { useT } from "./i18n/index.jsx";
import Flag from "./Flag.jsx";

const GOLD = "#C9A96E";

export default function LoginScreen() {
  const { lang, setLang, login, register } = useAuth();
  const t = useT();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "register") await register(nickname.trim(), password);
      else await login(nickname.trim(), password);
    } catch (ex) {
      const key = `auth.err.${ex.code}`;
      setErr(t(key) === key ? t("auth.err.generic") : t(key));
    } finally {
      setBusy(false);
    }
  }

  const field = {
    width: "100%", background: "#141414", border: "1px solid #262626", borderRadius: 12,
    padding: "11px 13px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif",
    marginBottom: 10, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "radial-gradient(1200px 600px at 50% -10%, rgba(201,169,110,0.08), transparent), #0A0A0A" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.34em", textTransform: "uppercase", color: GOLD, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 0 22px rgba(201,169,110,0.45)" }}>◈ VMScout</div>
          <div style={{ fontSize: 13, color: "#8B7355", marginTop: 8, fontFamily: "'Space Grotesk', sans-serif" }}>{t("auth.tagline")}</div>
        </div>

        <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 16 }}>
          {LANGS.map(l => (
            <button key={l} type="button" onClick={() => setLang(l)} title={l.toUpperCase()}
              style={{ display: "flex", alignItems: "center", padding: "5px 7px", borderRadius: 9, border: `1px solid ${lang === l ? GOLD + "77" : "#262626"}`, background: lang === l ? GOLD + "1c" : "transparent", cursor: "pointer" }}>
              <Flag code={l} size={20} />
            </button>
          ))}
        </div>

        <div style={{ background: "#0E0E0E", border: "1px solid #1E1E1E", borderRadius: 18, padding: 20 }}>
          <div style={{ display: "flex", gap: 4, padding: 3, background: "rgba(201,169,110,0.06)", borderRadius: 12, marginBottom: 16 }}>
            {["login", "register"].map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); setErr(""); }}
                style={{ flex: 1, padding: "7px 10px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
                  background: mode === m ? "#FBF8F3" : "transparent", color: mode === m ? "#2C2418" : "#8B7355" }}>
                {m === "login" ? t("auth.login") : t("auth.register")}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={t("auth.nickname")}
              autoComplete="username" autoCapitalize="none" spellCheck={false} style={field} />
            <input value={password} onChange={e => setPassword(e.target.value)} placeholder={t("auth.password")}
              type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} style={field} />

            {err && <div style={{ fontSize: 12, color: "#E47070", marginBottom: 10, lineHeight: 1.4 }}>{err}</div>}

            <button type="submit" disabled={busy || !nickname.trim() || !password}
              style={{ width: "100%", padding: "11px", borderRadius: 12, border: "none", cursor: busy ? "wait" : "pointer",
                background: GOLD, color: "#1A160E", fontSize: 13, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
                opacity: busy || !nickname.trim() || !password ? 0.55 : 1 }}>
              {busy ? t("common.loading") : mode === "register" ? t("auth.createAccount") : t("auth.go")}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 12, fontSize: 11.5, color: "#666" }}>
            {mode === "login" ? t("auth.noacc") : t("auth.have")}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}
              style={{ background: "none", border: "none", color: GOLD, cursor: "pointer", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", padding: 0 }}>
              {mode === "login" ? t("auth.register") : t("auth.login")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
