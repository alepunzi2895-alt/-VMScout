import { useState } from "react";
import { useBrand } from "./BrandContext.jsx";
import CanvaMark from "./CanvaMark.jsx";
import BrandAvatar, { fileToResizedDataURL } from "./BrandAvatar.jsx";

const GOLD = "#C9A96E";

const SECTORS = [
  "Fashion & Lifestyle", "Food & Beverage", "Tech & SaaS", "Travel & Hospitality",
  "Luxury & Concierge", "Beauty & Wellness", "Sport & Fitness", "Arte & Cultura",
  "E-commerce", "Servizi B2B", "Immobiliare", "Altro",
];

const TONES = [
  "Autentico & Diretto", "Lussuoso & Aspirazionale", "Casual & Friendly",
  "Professionale & Autorevole", "Ribelle & Bold", "Spirituale & Mindful",
  "Ironico & Divertente",
];

export default function Home({ onNavigate }) {
  const { brands, activeBrand, activeBrandId, setActiveBrandId, createBrand, updateBrand, deleteBrand } = useBrand();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);

  function startEdit(brand) {
    const target = brand && typeof brand.id === "string" ? brand : activeBrand;
    if (target.id !== activeBrandId) setActiveBrandId(target.id);
    setDraft({ ...target });
    setEditing(true);
  }

  function removeBrand(brand) {
    const target = brand && typeof brand.id === "string" ? brand : activeBrand;
    if (brands.length <= 1) return;
    if (window.confirm(`Eliminare il progetto "${target.name}"? L'operazione non è reversibile.`)) {
      deleteBrand(target.id);
      if (editing && target.id === activeBrandId) cancelEdit();
    }
  }

  function saveEdit() {
    updateBrand(activeBrand.id, draft);
    setEditing(false);
    setDraft(null);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    createBrand(newName.trim());
    setNewName("");
    setShowNew(false);
  }

  const tools = [
    {
      id: "vmscout", icon: "🎯", title: "Visual Scout",
      desc: "Strategia visiva AI, caption multilingua, storyboard video e photo scouting.",
    },
    {
      id: "instagram", icon: "📊", title: "Analytics",
      desc: "Analisi engagement reale, timing ottimale e suggerimenti strategici via AI.",
    },
    {
      id: "canva", icon: <CanvaMark size={24} />, title: "Canva Studio",
      desc: "Configura template Canva e crea design dal tuo brief in un click.",
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#F0EBE3", fontFamily: "'Space Grotesk', sans-serif", paddingBottom: 80 }}>
      <style>{`        * { box-sizing: border-box }
        .home-tool-card:hover { border-color: rgba(201,169,110,0.35) !important; background: rgba(201,169,110,0.04) !important; }
        .home-brand-card:hover { border-color: rgba(201,169,110,0.3) !important; }
        .home-input:focus { outline: none; border-color: rgba(201,169,110,0.4) !important; }
        select option { background: #1A1A1A; color: #F0EBE3; }
      `}</style>

      {/* Hero */}
      <div style={{ textAlign: "center", padding: "56px 24px 44px" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.4em", textTransform: "uppercase", color: GOLD, marginBottom: 22, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
          ◈ VMScout
        </div>
        <h1 style={{ fontSize: 44, fontWeight: 300, margin: "0 0 14px", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em", lineHeight: 1.1 }}>
          Strategia visiva.<br />
          <em style={{ fontStyle: "italic", color: GOLD }}>Zero compromessi.</em>
        </h1>
        <p style={{ fontSize: 15, color: "#6A6258", maxWidth: 440, margin: "0 auto", lineHeight: 1.75 }}>
          AI-powered marketing per qualsiasi brand. Scegli o crea un progetto e inizia.
        </p>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 20px" }}>

        {/* ── Projects grid ── */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "#444", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
              Progetti
            </span>
            <button onClick={() => setShowNew(v => !v)}
              style={{ fontSize: 11, padding: "5px 14px", borderRadius: 20, border: `1px solid ${GOLD}35`, background: "transparent", color: GOLD, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, transition: "all 0.2s" }}>
              + Nuovo
            </button>
          </div>

          {showNew && (
            <div style={{ background: "#111", border: `1px solid ${GOLD}25`, borderRadius: 16, padding: 14, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                autoFocus
                className="home-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNew(false); setNewName(""); } }}
                placeholder="Nome brand o progetto..."
                style={{ flex: 1, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 12, padding: "8px 12px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif" }}
              />
              <button onClick={handleCreate}
                style={{ padding: "8px 16px", borderRadius: 12, border: "none", background: GOLD, color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
                Crea
              </button>
              <button onClick={() => { setShowNew(false); setNewName(""); }}
                style={{ padding: "8px 12px", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#555", fontSize: 12, cursor: "pointer" }}>
                ✕
              </button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
            {brands.map(brand => {
              const isActive = brand.id === activeBrandId || brand.id === activeBrand?.id;
              return (
                <div
                  key={brand.id}
                  className="home-brand-card"
                  onClick={() => { setActiveBrandId(brand.id); if (editing) cancelEdit(); }}
                  style={{
                    padding: "14px 16px", borderRadius: 16, cursor: "pointer",
                    border: `1px solid ${isActive ? GOLD + "55" : "#1E1E1E"}`,
                    background: isActive ? `${GOLD}07` : "#0C0C0C",
                    transition: "all 0.2s", position: "relative",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <BrandAvatar brand={brand} size={34} radius={9} active={isActive} />
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#F0EBE3" : "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {brand.name}
                      </div>
                      {brand.sector && (
                        <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{brand.sector}</div>
                      )}
                    </div>
                  </div>

                  <div className="home-brand-actions" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
                    <button
                      title="Modifica progetto"
                      onClick={e => { e.stopPropagation(); startEdit(brand); }}
                      style={{ width: 22, height: 22, borderRadius: 9, border: "1px solid #262626", background: "#0C0C0C", color: "#888", fontSize: 10, cursor: "pointer", lineHeight: 1, padding: 0 }}>
                      ✎
                    </button>
                    {brands.length > 1 && (
                      <button
                        title="Elimina progetto"
                        onClick={e => { e.stopPropagation(); removeBrand(brand); }}
                        style={{ width: 22, height: 22, borderRadius: 9, border: "1px solid #3A2020", background: "#0C0C0C", color: "#B06060", fontSize: 10, cursor: "pointer", lineHeight: 1, padding: 0 }}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Active brand card ── */}
        {activeBrand && (
          <div style={{ background: "#0C0C0C", border: `1px solid ${GOLD}20`, borderRadius: 20, padding: "22px 24px", marginBottom: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: editing ? 20 : 16 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#444", marginBottom: 5, fontFamily: "'Space Grotesk', sans-serif" }}>
                  Progetto attivo
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#E8E0D8" }}>{activeBrand.name}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {editing && (
                  <button onClick={cancelEdit}
                    style={{ padding: "6px 12px", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#555", fontSize: 11, cursor: "pointer" }}>
                    Annulla
                  </button>
                )}
                <button onClick={editing ? saveEdit : startEdit}
                  style={{ padding: "6px 14px", borderRadius: 12, border: `1px solid ${editing ? GOLD + "80" : "#2A2A2A"}`, background: editing ? GOLD : "transparent", color: editing ? "#000" : "#777", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", transition: "all 0.2s" }}>
                  {editing ? "✓ Salva" : "Modifica"}
                </button>
              </div>
            </div>

            {editing && draft ? (
              <BrandForm draft={draft} onChange={setDraft} />
            ) : (
              <BrandSummary brand={activeBrand} />
            )}

            {brands.length > 1 && !editing && (
              <button
                onClick={() => removeBrand()}
                style={{ marginTop: 18, fontSize: 10, color: "#7A4A4A", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>
                Elimina progetto
              </button>
            )}
          </div>
        )}

        {/* ── Quick access tools ── */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "#444", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, marginBottom: 14 }}>
            Strumenti
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {tools.map(t => (
              <button
                key={t.id}
                className="home-tool-card"
                onClick={() => onNavigate(t.id)}
                style={{ padding: "22px 18px", borderRadius: 18, border: "1px solid #1A1A1A", background: "#0C0C0C", textAlign: "left", cursor: "pointer", transition: "all 0.2s" }}
              >
                <div style={{ fontSize: 24, marginBottom: 10, height: 24 }}>{t.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#C8C0B8", marginBottom: 7, fontFamily: "'Space Grotesk', sans-serif" }}>{t.title}</div>
                <div style={{ fontSize: 11, color: "#454540", lineHeight: 1.6 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function BrandSummary({ brand }) {
  if (!brand) return null;
  const fields = [
    { label: "Settore", value: brand.sector },
    { label: "Tono", value: brand.tone },
    { label: "Instagram", value: brand.instagramHandle },
    { label: "Descrizione", value: brand.description },
    { label: "Hashtag", value: brand.hashtags },
  ].filter(f => f.value);

  if (!fields.length) {
    return (
      <p style={{ fontSize: 12, color: "#333", fontStyle: "italic", margin: 0, lineHeight: 1.65 }}>
        Nessun profilo configurato. Clicca <strong style={{ color: "#555" }}>Modifica</strong> per aggiungere info sul brand — l'AI le userà in ogni generazione per output più precisi.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {fields.map(f => (
        <div key={f.label} style={{ display: "flex", gap: 14 }}>
          <span style={{ fontSize: 10, color: "#444", width: 80, flexShrink: 0, paddingTop: 2, fontFamily: "'Space Grotesk', sans-serif", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {f.label}
          </span>
          <span style={{ fontSize: 13, color: "#8A8278", lineHeight: 1.5 }}>{f.value}</span>
        </div>
      ))}
    </div>
  );
}

function LogoField({ draft, onChange }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      const dataUrl = await fileToResizedDataURL(file, 320);
      onChange({ ...draft, logo: dataUrl });
    } catch (er) {
      setErr(er.message || "Caricamento fallito");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 14 }}>
      <BrandAvatar brand={draft} size={48} radius={12} />
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'Space Grotesk', sans-serif", display: "block", marginBottom: 6 }}>
          Logo / foto progetto
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ padding: "7px 12px", borderRadius: 12, border: "1px solid #2A2A2A", background: "#141414", color: "#A0988E", fontSize: 11, cursor: busy ? "wait" : "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
            {busy ? "Carico…" : draft.logo ? "Sostituisci" : "Carica immagine"}
            <input type="file" accept="image/*" onChange={handleFile} disabled={busy} style={{ display: "none" }} />
          </label>
          {draft.logo && (
            <button type="button" onClick={() => onChange({ ...draft, logo: "" })}
              style={{ padding: "7px 12px", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#666", fontSize: 11, cursor: "pointer" }}>
              Rimuovi
            </button>
          )}
          <span style={{ fontSize: 10, color: "#3A3A3A" }}>PNG/JPG · ridimensionata a 320px</span>
        </div>
        {err && <div style={{ fontSize: 11, color: "#E47070", marginTop: 6 }}>{err}</div>}
      </div>
    </div>
  );
}

function BrandForm({ draft, onChange }) {
  const inputStyle = {
    width: "100%", background: "#141414", border: "1px solid #2A2A2A", borderRadius: 12,
    padding: "9px 12px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif",
    outline: "none",
  };
  const labelStyle = {
    fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em",
    fontFamily: "'Space Grotesk', sans-serif", display: "block", marginBottom: 6,
  };
  const field = (key, label, placeholder, type = "text") => (
    <div key={key} style={{ display: "flex", flexDirection: "column" }}>
      <label style={labelStyle}>{label}</label>
      {type === "textarea" ? (
        <textarea
          className="home-input"
          value={draft[key] || ""}
          onChange={e => onChange({ ...draft, [key]: e.target.value })}
          placeholder={placeholder}
          rows={2}
          style={{ ...inputStyle, resize: "none" }}
        />
      ) : (
        <input
          className="home-input"
          value={draft[key] || ""}
          onChange={e => onChange({ ...draft, [key]: e.target.value })}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
      <div style={{ gridColumn: "1 / -1" }}>
        {field("name", "Nome Brand / Progetto", "Es: Mio Brand, Progetto Estate 2026...")}
      </div>

      <LogoField draft={draft} onChange={onChange} />

      <div>
        <label style={labelStyle}>Settore</label>
        <select
          className="home-input"
          value={draft.sector || ""}
          onChange={e => onChange({ ...draft, sector: e.target.value })}
          style={{ ...inputStyle, color: draft.sector ? "#F0EBE3" : "#555" }}
        >
          <option value="">Seleziona settore...</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Tono di voce</label>
        <select
          className="home-input"
          value={draft.tone || ""}
          onChange={e => onChange({ ...draft, tone: e.target.value })}
          style={{ ...inputStyle, color: draft.tone ? "#F0EBE3" : "#555" }}
        >
          <option value="">Seleziona tono...</option>
          {TONES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        {field("description", "Descrizione Brand", "Descrivi il brand in 1-2 frasi. L'AI la userà per personalizzare ogni output.", "textarea")}
      </div>

      {field("instagramHandle", "Handle Instagram", "@nomebrand")}
      {field("hashtags", "Hashtag principali", "#brand #settore #target (separati da spazio)")}
    </div>
  );
}
