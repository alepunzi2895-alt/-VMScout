// Avatar del progetto: mostra il logo caricato (data URL) se presente,
// altrimenti l'iniziale del nome su sfondo pieno. Usato nella navbar, nel
// project switcher e nella griglia progetti della Home.
export default function BrandAvatar({ brand, size = 24, radius, active = true }) {
  const r = radius ?? Math.round(size / 3);
  const base = {
    width: size, height: size, borderRadius: r, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", fontFamily: "'Montserrat', sans-serif", fontWeight: 700,
  };
  if (brand?.logo) {
    return (
      <div style={{ ...base, background: "#141414", border: "1px solid rgba(255,255,255,0.08)" }}>
        <img src={brand.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div style={{
      ...base,
      background: active ? "#C9A96E" : "#1E1E1E",
      color: active ? "#000" : "#666",
      fontSize: Math.round(size * 0.42),
    }}>
      {(brand?.name?.[0] || "?").toUpperCase()}
    </div>
  );
}

// Ridimensiona un File immagine a max `max` px lato lungo e restituisce un
// data URL JPEG/PNG compatto — evita di ficcare in localStorage/DB un'immagine
// da svariati MB. PNG mantenuto solo se l'originale è PNG (per la trasparenza
// dei logo); altrimenti JPEG qualità 0.85.
export function fileToResizedDataURL(file, max = 320) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("File non valido"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lettura file fallita"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Immagine non leggibile"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const isPng = file.type === "image/png";
        resolve(canvas.toDataURL(isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
