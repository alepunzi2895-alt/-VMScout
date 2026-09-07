import { createContext, useContext, useState, useEffect } from "react";

const BrandContext = createContext(null);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const newBrand = (name = "Il Mio Brand") => ({
  id: uid(),
  name,
  sector: "",
  description: "",
  tone: "",
  language: "it",
  instagramHandle: "",
  hashtags: "",
  logo: "",            // data URL (immagine/logo del progetto, ridimensionata client-side)
  canvaTemplates: { post: "", story: "", reel: "" },
  createdAt: new Date().toISOString(),
});

function loadBrands() {
  try {
    const s = localStorage.getItem("vmscout_brands");
    if (s) return JSON.parse(s);
  } catch {}
  return null;
}

// Persistenza server-side (Turso) dei progetti — fire-and-forget: localStorage
// resta la fonte di verità immediata/offline, il DB è lo storico durevole
// (sopravvive a un browser diverso o alla cancellazione della cache).
function syncProjectToDb(brand) {
  fetch("/api/history?action=save_project", {
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
  }).catch(err => console.warn("[BrandContext] sync progetto fallita:", err.message));
}

function deleteProjectFromDb(id) {
  fetch("/api/history?action=delete_project", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(err => console.warn("[BrandContext] delete progetto fallita:", err.message));
}

function isPristine(b) {
  return !b?.sector && !b?.description && !b?.tone && !b?.instagramHandle && !b?.hashtags;
}

export function BrandProvider({ children }) {
  const [brands, setBrands] = useState(() => loadBrands() || [newBrand()]);
  const [activeBrandId, setActiveBrandId] = useState(
    () => localStorage.getItem("vmscout_active_brand") || null
  );

  useEffect(() => {
    localStorage.setItem("vmscout_brands", JSON.stringify(brands));
  }, [brands]);

  useEffect(() => {
    if (activeBrandId) localStorage.setItem("vmscout_active_brand", activeBrandId);
  }, [activeBrandId]);

  // Il progetto di default veniva creato solo in locale — non passava mai da
  // createBrand/updateBrand, quindi non arrivava MAI al DB finché l'utente non
  // apriva "Modifica" e salvava qualcosa. Risultato: da un altro dispositivo/
  // browser (localStorage vuoto) non c'era nulla da recuperare, nemmeno il
  // progetto stesso. Sincronizza quindi anche lo stato iniziale al mount, non
  // solo le modifiche esplicite — upsert idempotente, sicuro anche se il
  // progetto era già su DB.
  useEffect(() => {
    brands.forEach(syncProjectToDb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al primo avvio, recupera i progetti salvati sul DB e integra quelli non
  // ancora presenti in locale (es. da un altro browser/dispositivo). Se questo
  // dispositivo non aveva ancora nulla di suo (solo il progetto di default,
  // mai personalizzato, nessuna selezione attiva salvata) e troviamo progetti
  // reali sul DB, li rendiamo attivi subito invece di lasciare selezionato il
  // progetto vuoto appena creato in locale — altrimenti sembra che "non ci sia
  // nulla di salvato" anche se i dati esistono, solo non selezionati.
  useEffect(() => {
    const wasFreshDevice = !activeBrandId && brands.length === 1 && isPristine(brands[0]);
    fetch("/api/history?action=projects")
      .then(r => r.json())
      .then(d => {
        if (!d.ok || !d.data?.length) return;
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
              canvaTemplates: (() => { try { return JSON.parse(row.canva_templates || "{}"); } catch { return { post: "", story: "", reel: "" }; } })(),
              createdAt: row.created_at,
            }));
          if (!remoteOnly.length) return prev;
          if (wasFreshDevice) setActiveBrandId(remoteOnly[0].id);
          return [...prev, ...remoteOnly];
        });
      })
      .catch(err => console.warn("[BrandContext] fetch progetti da DB fallita:", err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBrand = brands.find(b => b.id === activeBrandId) || brands[0];

  function createBrand(name) {
    const b = newBrand(name);
    setBrands(p => [...p, b]);
    setActiveBrandId(b.id);
    syncProjectToDb(b);
    return b;
  }

  function updateBrand(id, updates) {
    let updated = null;
    setBrands(p => p.map(b => {
      if (b.id !== id) return b;
      updated = { ...b, ...updates };
      return updated;
    }));
    if (updated) syncProjectToDb(updated);
  }

  function deleteBrand(id) {
    setBrands(p => {
      const next = p.filter(b => b.id !== id);
      if (activeBrandId === id && next.length) setActiveBrandId(next[0].id);
      return next.length ? next : [newBrand()];
    });
    deleteProjectFromDb(id);
  }

  return (
    <BrandContext.Provider value={{ brands, activeBrand, activeBrandId, setActiveBrandId, createBrand, updateBrand, deleteBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
