import { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext.jsx";

const BrandContext = createContext(null);

// Chiavi localStorage per-utente (evita che su un browser condiviso l'utente B
// veda in cache i progetti dell'utente A).
const brandsKey = (uid) => `vmscout_brands_${uid}`;
const activeKey = (uid) => `vmscout_active_brand_${uid}`;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const DEFAULT_NAME = "Il Mio Brand";

const newBrand = (name = DEFAULT_NAME) => ({
  id: uid(),
  name,
  sector: "",
  description: "",
  tone: "",
  language: "it",
  instagramHandle: "",
  hashtags: "",
  logo: "",            // data URL (immagine/logo del progetto, ridimensionata client-side)
  canvaTemplates: { post: "", story: "", reel: "", carousel: "" },
  createdAt: new Date().toISOString(),
});

// Un progetto "ha contenuto" se l'utente ci ha messo qualcosa: profilo, logo o
// almeno un template Canva.
function hasContent(b) {
  return !isPristine(b) || !!b?.logo || Object.values(b?.canvaTemplates || {}).some(Boolean);
}

// Vale la pena persistere / mostrare un progetto solo se ha contenuto oppure se
// l'utente l'ha rinominato. Il progetto di default vuoto ("Il Mio Brand" senza
// nulla dentro) NON va salvato sul DB né ripescato: altrimenti ogni browser/
// dispositivo nuovo ne crea uno e la lista si riempie di progetti fantasma.
function isMeaningful(b) {
  return hasContent(b) || (!!b?.name && b.name !== DEFAULT_NAME);
}

// Collassa più "Il Mio Brand" vuoti in uno solo (ripulisce localStorage già
// inquinati da versioni precedenti).
function dedupeEmptyDefaults(list) {
  if (!Array.isArray(list) || !list.length) return null;
  let keptEmpty = false;
  const out = [];
  for (const b of list) {
    if (b?.name === DEFAULT_NAME && !hasContent(b)) {
      if (keptEmpty) continue;
      keptEmpty = true;
    }
    out.push(b);
  }
  return out;
}

function loadBrands(uid) {
  try {
    const s = localStorage.getItem(brandsKey(uid));
    if (s) return JSON.parse(s);
  } catch {}
  return null;
}

// Un fetch che, su 401, notifica la perdita di sessione e restituisce null.
function makeAuthedFetch(onSessionLost) {
  return async (url, opts) => {
    const r = await fetch(url, opts);
    if (r.status === 401) { onSessionLost?.(); return null; }
    return r;
  };
}

// Persistenza server-side (Turso) dei progetti — fire-and-forget: localStorage
// resta la fonte di verità immediata/offline, il DB è lo storico durevole
// (sopravvive a un browser diverso o alla cancellazione della cache).
function syncProjectToDb(afetch, brand) {
  afetch("/api/history?action=save_project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save_project",
      id: brand.id,
      name: brand.name,
      sector: brand.sector,
      description: brand.description,
      tone: brand.tone,
      instagramHandle: brand.instagramHandle,
      hashtags: brand.hashtags,
      logo: brand.logo || "",
      canvaTemplates: brand.canvaTemplates,
    }),
  }).catch(err => console.warn("[BrandContext] sync progetto fallita:", err?.message));
}

function deleteProjectFromDb(afetch, id) {
  afetch("/api/history?action=delete_project", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(err => console.warn("[BrandContext] delete progetto fallita:", err?.message));
}

// Rimuove dal DB i progetti-fantasma: default vuoti, senza alcun dato associato
// (nessuna richiesta AI, nessun insight, nessun design). Safe: tocca solo righe
// prive di contenuto E di storico.
function cleanupEmptyProjectsOnDb(afetch) {
  afetch("/api/history?action=cleanup_empty_projects", { method: "POST" })
    .then(r => r && r.json())
    .then(d => { if (d?.deleted) console.info(`[BrandContext] rimossi ${d.deleted} progetti vuoti dal DB`); })
    .catch(() => {});
}

function isPristine(b) {
  return !b?.sector && !b?.description && !b?.tone && !b?.instagramHandle && !b?.hashtags;
}

export function BrandProvider({ children }) {
  const { user, lang, onSessionLost } = useAuth();
  const uid = user?.id || "anon";
  const afetch = makeAuthedFetch(onSessionLost);

  const [brands, setBrands] = useState(() => dedupeEmptyDefaults(loadBrands(uid)) || [newBrand()]);
  const [activeBrandId, setActiveBrandId] = useState(
    () => { try { return localStorage.getItem(activeKey(uid)) || null; } catch { return null; } }
  );

  useEffect(() => {
    try { localStorage.setItem(brandsKey(uid), JSON.stringify(brands)); } catch {}
  }, [brands, uid]);

  useEffect(() => {
    try { if (activeBrandId) localStorage.setItem(activeKey(uid), activeBrandId); } catch {}
  }, [activeBrandId, uid]);

  // Se il progetto attivo non esiste più (dedup, cancellazione da un altro
  // dispositivo, ecc.) riporta la selezione su un progetto reale.
  useEffect(() => {
    if (activeBrandId && brands.length && !brands.some(b => b.id === activeBrandId)) {
      setActiveBrandId(brands[0].id);
    }
  }, [brands, activeBrandId]);

  // Sincronizza sul DB SOLO i progetti che hanno senso persistere (contenuto o
  // rinominati). Il progetto di default vuoto non va mai sul DB: era la causa
  // dei "progetti fantasma" (ogni browser nuovo ne creava e caricava uno).
  useEffect(() => {
    brands.filter(isMeaningful).forEach(b => syncProjectToDb(afetch, b));
    cleanupEmptyProjectsOnDb(afetch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Al primo avvio recupera i progetti salvati sul DB e integra quelli non
  // ancora presenti in locale (da un altro browser/dispositivo). Scarta i
  // default vuoti storici. Se questo dispositivo non aveva ancora nulla di suo,
  // rende attivo il primo progetto reale trovato.
  useEffect(() => {
    const wasFreshDevice = !activeBrandId && brands.length === 1 && !isMeaningful(brands[0]);
    afetch("/api/history?action=projects")
      .then(r => r && r.json())
      .then(d => {
        if (!d || !d.ok || !d.data?.length) return;
        setBrands(prev => {
          const known = new Set(prev.map(b => b.id));
          const remoteOnly = d.data
            .filter(row => !known.has(row.id))
            .map(row => ({
              id: row.id,
              name: row.name,
              sector: row.sector || "",
              description: row.description || "",
              tone: row.tone || "",
              language: "it",
              instagramHandle: row.instagram_handle || "",
              hashtags: row.hashtags || "",
              logo: row.logo || "",
              canvaTemplates: (() => { try { return { post: "", story: "", reel: "", carousel: "", ...JSON.parse(row.canva_templates || "{}") }; } catch { return { post: "", story: "", reel: "", carousel: "" }; } })(),
              createdAt: row.created_at,
            }))
            .filter(isMeaningful);
          if (!remoteOnly.length) return prev;
          if (wasFreshDevice) setActiveBrandId(remoteOnly[0].id);
          return dedupeEmptyDefaults([...prev, ...remoteOnly]);
        });
      })
      .catch(err => console.warn("[BrandContext] fetch progetti da DB fallita:", err?.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const activeBrand = brands.find(b => b.id === activeBrandId) || brands[0];

  function createBrand(name) {
    const b = newBrand(name);
    setBrands(p => [...p, b]);
    setActiveBrandId(b.id);
    if (isMeaningful(b)) syncProjectToDb(afetch, b);
    return b;
  }

  function updateBrand(id, updates) {
    let updated = null;
    setBrands(p => p.map(b => {
      if (b.id !== id) return b;
      updated = { ...b, ...updates };
      return updated;
    }));
    if (updated) syncProjectToDb(afetch, updated);
  }

  function deleteBrand(id) {
    setBrands(p => {
      const next = p.filter(b => b.id !== id);
      if (activeBrandId === id && next.length) setActiveBrandId(next[0].id);
      return next.length ? next : [newBrand()];
    });
    deleteProjectFromDb(afetch, id);
  }

  return (
    <BrandContext.Provider value={{ brands, activeBrand, activeBrandId, setActiveBrandId, createBrand, updateBrand, deleteBrand, lang }}>
      {children}
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
