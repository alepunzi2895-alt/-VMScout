import { useState, useEffect, useCallback } from "react";

const GOLD      = "#C9A96E";
const DARK      = "#0D0D0D";
const CARD_BG   = "#141414";
const OFF_WHITE = "#F8F4EE";
const WARM_GREY = "#8A8070";

const TYPE_LABEL = {
  strategy: { label: "Visual Scout", color: "#8B7355", icon: "🎯" },
  analytics: { label: "Analytics", color: "#E1306C", icon: "📊" },
};

function fmtDateTime(ts) {
  if (!ts) return "";
  return new Date(ts.replace(" ", "T") + "Z").toLocaleString("it-IT", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function HistoryItem({ item, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_LABEL[item.type] || { label: item.type, color: WARM_GREY, icon: "◈" };
  let parsed = null;
  try { parsed = JSON.parse(item.result_json); } catch {}

  return (
    <div style={{ background: CARD_BG, border: "1px solid rgba(201,169,110,0.12)", borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: `${meta.color}18`, color: meta.color, fontWeight: 700, fontFamily: "'Montserrat', sans-serif", letterSpacing: "0.05em" }}>
              {meta.icon} {meta.label}
            </span>
            <span style={{ fontSize: 11, color: WARM_GREY }}>{fmtDateTime(item.created_at)}</span>
          </div>
          <div style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.5, overflow: expanded ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: expanded ? "pre-wrap" : "nowrap" }}>
            {item.prompt}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setExpanded(v => !v)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(201,169,110,0.2)", background: "transparent", color: GOLD, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
            {expanded ? "Nascondi" : "Dettagli"}
          </button>
          <button onClick={() => onDelete(item.id)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(180,60,60,0.25)", background: "transparent", color: "#E47070", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
            Elimina
          </button>
        </div>
      </div>

      {expanded && parsed && (
        <pre style={{ marginTop: 12, padding: 14, background: "#0a0a0a", color: "#C4B99A", borderRadius: 8, fontSize: 10, lineHeight: 1.5, overflow: "auto", fontFamily: "'JetBrains Mono', monospace", maxHeight: 340 }}>
          {item.type === "analytics" && parsed.text ? parsed.text : JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function History({ brand }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ action: "history", limit: "100" });
    if (brand?.id) qs.set("project_id", brand.id);
    fetch(`/api/history?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Errore caricamento storico");
        setItems(d.data || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [brand?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await fetch("/api/history?action=delete_request", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      load();
    }
  }

  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);

  return (
    <div style={{ background: DARK, minHeight: "100vh", padding: "32px 24px 60px", maxWidth: 800, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: GOLD, marginBottom: 8, fontFamily: "'Montserrat', sans-serif", fontWeight: 600 }}>
          ◈ Storico
        </div>
        <div style={{ fontSize: 20, color: OFF_WHITE, fontWeight: 600 }}>
          {brand ? `Domande e risposte — ${brand.name}` : "Domande e risposte"}
        </div>
        <div style={{ fontSize: 12, color: WARM_GREY, marginTop: 4 }}>
          Ogni richiesta AI (Visual Scout, Analytics) viene salvata automaticamente su database.
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {[
          { id: "all", label: "Tutto" },
          { id: "strategy", label: "🎯 Visual Scout" },
          { id: "analytics", label: "📊 Analytics" },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            style={{
              padding: "6px 14px", borderRadius: 20, cursor: "pointer",
              border: filter === f.id ? `1px solid ${GOLD}80` : "1px solid #2A2A2A",
              background: filter === f.id ? `${GOLD}15` : "transparent",
              color: filter === f.id ? GOLD : WARM_GREY, fontSize: 11, fontWeight: 600,
              fontFamily: "'Montserrat', sans-serif",
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: WARM_GREY, fontSize: 13 }}>Caricamento…</div>}

      {error && (
        <div style={{ padding: "10px 14px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 8, color: "#ff7070", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: WARM_GREY }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 13 }}>Nessuna richiesta salvata ancora per questo progetto.</div>
        </div>
      )}

      {filtered.map(item => <HistoryItem key={item.id} item={item} onDelete={handleDelete} />)}
    </div>
  );
}
