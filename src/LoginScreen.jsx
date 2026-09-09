import { useState } from "react";
import { useAuth, LANGS } from "./AuthContext.jsx";
import Flag from "./Flag.jsx";

const GOLD = "#C9A96E";

// Etichette localizzate della schermata di accesso (le uniche stringhe che
// servono prima di conoscere l'utente; il resto dell'i18n arriva dopo il login).
const T = {
  it: { tagline: "Strategia visiva. Zero compromessi.", login: "Accedi", register: "Registrati", nickname: "Nickname", password: "Password", have: "Hai già un account?", noacc: "Non hai un account?", go: "Entra", create: "Crea account", wait: "Un attimo…",
    e_INVALID_NICKNAME: "Nickname non valido (2–32 caratteri).", e_INVALID_PASSWORD: "La password deve avere almeno 6 caratteri.", e_NICKNAME_TAKEN: "Nickname già in uso.", e_BAD_CREDENTIALS: "Nickname o password errati.", e_BAD_ORIGIN: "Richiesta bloccata.", e_generic: "Qualcosa è andato storto. Riprova." },
  en: { tagline: "Visual strategy. Zero compromise.", login: "Log in", register: "Sign up", nickname: "Nickname", password: "Password", have: "Already have an account?", noacc: "No account yet?", go: "Enter", create: "Create account", wait: "One moment…",
    e_INVALID_NICKNAME: "Invalid nickname (2–32 characters).", e_INVALID_PASSWORD: "Password must be at least 6 characters.", e_NICKNAME_TAKEN: "Nickname already taken.", e_BAD_CREDENTIALS: "Wrong nickname or password.", e_BAD_ORIGIN: "Request blocked.", e_generic: "Something went wrong. Try again." },
  es: { tagline: "Estrategia visual. Cero concesiones.", login: "Iniciar sesión", register: "Registrarse", nickname: "Apodo", password: "Contraseña", have: "¿Ya tienes cuenta?", noacc: "¿Aún no tienes cuenta?", go: "Entrar", create: "Crear cuenta", wait: "Un momento…",
    e_INVALID_NICKNAME: "Apodo no válido (2–32 caracteres).", e_INVALID_PASSWORD: "La contraseña debe tener al menos 6 caracteres.", e_NICKNAME_TAKEN: "Apodo ya en uso.", e_BAD_CREDENTIALS: "Apodo o contraseña incorrectos.", e_BAD_ORIGIN: "Solicitud bloqueada.", e_generic: "Algo salió mal. Inténtalo de nuevo." },
  fr: { tagline: "Stratégie visuelle. Zéro compromis.", login: "Se connecter", register: "S'inscrire", nickname: "Pseudo", password: "Mot de passe", have: "Vous avez déjà un compte ?", noacc: "Pas encore de compte ?", go: "Entrer", create: "Créer un compte", wait: "Un instant…",
    e_INVALID_NICKNAME: "Pseudo invalide (2 à 32 caractères).", e_INVALID_PASSWORD: "Le mot de passe doit comporter au moins 6 caractères.", e_NICKNAME_TAKEN: "Pseudo déjà pris.", e_BAD_CREDENTIALS: "Pseudo ou mot de passe incorrect.", e_BAD_ORIGIN: "Requête bloquée.", e_generic: "Une erreur est survenue. Réessayez." },
  de: { tagline: "Visuelle Strategie. Null Kompromisse.", login: "Anmelden", register: "Registrieren", nickname: "Nickname", password: "Passwort", have: "Schon ein Konto?", noacc: "Noch kein Konto?", go: "Los", create: "Konto erstellen", wait: "Einen Moment…",
    e_INVALID_NICKNAME: "Ungültiger Nickname (2–32 Zeichen).", e_INVALID_PASSWORD: "Das Passwort muss mindestens 6 Zeichen haben.", e_NICKNAME_TAKEN: "Nickname bereits vergeben.", e_BAD_CREDENTIALS: "Falscher Nickname oder falsches Passwort.", e_BAD_ORIGIN: "Anfrage blockiert.", e_generic: "Etwas ist schiefgelaufen. Bitte erneut versuchen." },
};
export default function LoginScreen() {
  const { lang, setLang, login, register } = useAuth();
  const t = T[lang] || T.it;
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
      setErr(t["e_" + ex.code] || t.e_generic);
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
          <div style={{ fontSize: 13, color: "#8B7355", marginTop: 8, fontFamily: "'Space Grotesk', sans-serif" }}>{t.tagline}</div>
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
                {m === "login" ? t.login : t.register}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={t.nickname}
              autoComplete="username" autoCapitalize="none" spellCheck={false} style={field} />
            <input value={password} onChange={e => setPassword(e.target.value)} placeholder={t.password}
              type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} style={field} />

            {err && <div style={{ fontSize: 12, color: "#E47070", marginBottom: 10, lineHeight: 1.4 }}>{err}</div>}

            <button type="submit" disabled={busy || !nickname.trim() || !password}
              style={{ width: "100%", padding: "11px", borderRadius: 12, border: "none", cursor: busy ? "wait" : "pointer",
                background: GOLD, color: "#1A160E", fontSize: 13, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
                opacity: busy || !nickname.trim() || !password ? 0.55 : 1 }}>
              {busy ? t.wait : mode === "register" ? t.create : t.go}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 12, fontSize: 11.5, color: "#666" }}>
            {mode === "login" ? t.noacc : t.have}{" "}
            <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}
              style={{ background: "none", border: "none", color: GOLD, cursor: "pointer", fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", padding: 0 }}>
              {mode === "login" ? t.register : t.login}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
