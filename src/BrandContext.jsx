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

  const activeBrand = brands.find(b => b.id === activeBrandId) || brands[0];

  function createBrand(name) {
    const b = newBrand(name);
    setBrands(p => [...p, b]);
    setActiveBrandId(b.id);
    return b;
  }

  function updateBrand(id, updates) {
    setBrands(p => p.map(b => b.id === id ? { ...b, ...updates } : b));
  }

  function deleteBrand(id) {
    setBrands(p => {
      const next = p.filter(b => b.id !== id);
      if (activeBrandId === id && next.length) setActiveBrandId(next[0].id);
      return next.length ? next : [newBrand()];
    });
  }

  return (
    <BrandContext.Provider value={{ brands, activeBrand, activeBrandId, setActiveBrandId, createBrand, updateBrand, deleteBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
