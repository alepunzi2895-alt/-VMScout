import { useState, useEffect, useCallback } from "react";

const GOLD      = "#C9A96E";
const DARK      = "#0D0D0D";
const CARD_BG   = "#141414";
const OFF_WHITE = "#F8F4EE";
const WARM_GREY = "#8A8070";
const IG_PINK   = "#E1306C";

const card = {
  background: CARD_BG,
  border: "1px solid rgba(201,169,110,0.12)",
  borderRadius: 10,
  padding: "20px 24px",
};

const label = {
  fontSize: 10,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: WARM_GREY,
  fontFamily: "'Montserrat', sans-serif",
  fontWeight: 600,
};

function fmtDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_META = {
  suggerito: { label: "Suggerito", color: WARM_GREY },
  generato: { label: "Inviato a Visual Scout", color: "#5ABA5A" },
};

function CalendarEntry({ entry, onSuggestBrief, onMarkUsed }) {
  const meta = STATUS_META[entry.status] || STATUS_META.suggerito;
  return (
    <div style={{ background: "#1A1A1A", border: "1px solid rgba(201,169,110,0.15)", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: OFF_WHITE }}>{entry.idea}</div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {entry.content_type && (
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: `${IG_PINK}18`, color: IG_PINK, fontWeight: 700, whiteSpace: "nowrap" }}>{entry.content_type}</span>
          )}
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: `${meta.color}18`, color: meta.color, fontWeight: 700, whiteSpace: "nowrap" }}>{meta.label}</span>
        </div>
      </div>
      {entry.rationale && <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.5, marginBottom: 10 }}>{entry.rationale}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, color: "#555" }}>{fmtDateTime(entry.created_at)}</span>
        <button
          onClick={() => { onSuggestBrief(entry.visual_scout_brief || entry.idea); onMarkUsed(entry.id); }}
          style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${IG_PINK}, #c0254e)`, color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Montserrat', sans-serif", letterSpacing: "0.05em" }}
        >
          🎯 Genera con Visual Scout
        </button>
      </div>
    </div>
  );
}

export default function Dashboard({ brand, onSuggestBrief }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarFilter, setCalendarFilter] = useState("suggerito");

  const load = useCallback(() => {
    if (!brand?.id) { setLoading(false); return; }
    setLoading(true);
    setError("");
    fetch(`/api/history?action=get_insights&project_id=${encodeURIComponent(brand.id)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Errore caricamento dashboard");
        setData(d.data);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [brand?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleMarkUsed(entryId) {
    setData(prev => prev ? { ...prev, calendar: prev.calendar.map(e => e.id === entryId ? { ...e, status: "generato" } : e) } : prev);
    try {
      await fetch("/api/history?action=update_calendar_status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_calendar_status", project_id: brand.id, entry_id: entryId, status: "generato" }),
      });
    } catch {}
  }

  const calendar = (data?.calendar || []).slice().reverse();
  const filteredCalendar = calendarFilter === "all" ? calendar : calendar.filter(e => e.status === calendarFilter);

  return (
    <div style={{ background: DARK, minHeight: "100vh", padding: "32px 24px 60px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: GOLD, marginBottom: 8, fontFamily: "'Montserrat', sans-serif", fontWeight: 600 }}>
          🧭 Dashboard
        </div>
        <div style={{ fontSize: 20, color: OFF_WHITE, fontWeight: 600 }}>
          {brand ? `Memoria di progetto — ${brand.name}` : "Memoria di progetto"}
        </div>
        <div style={{ fontSize: 12, color: WARM_GREY, marginTop: 4 }}>
          Si arricchisce automaticamente a ogni analisi in Analytics: punti di forza, cose da migliorare, consigli accumulati e idee per i prossimi post.
        </div>
      </div>

      {!brand?.id && (
        <div style={{ ...card, textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 12, color: WARM_GREY }}>Seleziona o crea un progetto in Home per vedere la sua dashboard.</div>
        </div>
      )}

      {loading && brand?.id && <div style={{ color: WARM_GREY, fontSize: 13 }}>Caricamento…</div>}

      {error && (
        <div style={{ padding: "10px 14px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 8, color: "#ff7070", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && brand?.id && !data && (
        <div style={{ ...card, textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🧭</div>
          <div style={{ fontSize: 13, color: OFF_WHITE, marginBottom: 6 }}>Ancora nessun dato</div>
          <div style={{ fontSize: 12, color: WARM_GREY }}>Vai su Analytics e genera la prima analisi: la dashboard di questo progetto si popolerà da sola.</div>
        </div>
      )}

      {!loading && data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ ...card }}>
              <div style={{ ...label, marginBottom: 12, color: "#5ABA5A" }}>✓ Punti di Forza</div>
              {data.strengths?.length ? data.strengths.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: OFF_WHITE, opacity: 0.9, padding: "4px 0", borderBottom: i < data.strengths.length - 1 ? "1px solid rgba(201,169,110,0.06)" : "none" }}>• {s}</div>
              )) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessuno ancora</div>}
            </div>
            <div style={{ ...card }}>
              <div style={{ ...label, marginBottom: 12, color: "#E4A050" }}>⚠ Da Migliorare</div>
              {data.weaknesses?.length ? data.weaknesses.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: OFF_WHITE, opacity: 0.9, padding: "4px 0", borderBottom: i < data.weaknesses.length - 1 ? "1px solid rgba(201,169,110,0.06)" : "none" }}>• {s}</div>
              )) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessuna ancora</div>}
            </div>
          </div>

          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ ...label, marginBottom: 12 }}>💡 Consigli Accumulati</div>
            {data.tips?.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.tips.map((t, i) => (
                  <span key={i} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20, background: `${GOLD}15`, color: GOLD }}>{t}</span>
                ))}
              </div>
            ) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessun consiglio ancora</div>}
          </div>

          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ ...label, marginBottom: 0 }}>📅 Calendario Post — Prossime Idee</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["suggerito", "Da usare"], ["generato", "Già inviate"], ["all", "Tutte"]].map(([id, l]) => (
                  <button key={id} onClick={() => setCalendarFilter(id)}
                    style={{ padding: "4px 10px", borderRadius: 20, fontSize: 10, cursor: "pointer", border: calendarFilter === id ? `1px solid ${GOLD}80` : "1px solid #2A2A2A", background: calendarFilter === id ? `${GOLD}15` : "transparent", color: calendarFilter === id ? GOLD : WARM_GREY }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {filteredCalendar.length ? filteredCalendar.map(entry => (
              <CalendarEntry key={entry.id} entry={entry} onSuggestBrief={onSuggestBrief} onMarkUsed={handleMarkUsed} />
            )) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessuna idea in questa categoria.</div>}
          </div>
        </>
      )}
    </div>
  );
}
