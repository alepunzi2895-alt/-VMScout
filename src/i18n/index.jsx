import { createContext, useContext, useMemo } from "react";
import { useAuth } from "../AuthContext.jsx";
import { STRINGS } from "./strings.js";

const LangCtx = createContext({ lang: "it", t: (k) => k });

export const LOCALE_TAG = { it: "it-IT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE" };

// t("home.hero.title") · t("video.recording", { n: 1, total: 3 })
function makeT(lang) {
  const dict = STRINGS[lang] || STRINGS.it;
  const fallback = STRINGS.it;
  return (key, vars) => {
    let s = dict[key];
    if (s == null) s = fallback[key];
    if (s == null) return key;
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  };
}

export function LangProvider({ children }) {
  const { lang } = useAuth();
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
export const useT = () => useContext(LangCtx).t;

// ─── formatters localizzati ───────────────────────────────────────
export function fmtDate(d, lang = "it") {
  try { return new Date(d).toLocaleDateString(LOCALE_TAG[lang] || "it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(d ?? ""); }
}
export function fmtDateTime(d, lang = "it") {
  try { return new Date(d).toLocaleString(LOCALE_TAG[lang] || "it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(d ?? ""); }
}
export function fmtNum(n, lang = "it") {
  try { return new Intl.NumberFormat(LOCALE_TAG[lang] || "it-IT").format(n); }
  catch { return String(n ?? ""); }
}

const WEEKDAYS = {
  it: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  es: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
  fr: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
};
export const weekdaysShort = (lang = "it") => WEEKDAYS[lang] || WEEKDAYS.it;
