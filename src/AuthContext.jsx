import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { userLS } from "./userStorage.js";

const AuthContext = createContext(null);

export const LANGS = ["it", "en", "es", "fr", "de"];
const clampLang = (l) => (LANGS.includes(String(l)) ? String(l) : "it");

function guessLang() {
  try {
    const saved = localStorage.getItem("vms_lang");
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* ignore */ }
  const nav = (navigator.language || "it").slice(0, 2).toLowerCase();
  return clampLang(nav);
}

async function api(action, { method = "GET", body } = {}) {
  const res = await fetch(`/api/history?action=${action}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { res, data };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState(guessLang);

  // stato iniziale: chi sono?
  useEffect(() => {
    let alive = true;
    api("auth_me").then(({ data }) => {
      if (!alive) return;
      if (data?.user) {
        setUser(data.user);
        setLangState(clampLang(data.user.lang));
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("vms_lang", lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l) => {
    const v = clampLang(l);
    setLangState(v);
    if (user) api("auth_set_lang", { method: "POST", body: { lang: v } }).catch(() => {});
  }, [user]);

  const login = useCallback(async (nickname, password) => {
    const { res, data } = await api("auth_login", { method: "POST", body: { nickname, password } });
    if (!res.ok) { const e = new Error(data.error || "LOGIN_FAILED"); e.code = data.error; throw e; }
    setUser(data.user);
    setLangState(clampLang(data.user.lang));
    return data.user;
  }, []);

  const register = useCallback(async (nickname, password) => {
    const { res, data } = await api("auth_register", { method: "POST", body: { nickname, password, lang } });
    if (!res.ok) { const e = new Error(data.error || "REGISTER_FAILED"); e.code = data.error; throw e; }
    setUser(data.user);
    return data;
  }, [lang]);

  const logout = useCallback(async () => {
    await api("auth_logout", { method: "POST" }).catch(() => {});
    // ripulisce la cache progetti locale dell'utente uscente
    try {
      if (user?.id) {
        localStorage.removeItem(`vmscout_brands_${user.id}`);
        localStorage.removeItem(`vmscout_active_brand_${user.id}`);
      }
      // chiavi legacy non namespacizzate
      localStorage.removeItem("vmscout_brands");
      localStorage.removeItem("vmscout_active_brand");
      // connessioni Analytics / Meta Ads (token IG, cache post, sponsorizzate…)
      userLS.clearFor(user?.id);
    } catch { /* ignore */ }
    setUser(null);
  }, [user]);

  // chiamato da BrandContext quando /api/history restituisce 401 (sessione persa)
  const onSessionLost = useCallback(() => setUser(null), []);

  return (
    <AuthContext.Provider value={{ user, loading, lang, setLang, login, register, logout, onSessionLost }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
