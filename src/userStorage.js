// localStorage namespacizzato per utente.
//
// Ogni utente registrato ha il suo spazio: le connessioni Analytics (token IG,
// account, cache post/analisi) e le sponsorizzate Meta vivono sotto la chiave
// `u_<uid>_<key>` così che un nuovo utente non veda mai i collegamenti di un
// altro. Prima del login si usa `u_anon_` (spazio usa-e-getta).
//
// Uso:
//   const uls = userLS(user?.id);
//   uls.get("ig_token");            // string | ""
//   uls.set("ig_token", token);
//   uls.getJSON("ig_posts", []);
//   uls.setJSON("ig_posts", posts); // null/undefined => remove
//   uls.remove("ig_token");
//   userLS.clearFor(uid);           // logout: azzera tutto lo spazio dell'utente

const prefix = (uid) => `u_${uid || "anon"}_`;

export function userLS(uid) {
  const p = prefix(uid);
  return {
    key: (k) => p + k,
    get(k) {
      try { return localStorage.getItem(p + k) || ""; } catch { return ""; }
    },
    set(k, v) {
      try {
        if (v == null || v === "") localStorage.removeItem(p + k);
        else localStorage.setItem(p + k, String(v));
      } catch { /* ignore */ }
    },
    getJSON(k, fallback) {
      try {
        const v = localStorage.getItem(p + k);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },
    setJSON(k, v) {
      try {
        if (v == null) localStorage.removeItem(p + k);
        else localStorage.setItem(p + k, JSON.stringify(v));
      } catch { /* ignore */ }
    },
    remove(k) {
      try { localStorage.removeItem(p + k); } catch { /* ignore */ }
    },
  };
}

// Chiavi legacy (pre-multiutente) non namespacizzate: vanno ripulite al logout
// perché altrimenti il prossimo utente le erediterebbe.
const LEGACY_KEYS = [
  "ig_token", "ig_account_id", "ig_username", "ig_profile_pic",
  "ig_analysis_json", "ig_posts", "ig_account",
  "fb_ad_account", "fb_ads_list", "fb_ads_fetched_at", "fb_ads_date", "fb_ads_analysis",
];

// Azzera tutto lo spazio di un utente + le chiavi legacy condivise.
userLS.clearFor = function clearFor(uid) {
  try {
    const p = prefix(uid);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(p)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
};
