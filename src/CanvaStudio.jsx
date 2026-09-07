import { useState, useEffect } from "react";
import { useBrand } from "./BrandContext.jsx";
import CanvaMark from "./CanvaMark.jsx";

const GOLD = "#C9A96E";
const CANVA_TEAL = "#00C4CC";

const FORMATS = [
  { id: "post", icon: "📸", label: "Post 1:1", desc: "Formato quadrato per feed Instagram/Facebook" },
  { id: "story", icon: "📱", label: "Story 9:16", desc: "Verticale per Stories e Reels corti" },
  { id: "reel", icon: "🎬", label: "Reel 9:16", desc: "Verticale per Reels e video verticali" },
];

function SectionCard({ children, style = {} }) {
  return (
    <div style={{ background: "#0C0C0C", border: "1px solid #1C1C1C", borderRadius: 20, padding: 24, ...style }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.15em", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, marginBottom: 6 }}>
      {children}
    </div>
  );
}

// Crea una bozza Canva vuota alla dimensione giusta (via Create Design API) —
// risparmia solo il passo "nuovo design → imposta dimensioni". Collegare gli
// elementi ai campi Autofill e pubblicare come Brand Template resta un
// passaggio manuale nell'editor Canva: l'API di Canva non lo espone.
function ScaffoldButton({ format }) {
  const [state, setState] = useState("idle");
  const [url, setUrl] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  async function handleClick() {
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch(`/api/canva-scaffold?format=${format}`);
      const data = await res.json();
      if (data.ok) {
        setUrl(data.editUrl);
        setState("done");
      } else if (data.error === "CANVA_NOT_CONNECTED") {
        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
        setState("idle");
      } else {
        setErrMsg(data.message || "Errore durante la creazione della bozza.");
        setState("error");
        setTimeout(() => setState("idle"), 5000);
      }
    } catch (e) {
      setErrMsg(e.message || "Errore di rete.");
      setState("error");
      setTimeout(() => setState("idle"), 5000);
    }
  }

  if (state === "done" && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ padding: "9px 14px", borderRadius: 12, background: "rgba(90,186,90,0.1)", color: "#5ABA5A", fontSize: 11, fontWeight: 600, textDecoration: "none", border: "1px solid rgba(90,186,90,0.25)", whiteSpace: "nowrap" }}>
        ✓ Apri bozza →
      </a>
    );
  }

  return (
    <button onClick={handleClick} disabled={state === "loading"} title={state === "error" ? errMsg : "Crea una bozza vuota alla dimensione giusta"}
      style={{ padding: "9px 14px", borderRadius: 12, border: "1px solid rgba(0,196,204,0.3)", background: "rgba(0,196,204,0.07)", color: "#00C4CC", fontSize: 11, fontWeight: 600, cursor: state === "loading" ? "wait" : "pointer", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap", opacity: state === "loading" ? 0.6 : 1 }}>
      {state === "loading" ? "⏳ Creo…" : state === "error" ? "⚠ Riprova" : "✦ Crea bozza vuota"}
    </button>
  );
}

export default function CanvaStudio() {
  const { activeBrand, updateBrand } = useBrand();
  const [canvaStatus, setCanvaStatus] = useState(null);
  const [templates, setTemplates] = useState({ post: "", story: "", reel: "", carousel: "" });
  const [savedMsg, setSavedMsg] = useState(false);

  const [caption, setCaption] = useState("");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("post");
  const [creating, setCreating] = useState(false);
  const [designUrl, setDesignUrl] = useState(null);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    setTemplates(activeBrand?.canvaTemplates || { post: "", story: "", reel: "", carousel: "" });
  }, [activeBrand?.id]);

  useEffect(() => {
    fetch("/api/canva-auth?action=status")
      .then(r => r.json())
      .then(d => setCanvaStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setCanvaStatus("disconnected"));
  }, []);

  function saveTemplates() {
    updateBrand(activeBrand.id, { canvaTemplates: templates });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2200);
  }

  async function handleCreate() {
    if (!caption.trim()) return;
    const templateId = templates[format];
    if (!templateId) {
      setCreateError(`Configura prima il Template ID per "${FORMATS.find(f => f.id === format)?.label}" qui sopra.`);
      return;
    }
    setCreating(true);
    setDesignUrl(null);
    setCreateError("");
    try {
      const res = await fetch("/api/canva-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: caption.trim(), search_query: query.trim(), format, templateId }),
      });
      const data = await res.json();
      if (data.ok) {
        setDesignUrl(data.url);
      } else if (data.error === "CANVA_NOT_CONNECTED") {
        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
        setCreateError("Connetti il tuo account Canva nella finestra appena aperta, poi riprova.");
      } else {
        setCreateError(data.message || "Errore durante la creazione del design.");
      }
    } catch (e) {
      setCreateError(e.message || "Errore di rete.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#F0EBE3", fontFamily: "'Space Grotesk', sans-serif", padding: "44px 20px 80px" }}>
      <style>{`        * { box-sizing: border-box }
        .cs-input:focus { outline: none; border-color: rgba(0,196,204,0.4) !important; }
        .cs-input::placeholder { color: #3A3A3A; }
      `}</style>

      <div style={{ maxWidth: 700, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: CANVA_TEAL, marginBottom: 10, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
            <CanvaMark size={16} /> Canva Studio
          </div>
          <h2 style={{ fontSize: 30, fontWeight: 300, margin: "0 0 8px", fontFamily: "'Space Grotesk', sans-serif" }}>
            Gestisci i tuoi template
          </h2>
          {activeBrand && (
            <div style={{ fontSize: 12, color: "#444" }}>
              Progetto: <span style={{ color: GOLD }}>{activeBrand.name}</span>
            </div>
          )}
        </div>

        {/* Auth status */}
        <SectionCard style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: canvaStatus === "connected" ? "#5ABA5A" : canvaStatus === null ? "#888" : "#444" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: canvaStatus === "connected" ? "#5ABA5A" : "#888" }}>
                {canvaStatus === null ? "Verifica connessione…" : canvaStatus === "connected" ? "Canva connesso" : "Canva non connesso"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#3A3A3A", paddingLeft: 16 }}>
              {canvaStatus === "connected"
                ? "Puoi creare design e caricare media direttamente in Canva."
                : "Collega il tuo account Canva per abilitare tutte le funzioni."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canvaStatus !== "connected" ? (
              <button
                onClick={() => window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700")}
                style={{ padding: "9px 18px", borderRadius: 13, border: `1px solid ${CANVA_TEAL}45`, background: `${CANVA_TEAL}12`, color: CANVA_TEAL, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap" }}>
                Connetti Canva →
              </button>
            ) : (
              <button
                onClick={() => fetch("/api/canva-auth?action=logout").then(() => setCanvaStatus("disconnected"))}
                style={{ padding: "8px 14px", borderRadius: 12, border: "1px solid #2A2A2A", background: "transparent", color: "#444", fontSize: 11, cursor: "pointer" }}>
                Disconnetti
              </button>
            )}
          </div>
        </SectionCard>

        {/* Template IDs */}
        <SectionCard style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#D0C8C0", marginBottom: 5 }}>
                Template ID — {activeBrand?.name || "Progetto"}
              </div>
              <div style={{ fontSize: 11, color: "#3A3A3A", lineHeight: 1.5 }}>
                Apri un template Canva → copia l'ID dall'URL.<br />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#444", fontSize: 10 }}>
                  canva.com/design/<strong style={{ color: CANVA_TEAL }}>DAF_XXXXXXX</strong>/edit
                </span>
              </div>
            </div>
            <button onClick={saveTemplates}
              style={{ padding: "8px 18px", borderRadius: 13, border: `1px solid ${savedMsg ? "#3A7A3A70" : GOLD + "35"}`, background: savedMsg ? "#3A7A3A15" : "transparent", color: savedMsg ? "#5ABA5A" : GOLD, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap", transition: "all 0.25s" }}>
              {savedMsg ? "✓ Salvato" : "Salva"}
            </button>
          </div>

          {FORMATS.map(f => (
            <div key={f.id} style={{ marginBottom: 16 }}>
              <Label>{f.icon} {f.label} — {f.desc}</Label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="cs-input"
                  value={templates[f.id] || ""}
                  onChange={e => setTemplates(t => ({ ...t, [f.id]: e.target.value }))}
                  placeholder={`Template ID per ${f.label} (es: DAF_xxxxx)`}
                  style={{ flex: 1, background: "#141414", border: "1px solid #222", borderRadius: 13, padding: "9px 13px", color: "#F0EBE3", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}
                />
                <ScaffoldButton format={f.id} />
              </div>
            </div>
          ))}

          <div style={{ borderTop: "1px solid #1C1C1C", paddingTop: 16 }}>
            <Label>🖼 Carosello — Template Multi-Slide</Label>
            <div style={{ fontSize: 11, color: "#3A3A3A", lineHeight: 1.6, marginBottom: 10 }}>
              Un solo template con più slide, ognuna con un placeholder immagine e uno testo chiamati esattamente
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CANVA_TEAL }}> Image_1</span>/
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CANVA_TEAL }}>Testo_1</span>,
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CANVA_TEAL }}> Image_2</span>/
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CANVA_TEAL }}>Testo_2</span>, ecc.
              (fino a 10 slide). Da Visual Scout → tab Post → "Crea Carosello Completo su Canva" compila tutte le slide in un click, senza crearle una per una.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="cs-input"
                value={templates.carousel || ""}
                onChange={e => setTemplates(t => ({ ...t, carousel: e.target.value }))}
                placeholder="Template ID Carosello (es: DAF_xxxxx)"
                style={{ flex: 1, background: "#141414", border: "1px solid #222", borderRadius: 13, padding: "9px 13px", color: "#F0EBE3", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}
              />
              <ScaffoldButton format="carousel" />
            </div>
          </div>
        </SectionCard>

        {/* Quick create */}
        <SectionCard>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#D0C8C0", marginBottom: 5 }}>Crea design rapido</div>
          <div style={{ fontSize: 11, color: "#3A3A3A", marginBottom: 20, lineHeight: 1.6 }}>
            Scrivi la caption e una query per la foto di sfondo → VMScout cerca l'immagine su Pexels, la carica in Canva e apre il template compilato.
          </div>

          {/* Format selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {FORMATS.map(f => (
              <button key={f.id} onClick={() => { setFormat(f.id); setDesignUrl(null); setCreateError(""); }}
                style={{ flex: 1, padding: "8px 4px", fontSize: 11, borderRadius: 13, cursor: "pointer", border: `1px solid ${format === f.id ? CANVA_TEAL + "70" : "#1E1E1E"}`, background: format === f.id ? `${CANVA_TEAL}12` : "transparent", color: format === f.id ? CANVA_TEAL : "#444", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, transition: "all 0.2s" }}>
                {f.icon} {f.label.split(" ")[0]}
              </button>
            ))}
          </div>

          <textarea
            className="cs-input"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Caption del post (testo che apparirà nel template)..."
            rows={3}
            style={{ width: "100%", background: "#141414", border: "1px solid #222", borderRadius: 13, padding: "10px 13px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", resize: "none", marginBottom: 10 }}
          />

          <input
            className="cs-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Query foto sfondo — max 3 parole EN (es: luxury villa ibiza)"
            style={{ width: "100%", background: "#141414", border: "1px solid #222", borderRadius: 13, padding: "9px 13px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 14 }}
          />

          {createError && (
            <div style={{ padding: "10px 14px", borderRadius: 13, background: "rgba(180,60,60,0.1)", border: "1px solid rgba(180,60,60,0.2)", color: "#E47070", fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
              {createError}
            </div>
          )}

          {designUrl ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a href={designUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", padding: "12px 16px", borderRadius: 13, textDecoration: "none", textAlign: "center", border: "1px solid rgba(90,186,90,0.35)", background: "rgba(90,186,90,0.1)", color: "#5ABA5A", fontSize: 13, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>
                ✓ Apri design in Canva →
              </a>
              <button onClick={() => { setDesignUrl(null); setCaption(""); setQuery(""); setCreateError(""); }}
                style={{ padding: "8px", borderRadius: 12, border: "1px solid #1E1E1E", background: "transparent", color: "#444", fontSize: 11, cursor: "pointer" }}>
                Crea un altro
              </button>
            </div>
          ) : (
            <button onClick={handleCreate} disabled={creating || !caption.trim()}
              style={{ width: "100%", padding: "12px 16px", borderRadius: 13, fontSize: 13, fontWeight: 600, cursor: creating || !caption.trim() ? "not-allowed" : "pointer", border: `1px solid ${CANVA_TEAL}45`, background: `${CANVA_TEAL}12`, color: CANVA_TEAL, fontFamily: "'Space Grotesk', sans-serif", opacity: creating || !caption.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "opacity 0.2s" }}>
              {creating ? "⏳ Creo design…" : "✦ Crea Design in Canva"}
            </button>
          )}
        </SectionCard>

      </div>
    </div>
  );
}
