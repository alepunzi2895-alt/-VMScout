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

// Azzera SOLO lo spazio namespacizzato di un utente (al logout).
// Le chiavi legacy NON namespacizzate non si toccano qui: le adotta
// `migrateLegacyKeys()` al primo mount del pannello, così un utente che
// aggiorna l'app non perde la connessione Analytics già attiva.
userLS.clearFor = function clearFor(uid) {
  try {
    const p = prefix(uid);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(p)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
};

// Migrazione una-tantum: le vecchie chiavi non namespacizzate (`ig_token`,
// `fb_ads_list`, …) create prima del multiutente vengono SPOSTATE nello spazio
// dell'utente corrente (copiate in `u_<uid>_<k>` e poi rimosse dalla chiave
// nuda). Idempotente: dopo il primo giro non c'è più nulla da spostare.
// Va chiamata PRIMA di leggere lo stato (initializer di useState).
export function migrateLegacyKeys(uid, keys) {
  try {
    const p = prefix(uid);
    for (const k of keys) {
      const bare = localStorage.getItem(k);
      if (bare == null) continue;
      if (localStorage.getItem(p + k) == null) localStorage.setItem(p + k, bare);
      localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}
