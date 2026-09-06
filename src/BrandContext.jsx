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

  // Al primo avvio, recupera i progetti salvati sul DB e integra quelli non
  // ancora presenti in locale (es. da un altro browser/dispositivo).
  useEffect(() => {
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
              canvaTemplates: (() => { try { return JSON.parse(row.canva_templates || "{}"); } catch { return { post: "", story: "", reel: "" }; } })(),
              createdAt: row.created_at,
            }));
          return remoteOnly.length ? [...prev, ...remoteOnly] : prev;
        });
      })
      .catch(err => console.warn("[BrandContext] fetch progetti da DB fallita:", err.message));
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
