import { useState, useMemo, useEffect } from "react";

const GOLD      = "#C9A96E";
const DARK      = "#0D0D0D";
const CARD_BG   = "#141414";
const CARD2     = "#1A1A1A";
const OFF_WHITE = "#F8F4EE";
const WARM_GREY = "#8A8070";
const IG_PINK   = "#E1306C";

// ── API helpers ──────────────────────────────────────────────────────────────

// Rimuove caratteri invisibili (newline, zero-width space, NBSP, ecc.) e prefissi/virgolette
// che a volte restano attaccati quando si copia il token da Graph API Explorer.
// Causa più comune dell'errore Facebook "Cannot parse access token".
function sanitizeToken(raw) {
  return (raw || "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, "") // zero-width/NBSP invisibili da copia-incolla
    .replace(/\s+/g, "");
}

async function igCall(token, path, params = {}) {
  const res = await fetch("/api/instagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: sanitizeToken(token), path, params }),
  });
  return res.json();
}

// Salva ogni analisi AI nello storico persistente (Turso) e ne restituisce l'id.
async function saveToHistory({ project_id, type, prompt, result_json }) {
  try {
    const res = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_request", project_id: project_id || null, type, prompt, result_json }),
    });
    return await res.json();
  } catch (err) {
    console.warn("[InstagramAnalytics] salvataggio storico fallito:", err.message);
    return null;
  }
}

// `images`: URL delle foto dei post da allegare come input visivo — Claude le
// analizza (estetica, storytelling) insieme ai dati testuali. Il fetch+base64
// avviene lato server (api/chat.js), niente CORS verso *.cdninstagram.com.
async function callClaude(system, userMsg, images = []) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      messages: [{ role: "user", content: userMsg }],
      images,
    }),
  });
  const data = await res.json();
  return data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("") || "";
}

function parseJsonResponse(raw) {
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ── Shared styles ────────────────────────────────────────────────────────────

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

const goldBtn = (disabled) => ({
  background: disabled ? "#2a2a2a" : `linear-gradient(135deg, ${GOLD}, #A8813F)`,
  color: disabled ? WARM_GREY : DARK,
  border: "none",
  borderRadius: 6,
  padding: "10px 22px",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "'Montserrat', sans-serif",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "opacity 0.2s",
  opacity: disabled ? 0.5 : 1,
});

// ── Engagement helper ────────────────────────────────────────────────────────

function engRate(post) {
  const interactions = (post.like_count || 0) + (post.comments_count || 0) + (post.insights?.saved || 0);
  const reach = post.insights?.reach || 0;
  if (!reach) return 0;
  return (interactions / reach) * 100;
}

function mediaLabel(type) {
  if (type === "IMAGE") return "Foto";
  if (type === "VIDEO") return "Video / Reel";
  if (type === "CAROUSEL_ALBUM") return "Carosello";
  return type;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

// ── Connect Panel ────────────────────────────────────────────────────────────

function friendlyIgError(message) {
  if (/cannot parse access token/i.test(message || "")) {
    return `${message} — Il token non è nel formato atteso. Ricontrolla di aver copiato SOLO la stringa del token ` +
      '(inizia con "EAA..."), senza spazi, a-capo o testo extra (es. "Bearer", virgolette). ' +
      "Su Graph API Explorer usa l'icona di copia accanto al campo Access Token invece di selezionare il testo a mano.";
  }
  return message;
}

// Un token "IGAA..." viene dal nuovo flusso "Instagram API with Instagram Login" —
// va usato solo su graph.instagram.com e non ha alcun concetto di Facebook Page,
// quindi salta del tutto lo step "me/accounts". Un token "EAA..." è il vecchio
// Graph API Explorer legato a una Facebook Page (serve individuare la Page e il
// suo Instagram Business Account collegato).
function isDirectIgToken(t) {
  return /^IGAA/i.test(t);
}

function ConnectPanel({ onConnect }) {
  const [tokenInput, setTokenInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pages, setPages] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState("");

  async function connectDirect(t) {
    const res = await igCall(t, "me", { fields: "id,username,account_type,profile_picture_url" });
    if (res.error) throw new Error(res.error.message);
    if (!res.id) throw new Error("Impossibile leggere l'account Instagram da questo token.");
    onConnect({ token: t, accountId: res.id, username: res.username, profilePic: res.profile_picture_url || "" });
  }

  async function loadPages(t) {
    const res = await igCall(t, "me/accounts");
    if (res.error) throw new Error(res.error.message);
    if (!res.data?.length) throw new Error("Nessuna Facebook Page trovata. Controlla il permesso 'pages_show_list'.");
    setPages(res.data);
    setSelectedPageId(res.data[0].id);
  }

  async function connectWithPage(t) {
    const page = pages.find(p => p.id === selectedPageId);
    const pageToken = page.access_token || t;
    const igData = await igCall(pageToken, page.id, { fields: "instagram_business_account{id,username,profile_picture_url}" });
    if (igData.error) throw new Error(igData.error.message);

    const igUser = igData.instagram_business_account;
    if (!igUser) throw new Error(
      `Nessun account Instagram Business collegato alla Page "${page.name}". ` +
      "Controlla: (1) il tuo account è Business/Creator su Instagram, " +
      "(2) è collegato a questa Facebook Page da Impostazioni → Account collegati."
    );

    // Salva il token verificato (Page token se disponibile) — è quello che ha
    // effettivamente accesso all'account IG Business, non il token utente generico.
    onConnect({ token: pageToken, accountId: igUser.id, username: igUser.username, profilePic: igUser.profile_picture_url || "" });
  }

  async function handleSubmit() {
    const t = sanitizeToken(tokenInput);
    if (!t) return;
    setLoading(true);
    setError("");
    try {
      if (pages && selectedPageId) {
        await connectWithPage(t);
      } else if (isDirectIgToken(t)) {
        await connectDirect(t);
      } else {
        setPages(null);
        setSelectedPageId("");
        await loadPages(t);
      }
    } catch (err) {
      setError(friendlyIgError(err.message));
    }
    setLoading(false);
  }

  const buttonLabel = loading
    ? "Verifica in corso…"
    : pages ? "Connetti Account Instagram" : "Verifica e Connetti →";

  return (
    <div style={{ maxWidth: 640, margin: "60px auto", padding: "0 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
        <div style={{ fontSize: 22, color: OFF_WHITE, fontFamily: "'Playfair Display', serif", marginBottom: 8 }}>
          Connetti il tuo Account Instagram
        </div>
        <div style={{ fontSize: 13, color: WARM_GREY, lineHeight: 1.7 }}>
          Analisi intelligente dei post per costruire la strategia perfetta.
        </div>
      </div>

      {/* Steps */}
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ ...label, marginBottom: 16 }}>Come ottenere il token (Instagram API with Instagram Login)</div>
        {[
          ["1", "Vai su", "developers.facebook.com → la tua app → aggiungi il prodotto \"Instagram\""],
          ["2", 'Nella sezione "Instagram API setup with Instagram login" collega il tuo account IG Business/Creator'],
          ["3", "Genera un token con i permessi:", "instagram_business_basic  instagram_business_manage_insights"],
          ["4", "Copia il token — inizia con \"IGAA…\" — e incollalo qui sotto (nessuno step aggiuntivo: niente Facebook Page da collegare)"],
        ].map(([n, text, code], i) => (
          <div key={i} style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "flex-start" }}>
            <span style={{ minWidth: 22, height: 22, borderRadius: "50%", background: `${GOLD}20`, border: `1px solid ${GOLD}40`, color: GOLD, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Montserrat', sans-serif", flexShrink: 0, marginTop: 1 }}>
              {n}
            </span>
            <div style={{ fontSize: 13, color: WARM_GREY, lineHeight: 1.6 }}>
              {text}
              {code && <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, color: GOLD, background: "#0a0a0a", padding: "4px 8px", borderRadius: 4, display: "inline-block" }}>{code}</div>}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 4, fontSize: 11, color: WARM_GREY, opacity: 0.6 }}>
          Il token "IGAA…" dura 60 giorni (long-lived) se generato con l'endpoint <code>ig_exchange_token</code>, altrimenti scade dopo 1 ora.
          Hai ancora un vecchio token "EAA…" da Graph API Explorer? Funziona lo stesso — verrà chiesto di selezionare la Facebook Page collegata.
        </div>
      </div>

      {/* Token input */}
      <div style={{ ...card }}>
        <div style={{ ...label, marginBottom: 10 }}>Access Token</div>
        <textarea
          value={tokenInput}
          onChange={e => { setTokenInput(e.target.value); setPages(null); setSelectedPageId(""); setError(""); }}
          placeholder="IGAAxxxxxxxxxxxxx... (o EAAxxxxxxxxxxxxx per il vecchio flusso)"
          rows={3}
          style={{
            width: "100%", background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.2)",
            borderRadius: 6, color: OFF_WHITE, padding: "10px 12px", fontSize: 12,
            fontFamily: "monospace", resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
        <div style={{ marginTop: 6, fontSize: 10, color: WARM_GREY, opacity: 0.7 }}>
          Incolla solo il token (nessuno spazio, a-capo, "Bearer" o virgolette) — viene ripulito automaticamente, ma se il campo contiene altro testo la richiesta a Facebook fallirà.
        </div>

        {/* Page selector — shown after loading pages */}
        {pages && pages.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ ...label, marginBottom: 8 }}>Seleziona Facebook Page</div>
            <select
              value={selectedPageId}
              onChange={e => setSelectedPageId(e.target.value)}
              style={{
                width: "100%", background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.3)",
                borderRadius: 6, color: OFF_WHITE, padding: "10px 12px", fontSize: 13,
                fontFamily: "'Montserrat', sans-serif", outline: "none", cursor: "pointer",
              }}
            >
              {pages.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 6, color: "#ff7070", fontSize: 12 }}>
            {error}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || !tokenInput.trim()}
          style={{ ...goldBtn(loading || !tokenInput.trim()), marginTop: 14, width: "100%" }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label: lbl, value, sub }) {
  return (
    <div style={{ ...card, textAlign: "center" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: WARM_GREY, fontFamily: "'Montserrat', sans-serif", fontWeight: 600, marginBottom: 10 }}>
        {lbl}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: GOLD, fontFamily: "'Montserrat', sans-serif", marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: WARM_GREY }}>{sub}</div>}
    </div>
  );
}

// ── Post Row ─────────────────────────────────────────────────────────────────

function PostRow({ post, rank }) {
  const eng = engRate(post).toFixed(2);
  const thumb = post.thumbnail_url || post.media_url;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid rgba(201,169,110,0.08)" }}>
      <div style={{ fontSize: 12, color: WARM_GREY, minWidth: 20, textAlign: "center", fontFamily: "'Montserrat', sans-serif", fontWeight: 700 }}>
        #{rank}
      </div>
      {thumb ? (
        <img src={thumb} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(201,169,110,0.15)", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: 6, background: CARD2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
          {post.media_type === "VIDEO" ? "🎬" : post.media_type === "CAROUSEL_ALBUM" ? "🖼" : "📸"}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: WARM_GREY, marginBottom: 3 }}>
          <span style={{ color: GOLD }}>{mediaLabel(post.media_type)}</span>
          <span style={{ margin: "0 6px" }}>·</span>
          {fmtDate(post.timestamp)}
          <span style={{ margin: "0 6px" }}>·</span>
          {new Date(post.timestamp).getHours()}:00
        </div>
        <div style={{ fontSize: 12, color: OFF_WHITE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
          {post.caption ? post.caption.substring(0, 100) : <span style={{ color: WARM_GREY, fontStyle: "italic" }}>Nessuna caption</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: GOLD, fontFamily: "'Montserrat', sans-serif" }}>{eng}%</div>
        <div style={{ fontSize: 10, color: WARM_GREY }}>engagement</div>
        <div style={{ fontSize: 10, color: WARM_GREY, marginTop: 2 }}>
          ❤ {post.like_count || 0} · 💬 {post.comments_count || 0} · 🔖 {post.insights?.saved || 0}
        </div>
      </div>
    </div>
  );
}

// ── Hour Chart ────────────────────────────────────────────────────────────────

function HourChart({ posts }) {
  const hours = useMemo(() => {
    const acc = {};
    posts.forEach(p => {
      const h = new Date(p.timestamp).getHours();
      if (!acc[h]) acc[h] = { count: 0, totalEng: 0 };
      acc[h].count++;
      acc[h].totalEng += engRate(p);
    });
    return acc;
  }, [posts]);

  const maxEng = Math.max(...Object.values(hours).map(h => h.count ? h.totalEng / h.count : 0), 0.01);
  const allHours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div>
      <div style={{ ...label, marginBottom: 14 }}>Engagement medio per ora</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
        {allHours.map(h => {
          const d = hours[h];
          const avgEng = d ? d.totalEng / d.count : 0;
          const heightPct = (avgEng / maxEng) * 100;
          const isGolden = h >= 18 && h <= 23;
          const hasData = !!d;
          return (
            <div key={h} title={`${h}:00 — ${hasData ? avgEng.toFixed(2) + "% eng, " + d.count + " post" : "nessun post"}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{
                width: "100%", height: `${Math.max(heightPct, hasData ? 5 : 0)}%`,
                background: hasData ? (isGolden ? GOLD : "#3a3a3a") : "transparent",
                borderRadius: "2px 2px 0 0",
                transition: "height 0.3s",
                minHeight: hasData ? 2 : 0,
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {[0, 6, 12, 18, 23].map(h => (
          <span key={h} style={{ fontSize: 9, color: WARM_GREY }}>{h}h</span>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: WARM_GREY }}>
        <span style={{ display: "inline-block", width: 10, height: 10, background: GOLD, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
        Fascia 18–23h (aperitivo/sera)
      </div>
    </div>
  );
}

// ── Analysis Panel (JSON strutturato: pattern, timing, analisi visiva, prossimi post) ──

function ChipList({ items, color = GOLD }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {items.map((t, i) => (
        <span key={i} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: `${color}18`, color, fontWeight: 500 }}>{t}</span>
      ))}
    </div>
  );
}

function AnalysisSection({ title, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: GOLD, fontFamily: "'Montserrat', sans-serif", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function NextPostCard({ post, onSuggestBrief, saved, onMarkUsed }) {
  return (
    <div style={{ background: CARD2, border: "1px solid rgba(201,169,110,0.15)", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: OFF_WHITE }}>{post.idea}</div>
        {post.content_type && (
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: `${IG_PINK}18`, color: IG_PINK, fontWeight: 700, whiteSpace: "nowrap" }}>{post.content_type}</span>
        )}
      </div>
      {post.rationale && <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.5, marginBottom: 10 }}>{post.rationale}</div>}
      <button
        onClick={() => { onSuggestBrief(post.visual_scout_brief || post.idea); onMarkUsed?.(); }}
        disabled={!post.visual_scout_brief && !post.idea}
        style={{ ...goldBtn(false), background: `linear-gradient(135deg, ${IG_PINK}, #c0254e)`, color: "#fff", fontSize: 10, padding: "8px 14px" }}
      >
        {saved === false ? "✓ Inviato a Visual Scout" : "🎯 Genera con Visual Scout →"}
      </button>
    </div>
  );
}

function AnalysisPanel({ data, onSuggestBrief, title = "Analisi Strategica · Claude" }) {
  if (!data) return null;
  const { patterns, timing, content_pillars, visual_storytelling: vs, corrections, next_posts } = data;

  return (
    <div style={{ ...card, marginTop: 24 }}>
      <div style={{ ...label, marginBottom: 20 }}>{title}</div>

      {patterns?.summary && (
        <AnalysisSection title="📊 Pattern Vincenti">
          <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7, margin: 0, opacity: 0.9 }}>{patterns.summary}</p>
          <ChipList items={patterns.winning_formats} />
        </AnalysisSection>
      )}

      {timing?.summary && (
        <AnalysisSection title="⏰ Timing Ottimale">
          <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7, margin: 0, opacity: 0.9 }}>{timing.summary}</p>
          {timing.best_slot && <div style={{ marginTop: 8, display: "inline-block", fontSize: 12, fontWeight: 700, color: GOLD, background: `${GOLD}15`, padding: "4px 12px", borderRadius: 6 }}>{timing.best_slot}</div>}
        </AnalysisSection>
      )}

      {content_pillars?.length > 0 && (
        <AnalysisSection title="🎯 Content Pillars">
          <ChipList items={content_pillars} color="#C9A96E" />
        </AnalysisSection>
      )}

      {vs && (vs.style_description || vs.storytelling_pattern) && (
        <AnalysisSection title="🖼 Analisi Visiva & Storytelling">
          {vs.style_description && <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7, margin: "0 0 8px", opacity: 0.9 }}>{vs.style_description}</p>}
          {vs.storytelling_pattern && <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7, margin: "0 0 8px", opacity: 0.9, fontStyle: "italic" }}>{vs.storytelling_pattern}</p>}
          <ChipList items={vs.recurring_elements} color="#8A8070" />
          {vs.strengths?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#5ABA5A", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>✓ Punti di forza</div>
              {vs.strengths.map((s, i) => <div key={i} style={{ fontSize: 12, color: OFF_WHITE, opacity: 0.85, padding: "3px 0" }}>• {s}</div>)}
            </div>
          )}
          {vs.weaknesses?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#E4A050", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>⚠ Da migliorare</div>
              {vs.weaknesses.map((s, i) => <div key={i} style={{ fontSize: 12, color: OFF_WHITE, opacity: 0.85, padding: "3px 0" }}>• {s}</div>)}
            </div>
          )}
        </AnalysisSection>
      )}

      {corrections?.length > 0 && (
        <AnalysisSection title="⚠️ Cosa Correggere">
          {corrections.map((c, i) => <div key={i} style={{ fontSize: 12, color: "#E49E9E", opacity: 0.9, padding: "3px 0" }}>• {c}</div>)}
        </AnalysisSection>
      )}

      {next_posts?.length > 0 && onSuggestBrief && (
        <AnalysisSection title="🚀 Prossimi Post — Idee Pronte">
          {next_posts.map((p, i) => <NextPostCard key={i} post={p} onSuggestBrief={onSuggestBrief} />)}
        </AnalysisSection>
      )}
    </div>
  );
}

// ── Past Analyses (storico inline, non più una sezione separata) ─────────────

function fmtDateTime(ts) {
  if (!ts) return "";
  return new Date(ts.replace(" ", "T") + "Z").toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function PastAnalyses({ brand, refreshKey, onSuggestBrief }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !brand?.id) return;
    setLoading(true);
    fetch(`/api/history?action=history&project_id=${encodeURIComponent(brand.id)}&type=analytics&limit=30`)
      .then(r => r.json())
      .then(d => { if (d.ok) setItems(d.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, brand?.id, refreshKey]);

  async function handleDelete(id) {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await fetch("/api/history?action=delete_request", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

  if (!brand?.id) return null;

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
        <span style={{ ...label }}>🕘 Analisi Precedenti</span>
        <span style={{ fontSize: 11, color: WARM_GREY }}>{open ? "▲ Nascondi" : "▼ Mostra"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          {loading && <div style={{ fontSize: 12, color: WARM_GREY }}>Caricamento…</div>}
          {!loading && !items.length && <div style={{ fontSize: 12, color: WARM_GREY }}>Nessuna analisi precedente per questo progetto.</div>}
          {items.map(item => {
            let parsed = null;
            try { parsed = JSON.parse(item.result_json); } catch {}
            const expanded = expandedId === item.id;
            return (
              <div key={item.id} style={{ borderBottom: "1px solid rgba(201,169,110,0.08)", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 11, color: WARM_GREY }}>{fmtDateTime(item.created_at)}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setExpandedId(expanded ? null : item.id)}
                      style={{ fontSize: 10, color: GOLD, background: "transparent", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                      {expanded ? "Nascondi" : "Dettagli"}
                    </button>
                    <button onClick={() => handleDelete(item.id)}
                      style={{ fontSize: 10, color: "#E47070", background: "transparent", border: "1px solid rgba(180,60,60,0.25)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                      Elimina
                    </button>
                  </div>
                </div>
                {expanded && parsed && (
                  <div style={{ marginTop: 12 }}>
                    <AnalysisPanel data={parsed} onSuggestBrief={onSuggestBrief} title="Analisi" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

function readJsonLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

export default function InstagramAnalytics({ brand, onSuggestBrief }) {
  const defaultHandle = brand?.instagramHandle || "";
  const [token,      setToken]      = useState(() => localStorage.getItem("ig_token") || "");
  const [accountId,  setAccountId]  = useState(() => localStorage.getItem("ig_account_id") || "");
  const [username,   setUsername]   = useState(() => localStorage.getItem("ig_username") || defaultHandle);
  const [profilePic, setProfilePic] = useState(() => localStorage.getItem("ig_profile_pic") || "");
  // La sessione (post caricati + ultima analisi) resta in localStorage così
  // riaprendo il tab Analytics non serve ricaricare/rianalizzare da capo.
  const [posts,     setPosts]     = useState(() => readJsonLS("ig_posts", []));
  const [loading,   setLoading]   = useState(false);
  const [step,      setStep]      = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis,  setAnalysis]  = useState(() => readJsonLS("ig_analysis_json", null));
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [error,     setError]     = useState("");

  const isConnected = !!(token && accountId);

  useEffect(() => {
    try { localStorage.setItem("ig_posts", JSON.stringify(posts)); } catch {}
  }, [posts]);

  useEffect(() => {
    try {
      if (analysis) localStorage.setItem("ig_analysis_json", JSON.stringify(analysis));
      else localStorage.removeItem("ig_analysis_json");
    } catch {}
  }, [analysis]);

  function handleConnect({ token: t, accountId: id, username: u, profilePic: p }) {
    localStorage.setItem("ig_token", t);
    localStorage.setItem("ig_account_id", id);
    localStorage.setItem("ig_username", u || "");
    localStorage.setItem("ig_profile_pic", p || "");
    setToken(t);
    setAccountId(id);
    setUsername(u || "");
    setProfilePic(p || "");
  }

  function disconnect() {
    ["ig_token", "ig_account_id", "ig_username", "ig_profile_pic", "ig_analysis_json", "ig_posts"].forEach(k => localStorage.removeItem(k));
    setToken(""); setAccountId(""); setUsername(defaultHandle); setProfilePic("");
    setPosts([]); setAnalysis(null); setError("");
  }

  async function fetchPosts() {
    setLoading(true);
    setError("");
    setPosts([]);
    setAnalysis(null);

    try {
      setStep("Recupero ultimi 30 post…");
      const mediaRes = await igCall(token, `${accountId}/media`, {
        fields: "id,caption,media_type,timestamp,like_count,comments_count,media_url,thumbnail_url",
        limit: 30,
      });
      if (mediaRes.error) throw new Error(mediaRes.error.message);

      const mediaList = mediaRes.data || [];
      if (!mediaList.length) throw new Error("Nessun post trovato sull'account.");

      setStep(`Recupero insights per ${mediaList.length} post…`);
      const enriched = await Promise.all(
        mediaList.map(async (post) => {
          // "impressions"/"video_views" sono metriche deprecate dalla Instagram Insights API
          // (Meta risponde con errore "does not support this metric for this media product
          // type" per gli account moderni) — sostituite da "views" per i contenuti video.
          const metric = post.media_type === "VIDEO"
            ? "reach,saved,views"
            : "reach,saved";
          const ins = await igCall(token, `${post.id}/insights`, { metric });
          const insMap = {};
          if (ins.data) {
            ins.data.forEach(m => { insMap[m.name] = m.values?.[0]?.value ?? 0; });
          }
          return { ...post, insights: insMap };
        })
      );

      setPosts(enriched);
      setStep("");
    } catch (err) {
      setError(err.message);
      setStep("");
    }
    setLoading(false);
  }

  async function fetchPriorInsights() {
    if (!brand?.id) return null;
    try {
      const res = await fetch(`/api/history?action=get_insights&project_id=${encodeURIComponent(brand.id)}`);
      const d = await res.json();
      return d.ok ? d.data : null;
    } catch { return null; }
  }

  // Aggiorna la "memoria" di progetto (punti forza/debolezza, consigli, calendario
  // post) con quanto emerso da questa analisi — è il loop di auto-apprendimento:
  // ogni prossima analisi/strategia legge questa memoria prima di generare.
  function mergeIntoProjectInsights(parsed) {
    if (!brand?.id) return;
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "merge_insights",
        project_id: brand.id,
        tips: parsed.corrections || [],
        strengths: parsed.visual_storytelling?.strengths || [],
        weaknesses: parsed.visual_storytelling?.weaknesses || [],
        calendar_entries: (parsed.next_posts || []).map(p => ({
          idea: p.idea, rationale: p.rationale, content_type: p.content_type, visual_scout_brief: p.visual_scout_brief,
        })),
      }),
    }).catch(err => console.warn("[InstagramAnalytics] merge insights fallito:", err.message));
  }

  async function analyze() {
    if (!posts.length) return;
    setAnalyzing(true);
    setError("");

    const postsSummary = posts.map(p => ({
      data: fmtDate(p.timestamp),
      ora: `${new Date(p.timestamp).getHours()}:00`,
      tipo: mediaLabel(p.media_type),
      likes: p.like_count || 0,
      commenti: p.comments_count || 0,
      reach: p.insights?.reach || 0,
      views: p.insights?.views || 0,
      saves: p.insights?.saved || 0,
      eng_pct: engRate(p).toFixed(2) + "%",
      caption: (p.caption || "").substring(0, 200),
    }));

    // Foto dei post con più engagement — Claude le vede davvero e analizza
    // stile visivo/storytelling, non solo i numeri.
    const topForVision = [...posts].sort((a, b) => engRate(b) - engRate(a)).slice(0, 6);
    const imageUrls = topForVision.map(p => p.thumbnail_url || p.media_url).filter(Boolean);

    const priorInsights = await fetchPriorInsights();
    const priorCtx = priorInsights && (priorInsights.tips?.length || priorInsights.strengths?.length || priorInsights.weaknesses?.length)
      ? `\n\nMEMORIA ACCUMULATA DA ANALISI PRECEDENTI DI QUESTO PROGETTO — non ripetere gli stessi identici consigli, verifica se sono stati applicati (confronta con i dati/immagini attuali) e approfondisci/evolvi:
${priorInsights.strengths?.length ? `Punti di forza già confermati in passato: ${priorInsights.strengths.join(" | ")}` : ""}
${priorInsights.weaknesses?.length ? `Debolezze già individuate in passato: ${priorInsights.weaknesses.join(" | ")}` : ""}
${priorInsights.tips?.length ? `Consigli già dati in passato: ${priorInsights.tips.join(" | ")}` : ""}`
      : "";

    const brandCtx = brand?.name
      ? `\nBRAND: ${brand.name}${brand.sector ? ` | Settore: ${brand.sector}` : ""}${brand.tone ? ` | Tono: ${brand.tone}` : ""}${brand.description ? `\nDescrizione: ${brand.description}` : ""}`
      : "";

    const system = `Sei un social media strategist ed esperto di direzione artistica/visual storytelling. Analizza i dati Instagram e le foto reali allegate, e offri consigli strategici concreti.${brandCtx}${priorCtx}

REGOLE GENERALI:
• Caption: max 3-4 righe. Prima frase = gancio evocativo. MAI "Benvenuti" o "Vi presentiamo".
• Emoji: max 1-2 per post. CTA finale chiaro.
• Hashtag: nel PRIMO COMMENTO, non nel caption.
• Reel: B-roll 15-30s, testo overlay minimal, musica coerente con il tono del brand.
• NEVER: foto stock pulite, tono corporate, urgency forzata.

Rispondi SOLO con un oggetto JSON valido (no markdown fences, no testo fuori dal JSON), con questa struttura esatta:
{
  "patterns": { "summary": "analisi pattern vincenti con dati a supporto, in italiano", "winning_formats": ["formato1", "formato2"] },
  "timing": { "summary": "analisi orari/giorni migliori confrontati con la fascia 18-23h", "best_slot": "es. 19:00-21:00" },
  "content_pillars": ["tema1", "tema2", "tema3"],
  "visual_storytelling": {
    "style_description": "descrizione onesta dello stile visivo ricorrente nelle foto allegate (luce, palette, composizione, coerenza col brand)",
    "recurring_elements": ["elemento1", "elemento2"],
    "storytelling_pattern": "che storia raccontano i post in sequenza, se ce n'è una",
    "strengths": ["punto di forza visivo 1", "punto di forza visivo 2"],
    "weaknesses": ["cosa migliorare visivamente 1", "cosa migliorare visivamente 2"]
  },
  "corrections": ["abitudine da eliminare 1", "abitudine da eliminare 2"],
  "next_posts": [
    {
      "idea": "titolo breve dell'idea",
      "content_type": "Post | Reel | Carosello",
      "rationale": "perché funzionerà, basato sui dati e sulle immagini analizzate",
      "visual_scout_brief": "brief completo in italiano, pronto da inviare a Visual Scout per generare subito questo post: includi soggetto, location/ambientazione, mood ed eventuale formato"
    }
  ]
}
Genera esattamente 3 idee in "next_posts", diverse tra loro per soggetto/formato.`;

    const userMsg = `Analizza i dati Instagram reali di ${username || "questo account"} (ultimi ${posts.length} post) e le ${imageUrls.length} foto allegate dei post con più engagement:

${JSON.stringify(postsSummary, null, 2)}

Usa sempre dati concreti. Mantieni tono lusso/evocativo.`;

    try {
      const raw = await callClaude(system, userMsg, imageUrls);
      const parsed = parseJsonResponse(raw);
      setAnalysis(parsed);
      const saved = await saveToHistory({ project_id: brand?.id, type: "analytics", prompt: userMsg, result_json: parsed });
      mergeIntoProjectInsights(parsed);
      if (saved?.ok) setHistoryRefreshKey(k => k + 1);
    } catch (err) {
      setError("Errore analisi Claude: " + err.message);
    }
    setAnalyzing(false);
  }

  // ── Computed stats ────────────────────────────────────────────────────────

  const avgEng = posts.length
    ? (posts.reduce((s, p) => s + engRate(p), 0) / posts.length).toFixed(2)
    : null;

  const mediaTypeCounts = useMemo(() =>
    posts.reduce((acc, p) => { acc[p.media_type] = (acc[p.media_type] || 0) + 1; return acc; }, {}),
    [posts]);

  const bestType = Object.entries(mediaTypeCounts).sort((a, b) => {
    const avgEngA = posts.filter(p => p.media_type === a[0]).reduce((s, p) => s + engRate(p), 0) / a[1];
    const avgEngB = posts.filter(p => p.media_type === b[0]).reduce((s, p) => s + engRate(p), 0) / b[1];
    return avgEngB - avgEngA;
  })[0]?.[0];

  const hourBest = useMemo(() => {
    const h = {};
    posts.forEach(p => {
      const hr = new Date(p.timestamp).getHours();
      if (!h[hr]) h[hr] = { count: 0, totalEng: 0 };
      h[hr].count++;
      h[hr].totalEng += engRate(p);
    });
    const best = Object.entries(h).sort((a, b) => (b[1].totalEng / b[1].count) - (a[1].totalEng / a[1].count))[0];
    return best ? `${best[0]}:00` : null;
  }, [posts]);

  const avgReach = posts.length
    ? Math.round(posts.reduce((s, p) => s + (p.insights?.reach || 0), 0) / posts.length)
    : null;

  const topPosts = useMemo(() =>
    [...posts].sort((a, b) => engRate(b) - engRate(a)).slice(0, 5),
    [posts]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div style={{ background: DARK, minHeight: "100vh", paddingBottom: 60 }}>
        <ConnectPanel onConnect={handleConnect} />
      </div>
    );
  }

  return (
    <div style={{ background: DARK, minHeight: "100vh", padding: "32px 24px 60px", maxWidth: 900, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {profilePic ? (
              <img src={profilePic} alt={username} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: `2px solid ${IG_PINK}55` }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg, ${IG_PINK}, #F77737, #FCAF45)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📱</div>
            )}
            <div>
              <div style={{ fontSize: 16, color: OFF_WHITE, fontFamily: "'Montserrat', sans-serif", fontWeight: 700 }}>
                @{username}
              </div>
              <div style={{ fontSize: 10, color: WARM_GREY, letterSpacing: "0.1em" }}>
                {posts.length > 0 ? `${posts.length} post analizzati` : "Account connesso"}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={fetchPosts}
            disabled={loading}
            style={{ ...goldBtn(loading), fontSize: 10 }}
          >
            {loading ? step || "Caricamento…" : posts.length ? "Aggiorna Feed" : "Carica Post"}
          </button>
          {posts.length > 0 && (
            <button
              onClick={analyze}
              disabled={analyzing}
              style={{ ...goldBtn(analyzing), background: analyzing ? "#2a2a2a" : `linear-gradient(135deg, ${IG_PINK}, #c0254e)`, color: analyzing ? WARM_GREY : "#fff", fontSize: 10 }}
            >
              {analyzing ? "Analisi in corso…" : "Analizza con Claude"}
            </button>
          )}
          <button
            onClick={disconnect}
            style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, color: WARM_GREY, padding: "10px 16px", fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif", letterSpacing: "0.08em" }}
          >
            Disconnetti
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 20, padding: "10px 14px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 8, color: "#ff7070", fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!posts.length && !loading && (
        <div style={{ ...card, textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 15, color: OFF_WHITE, marginBottom: 8 }}>Nessun dato caricato</div>
          <div style={{ fontSize: 12, color: WARM_GREY }}>Clicca "Carica Post" per recuperare gli ultimi 30 post di @{username}</div>
        </div>
      )}

      {/* Stats grid */}
      {posts.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
            <StatCard label="Engagement Medio" value={`${avgEng}%`} sub="likes + commenti + saves / reach" />
            <StatCard label="Formato Vincente" value={mediaLabel(bestType)} sub="per engagement medio" />
            <StatCard label="Ora Migliore" value={hourBest || "—"} sub="engagement più alto" />
            <StatCard label="Reach Medio" value={avgReach ? avgReach.toLocaleString("it-IT") : "—"} sub="per post" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            {/* Top posts */}
            <div style={{ ...card }}>
              <div style={{ ...label, marginBottom: 4 }}>Top 5 Post per Engagement</div>
              {topPosts.map((p, i) => <PostRow key={p.id} post={p} rank={i + 1} />)}
            </div>

            {/* Hour chart */}
            <div style={{ ...card }}>
              <HourChart posts={posts} />

              {/* Media type distribution */}
              <div style={{ marginTop: 24 }}>
                <div style={{ ...label, marginBottom: 12 }}>Distribuzione Formato</div>
                {Object.entries(mediaTypeCounts).map(([type, count]) => {
                  const pct = Math.round((count / posts.length) * 100);
                  return (
                    <div key={type} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: WARM_GREY }}>{mediaLabel(type)}</span>
                        <span style={{ fontSize: 11, color: GOLD, fontWeight: 700 }}>{count} ({pct}%)</span>
                      </div>
                      <div style={{ height: 4, background: "#2a2a2a", borderRadius: 2 }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: GOLD, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <AnalysisPanel data={analysis} onSuggestBrief={onSuggestBrief} />
          <PastAnalyses brand={brand} refreshKey={historyRefreshKey} onSuggestBrief={onSuggestBrief} />

          {!analysis && !analyzing && (
            <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>✦</div>
              <div style={{ fontSize: 13, color: OFF_WHITE, marginBottom: 6 }}>Analisi strategica pronta</div>
              <div style={{ fontSize: 11, color: WARM_GREY, marginBottom: 20 }}>
                Claude analizzerà dati e foto dei tuoi {posts.length} post — pattern, timing, stile visivo/storytelling — e proporrà idee pronte per il prossimo post su @{username}.
              </div>
              <button
                onClick={analyze}
                style={{ ...goldBtn(false), background: `linear-gradient(135deg, ${IG_PINK}, #c0254e)`, color: "#fff" }}
              >
                Analizza con Claude
              </button>
            </div>
          )}

          {analyzing && (
            <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
              <div style={{ fontSize: 11, color: WARM_GREY }}>Claude sta analizzando {posts.length} post…</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
