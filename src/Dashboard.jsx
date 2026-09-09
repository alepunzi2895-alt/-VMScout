import { useState, useEffect, useCallback } from "react";
import { saveProjectDirectives } from "./projectDirectives";
import { useT, useLang, fmtDate } from "./i18n/index.jsx";

const GOLD      = "#C9A96E";
const DARK      = "#0D0D0D";
const CARD_BG   = "#141414";
const OFF_WHITE = "#F8F4EE";
const WARM_GREY = "#8A8070";
const IG_PINK   = "#E1306C";

const card = {
  background: CARD_BG,
  border: "1px solid rgba(201,169,110,0.12)",
  borderRadius: 14,
  padding: "20px 24px",
};

const label = {
  fontSize: 10,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: WARM_GREY,
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 600,
};

function CalendarEntry({ entry, onSuggestBrief, onMarkUsed }) {
  const t = useT();
  const { lang } = useLang();
  const STATUS_META = {
    suggerito: { label: t("dash.status.suggested"), color: WARM_GREY },
    generato: { label: t("dash.status.sent"), color: "#5ABA5A" },
  };
  const meta = STATUS_META[entry.status] || STATUS_META.suggerito;
  return (
    <div style={{ background: "#1A1A1A", border: "1px solid rgba(201,169,110,0.15)", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: OFF_WHITE }}>{entry.idea}</div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {entry.content_type && (
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: `${IG_PINK}18`, color: IG_PINK, fontWeight: 700, whiteSpace: "nowrap" }}>{entry.content_type}</span>
          )}
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: `${meta.color}18`, color: meta.color, fontWeight: 700, whiteSpace: "nowrap" }}>{meta.label}</span>
        </div>
      </div>
      {entry.rationale && <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.5, marginBottom: 10 }}>{entry.rationale}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, color: "#555" }}>{fmtDate(entry.created_at, lang)}</span>
        <button
          onClick={() => { onSuggestBrief(entry.visual_scout_brief || entry.idea); onMarkUsed(entry.id); }}
          style={{ padding: "7px 14px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${IG_PINK}, #c0254e)`, color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.05em" }}
        >
          {t("dash.genWithScout")}
        </button>
      </div>
    </div>
  );
}

function DirectivesCard({ brand, directives, updatedAt, onSaved }) {
  const t = useT();
  const { lang } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(directives || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(directives || ""); }, [directives]);

  async function save() {
    setSaving(true);
    await saveProjectDirectives(brand.id, draft);
    setSaving(false);
    setEditing(false);
    onSaved?.(draft);
  }

  return (
    <div style={{ ...card, marginBottom: 20, borderColor: "rgba(201,169,110,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ ...label, marginBottom: 0, color: GOLD }}>🎯 {t("dash.directives")}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {updatedAt && !editing && <span style={{ fontSize: 9, color: "#555" }}>{t("dash.updated", { date: fmtDate(updatedAt, lang) })}</span>}
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setDraft(directives || ""); }}
                style={{ padding: "4px 10px", borderRadius: 10, border: "1px solid #2A2A2A", background: "transparent", color: WARM_GREY, fontSize: 10, cursor: "pointer" }}>{t("common.cancel")}</button>
              <button onClick={save} disabled={saving}
                style={{ padding: "4px 12px", borderRadius: 10, border: "none", background: GOLD, color: "#000", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>{saving ? "…" : t("common.save")}</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              style={{ padding: "4px 12px", borderRadius: 10, border: "1px solid #2A2A2A", background: "transparent", color: "#999", fontSize: 10, cursor: "pointer" }}>{t("common.edit")}</button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: WARM_GREY, marginBottom: 12, lineHeight: 1.5 }}>
        {t("dash.directivesSub")}
      </div>
      {editing ? (
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={12}
          style={{ width: "100%", background: "#0E0E0E", border: "1px solid #2A2A2A", borderRadius: 12, padding: "12px 14px", color: OFF_WHITE, fontSize: 12.5, lineHeight: 1.6, fontFamily: "'Space Grotesk', sans-serif", resize: "vertical" }} />
      ) : directives?.trim() ? (
        <div style={{ fontSize: 12.5, color: OFF_WHITE, opacity: 0.92, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{directives}</div>
      ) : (
        <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>
          {t("dash.directivesEmpty", { edit: t("common.edit") })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ brand, onSuggestBrief }) {
  const t = useT();
  const { lang } = useLang();
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
        if (!d.ok) throw new Error(d.error || t("dash.loadError"));
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

  // Voci extra dall'ultima analisi Instagram, mescolate nelle liste esistenti.
  const strat = data?.strategy || null;
  const stratStrengths = strat ? [strat.patterns_summary, strat.visual_style].filter(Boolean) : [];
  const stratTips = strat ? [
    strat.best_slot && `⏰ Orario migliore: ${strat.best_slot}`,
    strat.winning_formats?.length && `📊 Formati vincenti: ${strat.winning_formats.join(", ")}`,
    strat.timing_summary && `🕓 ${strat.timing_summary}`,
  ].filter(Boolean) : [];
  const pillars = strat?.content_pillars || [];
  const strengthsAll = [...stratStrengths, ...(data?.strengths || [])];
  const tipsAll = [...stratTips, ...(data?.tips || [])];

  return (
    <div style={{ background: DARK, minHeight: "100vh", padding: "32px 24px 60px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: GOLD, marginBottom: 8, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
          🧭 {t("dash.title")}
        </div>
        <div style={{ fontSize: 20, color: OFF_WHITE, fontWeight: 600 }}>
          {brand ? t("dash.memoryOf", { name: brand.name }) : t("dash.memory")}
        </div>
        <div style={{ fontSize: 12, color: WARM_GREY, marginTop: 4 }}>
          {t("dash.sub")}
        </div>
      </div>

      {!brand?.id && (
        <div style={{ ...card, textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 12, color: WARM_GREY }}>{t("dash.pickProject")}</div>
        </div>
      )}

      {loading && brand?.id && <div style={{ color: WARM_GREY, fontSize: 13 }}>{t("common.loading")}</div>}

      {error && (
        <div style={{ padding: "10px 14px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 12, color: "#ff7070", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && brand?.id && !data && (
        <>
          <DirectivesCard
            brand={brand}
            directives=""
            updatedAt={null}
            onSaved={(d) => setData({ directives: d, directives_updated_at: new Date().toISOString(), strengths: [], weaknesses: [], tips: [], calendar: [] })}
          />
          <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧭</div>
            <div style={{ fontSize: 13, color: OFF_WHITE, marginBottom: 6 }}>{t("dash.noData")}</div>
            <div style={{ fontSize: 12, color: WARM_GREY }}>{t("dash.noDataSub")}</div>
          </div>
        </>
      )}

      {!loading && data && (
        <>
          <DirectivesCard
            brand={brand}
            directives={data.directives}
            updatedAt={data.directives_updated_at}
            onSaved={(d) => setData(prev => ({ ...prev, directives: d, directives_updated_at: new Date().toISOString() }))}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ ...card }}>
              <div style={{ ...label, marginBottom: 12, color: "#5ABA5A" }}>✓ {t("dash.strengths")}</div>
              {strengthsAll.length ? strengthsAll.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: OFF_WHITE, opacity: 0.9, padding: "4px 0", borderBottom: i < strengthsAll.length - 1 ? "1px solid rgba(201,169,110,0.06)" : "none" }}>• {s}</div>
              )) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>{t("common.none")}</div>}
            </div>
            <div style={{ ...card }}>
              <div style={{ ...label, marginBottom: 12, color: "#E4A050" }}>⚠ {t("dash.improve")}</div>
              {data.weaknesses?.length ? data.weaknesses.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: OFF_WHITE, opacity: 0.9, padding: "4px 0", borderBottom: i < data.weaknesses.length - 1 ? "1px solid rgba(201,169,110,0.06)" : "none" }}>• {s}</div>
              )) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>{t("common.none")}</div>}
            </div>
          </div>

          {pillars.length > 0 && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ ...label, marginBottom: 12 }}>🎯 {t("dash.pillars")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pillars.map((p, i) => (
                  <span key={i} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20, background: `${IG_PINK}15`, color: IG_PINK, fontWeight: 600 }}>{p}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ ...label, marginBottom: 12 }}>💡 {t("dash.tips")}</div>
            {tipsAll.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tipsAll.map((t, i) => (
                  <span key={i} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20, background: `${GOLD}15`, color: GOLD }}>{t}</span>
                ))}
              </div>
            ) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>{t("dash.noTips")}</div>}
          </div>

          {data.ad_strategy && (
            <div style={{ ...card, marginBottom: 20, borderColor: "rgba(24,119,242,0.25)" }}>
              <div style={{ ...label, marginBottom: 12, color: "#4A90E2" }}>💰 {t("dash.adTarget")}</div>
              {data.ad_strategy.riepilogo && <div style={{ fontSize: 12.5, color: OFF_WHITE, opacity: 0.92, lineHeight: 1.6, marginBottom: 12 }}>{data.ad_strategy.riepilogo}</div>}
              <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.7, marginBottom: data.ad_strategy.interessi?.length ? 8 : 0 }}>
                {data.ad_strategy.eta && <>{t("dash.age")} <strong style={{ color: OFF_WHITE }}>{data.ad_strategy.eta}</strong> · </>}
                {data.ad_strategy.genere && <>{t("dash.gender")} <strong style={{ color: OFF_WHITE }}>{data.ad_strategy.genere}</strong> · </>}
                {data.ad_strategy.aree && <>{t("dash.areas")} <strong style={{ color: OFF_WHITE }}>{data.ad_strategy.aree}</strong></>}
              </div>
              {!!data.ad_strategy.interessi?.length && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {data.ad_strategy.interessi.map((x, i) => (
                    <span key={i} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: "rgba(74,144,226,0.14)", color: "#7FB4EE" }}>{x}</span>
                  ))}
                </div>
              )}
              {data.ad_strategy.prossimo_test && <div style={{ fontSize: 12, color: OFF_WHITE, marginBottom: 4 }}><strong style={{ color: GOLD }}>{t("dash.nextTest")}</strong> {data.ad_strategy.prossimo_test}</div>}
              {data.ad_strategy.budget && <div style={{ fontSize: 12, color: OFF_WHITE }}><strong style={{ color: GOLD }}>{t("dash.budget")}</strong> {data.ad_strategy.budget}</div>}
              {data.ad_strategy.updated_at && <div style={{ fontSize: 9, color: "#555", marginTop: 10 }}>{t("dash.updated", { date: fmtDate(data.ad_strategy.updated_at, lang) })}</div>}
            </div>
          )}

          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div style={{ ...label, marginBottom: 0 }}>📅 {t("dash.calendar")}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["suggerito", t("dash.filter.todo")], ["generato", t("dash.filter.sent")], ["all", t("dash.filter.all")]].map(([id, l]) => (
                  <button key={id} onClick={() => setCalendarFilter(id)}
                    style={{ padding: "4px 10px", borderRadius: 20, fontSize: 10, cursor: "pointer", border: calendarFilter === id ? `1px solid ${GOLD}80` : "1px solid #2A2A2A", background: calendarFilter === id ? `${GOLD}15` : "transparent", color: calendarFilter === id ? GOLD : WARM_GREY }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {filteredCalendar.length ? filteredCalendar.map(entry => (
              <CalendarEntry key={entry.id} entry={entry} onSuggestBrief={onSuggestBrief} onMarkUsed={handleMarkUsed} />
            )) : <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>{t("dash.noIdeas")}</div>}
          </div>
        </>
      )}
    </div>
  );
}
