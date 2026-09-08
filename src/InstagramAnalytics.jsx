import { useState, useMemo, useEffect } from "react";
import { EngagementTrendChart, MiniBarChart, FORMAT_COLORS } from "./AnalyticsCharts.jsx";
import { MARKETING_TOOLKIT_BRIEF } from "./marketingFrameworks";
import { directivesBlock, refineProjectDirectives } from "./projectDirectives";

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

// Insights per singolo post. Instagram fallisce l'INTERA chiamata se anche una
// sola metrica della lista non è valida per quel tipo di media / account →
// proviamo prima il set esteso, poi ricadiamo su quello minimo garantito, così
// il post ha sempre almeno reach/saved invece di restare senza dati.
async function fetchPostInsights(token, post) {
  const isVideo = post.media_type === "VIDEO";
  const extended = isVideo
    ? "reach,saved,likes,comments,shares,total_interactions,views,profile_visits,follows"
    : "reach,saved,likes,comments,shares,total_interactions,profile_visits,follows";
  const minimal = isVideo ? "reach,saved,views" : "reach,saved";
  for (const metric of [extended, minimal]) {
    const ins = await igCall(token, `${post.id}/insights`, { metric });
    if (Array.isArray(ins.data)) {
      const m = {};
      ins.data.forEach(x => { m[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0; });
      return m;
    }
  }
  return {};
}

// Panoramica account + (best-effort) insight aggregati e demografia follower.
// Ogni pezzo è opzionale: le API variano per tipo di token/versione e per il
// numero di follower (la demografia richiede >100 follower), quindi renderizziamo
// solo ciò che torna davvero.
async function fetchAccountOverview(token, accountId) {
  const base = await igCall(token, accountId, { fields: "followers_count,media_count,follows_count" });
  if (base.error) return null;
  const acc = {
    followers_count: base.followers_count ?? null,
    media_count: base.media_count ?? null,
    follows_count: base.follows_count ?? null,
  };

  const tv = (r) => r?.data?.[0]?.total_value?.value ?? r?.data?.[0]?.values?.[0]?.value ?? null;
  const breakdown = (r) => r?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? null;

  const [reach28, views28] = await Promise.all([
    igCall(token, `${accountId}/insights`, { metric: "reach", period: "days_28", metric_type: "total_value" }).catch(() => null),
    igCall(token, `${accountId}/insights`, { metric: "profile_views", period: "days_28", metric_type: "total_value" }).catch(() => null),
  ]);
  acc.reach_28d = tv(reach28);
  acc.profile_views_28d = tv(views28);

  const [demCountry, demAge, demGender] = await Promise.all([
    igCall(token, `${accountId}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: "country" }).catch(() => null),
    igCall(token, `${accountId}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: "age" }).catch(() => null),
    igCall(token, `${accountId}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: "gender" }).catch(() => null),
  ]);
  acc.dem_country = breakdown(demCountry);
  acc.dem_age = breakdown(demAge);
  acc.dem_gender = breakdown(demGender);

  return acc;
}

// Salva ogni analisi AI nello storico persistente (Turso) e ne restituisce l'id.
async function saveToHistory({ project_id, type, prompt, result_json }) {
  try {
    const res = await fetch("/api/history?action=save_request", {
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
  let data;
  try {
    data = await res.json();
  } catch {
    // Risposta non-JSON (funzione crashata/andata in timeout, body vuoto, pagina
    // di errore Vercel, ecc.) — meglio un messaggio chiaro con lo status HTTP che
    // un errore di parsing criptico che confonde col JSON dell'analisi stessa.
    throw new Error(`Il server non ha risposto correttamente (status ${res.status}). Riprova.`);
  }
  // Se Anthropic (o il nostro proxy) risponde con un errore, "content" non
  // esiste: senza questo controllo si tornava una stringa vuota che poi
  // falliva JSON.parse più a valle con un messaggio criptico e senza motivo.
  if (data.error) throw new Error(typeof data.error === "string" ? data.error : data.error.message || "Errore chiamata AI");
  if (data.type === "error") throw new Error(data.error?.message || "Errore chiamata AI");
  const raw = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("") || "";
  if (!raw) throw new Error("Risposta vuota dal modello.");
  return raw;
}

// Claude a volte antepone/pospone del testo al JSON nonostante l'istruzione
// "solo JSON" (più probabile con input visivo + schema complesso): invece di
// assumere che l'intera stringa ripulita sia JSON puro, estrae la sottostringa
// dalla prima "{" all'ultima "}".
function parseJsonResponse(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Il modello non ha risposto con un JSON valido. Riprova.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ── Shared styles ────────────────────────────────────────────────────────────

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

const goldBtn = (disabled) => ({
  background: disabled ? "#2a2a2a" : `linear-gradient(135deg, ${GOLD}, #A8813F)`,
  color: disabled ? WARM_GREY : DARK,
  border: "none",
  borderRadius: 9,
  padding: "10px 22px",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "'Space Grotesk', sans-serif",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "opacity 0.2s",
  opacity: disabled ? 0.5 : 1,
});

// ── Engagement helper ────────────────────────────────────────────────────────

function engRate(post) {
  // Preferisci il total_interactions ufficiale di Instagram (like+commenti+saves+
  // condivisioni); se assente ricostruiscilo dai singoli campi disponibili.
  const ins = post.insights || {};
  const interactions = ins.total_interactions
    || (post.like_count || ins.likes || 0) + (post.comments_count || ins.comments || 0) + (ins.saved || 0) + (ins.shares || 0);
  const reach = ins.reach || 0;
  if (!reach) return 0;
  return (interactions / reach) * 100;
}

function mediaLabel(type) {
  if (type === "IMAGE") return "Foto";
  if (type === "VIDEO") return "Video / Reel";
  if (type === "CAROUSEL_ALBUM") return "Carosello";
  return type;
}

// Legge una metrica del post: likes/comments dai campi media (più affidabili),
// il resto dagli insights. 0 se assente.
function metric(post, key) {
  if (key === "likes") return post.like_count ?? post.insights?.likes ?? 0;
  if (key === "comments") return post.comments_count ?? post.insights?.comments ?? 0;
  return post.insights?.[key] ?? 0;
}

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
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
            <span style={{ minWidth: 22, height: 22, borderRadius: "50%", background: `${GOLD}20`, border: `1px solid ${GOLD}40`, color: GOLD, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", flexShrink: 0, marginTop: 1 }}>
              {n}
            </span>
            <div style={{ fontSize: 13, color: WARM_GREY, lineHeight: 1.6 }}>
              {text}
              {code && <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, color: GOLD, background: "#0a0a0a", padding: "4px 8px", borderRadius: 6, display: "inline-block" }}>{code}</div>}
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
            borderRadius: 9, color: OFF_WHITE, padding: "10px 12px", fontSize: 12,
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
                borderRadius: 9, color: OFF_WHITE, padding: "10px 12px", fontSize: 13,
                fontFamily: "'Space Grotesk', sans-serif", outline: "none", cursor: "pointer",
              }}
            >
              {pages.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 9, color: "#ff7070", fontSize: 12 }}>
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
      <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: WARM_GREY, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, marginBottom: 10 }}>
        {lbl}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: GOLD, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>
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
      <div style={{ fontSize: 12, color: WARM_GREY, minWidth: 20, textAlign: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
        #{rank}
      </div>
      {thumb ? (
        <img src={thumb} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 9, border: "1px solid rgba(201,169,110,0.15)", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: 9, background: CARD2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
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
        <div style={{ fontSize: 15, fontWeight: 700, color: GOLD, fontFamily: "'Space Grotesk', sans-serif" }}>{eng}%</div>
        <div style={{ fontSize: 10, color: WARM_GREY }}>engagement</div>
        <div style={{ fontSize: 10, color: WARM_GREY, marginTop: 2 }}>
          ❤ {post.like_count || 0} · 💬 {post.comments_count || 0} · 🔖 {post.insights?.saved || 0}
        </div>
      </div>
    </div>
  );
}

// ── Lista completa post (ordinabile, metriche estese) ────────────────────────

const POST_SORTS = [
  { id: "date_desc", label: "Data ↓", fn: (a, b) => new Date(b.timestamp) - new Date(a.timestamp) },
  { id: "date_asc",  label: "Data ↑", fn: (a, b) => new Date(a.timestamp) - new Date(b.timestamp) },
  { id: "eng",       label: "Engagement", fn: (a, b) => engRate(b) - engRate(a) },
  { id: "reach",     label: "Reach", fn: (a, b) => metric(b, "reach") - metric(a, "reach") },
  { id: "interactions", label: "Interazioni", fn: (a, b) => metric(b, "total_interactions") - metric(a, "total_interactions") },
];

const POST_METRIC_COLS = [
  { key: "reach", label: "Reach" },
  { key: "likes", label: "Like" },
  { key: "comments", label: "Commenti" },
  { key: "saved", label: "Salvati" },
  { key: "shares", label: "Condivisi" },
  { key: "total_interactions", label: "Interaz." },
  { key: "views", label: "Views", videoOnly: true },
  { key: "profile_visits", label: "Visite prof." },
  { key: "follows", label: "Nuovi follow" },
];

function AllPostsRow({ post }) {
  const isVideo = post.media_type === "VIDEO";
  const thumb = post.thumbnail_url || post.media_url;
  const cols = POST_METRIC_COLS.filter(c => !c.videoOnly || isVideo);
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid rgba(201,169,110,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 9, border: "1px solid rgba(201,169,110,0.15)", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: 9, background: CARD2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
            {isVideo ? "🎬" : post.media_type === "CAROUSEL_ALBUM" ? "🖼" : "📸"}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, color: WARM_GREY, marginBottom: 2 }}>
            <span style={{ color: GOLD }}>{mediaLabel(post.media_type)}</span>
            <span style={{ margin: "0 5px" }}>·</span>
            {new Date(post.timestamp).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}
            {" "}{String(new Date(post.timestamp).getHours()).padStart(2, "0")}:{String(new Date(post.timestamp).getMinutes()).padStart(2, "0")}
          </div>
          <div style={{ fontSize: 11.5, color: OFF_WHITE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {post.caption ? post.caption.slice(0, 90) : <span style={{ color: WARM_GREY, fontStyle: "italic" }}>Nessuna caption</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: GOLD, fontFamily: "'Space Grotesk', sans-serif" }}>{engRate(post).toFixed(1)}%</div>
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: IG_PINK, textDecoration: "none" }}>apri ↗</a>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, gap: 4, paddingLeft: 52 }}>
        {cols.map(c => {
          const v = metric(post, c.key);
          return (
            <div key={c.key} style={{ textAlign: "center", background: CARD2, borderRadius: 8, padding: "5px 2px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: v ? OFF_WHITE : "#555", fontFamily: "'Space Grotesk', sans-serif" }}>{v ? fmtNum(v) : "—"}</div>
              <div style={{ fontSize: 7.5, color: WARM_GREY, textTransform: "uppercase", letterSpacing: "0.03em", marginTop: 1 }}>{c.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllPostsList({ posts }) {
  const [sort, setSort] = useState("date_desc");
  const [open, setOpen] = useState(true);
  const sorted = useMemo(() => {
    const s = POST_SORTS.find(x => x.id === sort) || POST_SORTS[0];
    return [...posts].sort(s.fn);
  }, [posts, sort]);

  return (
    <div style={{ ...card, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: open ? 12 : 0 }}>
        <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", color: OFF_WHITE, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", padding: 0 }}>
          {open ? "▾" : "▸"} Tutti i post ({posts.length})
        </button>
        {open && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {POST_SORTS.map(s => (
              <button key={s.id} onClick={() => setSort(s.id)}
                style={{ padding: "4px 9px", borderRadius: 9, border: `1px solid ${sort === s.id ? GOLD : "#2a2a2a"}`, background: sort === s.id ? `${GOLD}18` : "transparent", color: sort === s.id ? GOLD : WARM_GREY, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && sorted.map(p => <AllPostsRow key={p.id} post={p} />)}
    </div>
  );
}

// ── Panoramica account ──────────────────────────────────────────────────────

function DemographicBars({ title, results, mapLabel }) {
  if (!results?.length) return null;
  const rows = [...results]
    .map(r => ({ label: mapLabel ? mapLabel(r.dimension_values?.[0]) : r.dimension_values?.[0], value: r.value || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 10, color: WARM_GREY, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>{title}</div>
      {rows.map(r => (
        <div key={r.label} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: OFF_WHITE, marginBottom: 2 }}>
            <span>{r.label}</span><span style={{ color: GOLD, fontWeight: 700 }}>{fmtNum(r.value)}</span>
          </div>
          <div style={{ height: 3, background: "#2a2a2a", borderRadius: 2 }}>
            <div style={{ height: "100%", width: `${(r.value / max) * 100}%`, background: GOLD, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const COUNTRY_NAMES = { IT: "Italia", US: "USA", GB: "Regno Unito", DE: "Germania", FR: "Francia", ES: "Spagna", CH: "Svizzera", NL: "Olanda", BE: "Belgio", AT: "Austria", PT: "Portogallo", BR: "Brasile", RU: "Russia" };

function AccountOverviewPanel({ account }) {
  if (!account) return null;
  const hasDemographics = account.dem_country?.length || account.dem_age?.length || account.dem_gender?.length;
  const tiles = [
    { label: "Follower", value: account.followers_count },
    { label: "Seguiti", value: account.follows_count },
    { label: "Post totali", value: account.media_count },
    { label: "Reach 28gg", value: account.reach_28d },
    { label: "Visite profilo 28gg", value: account.profile_views_28d },
  ].filter(t => t.value != null);

  return (
    <div style={{ ...card, marginBottom: 24 }}>
      <div style={{ ...label, marginBottom: 14 }}>👤 Panoramica Account</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: hasDemographics ? 20 : 0 }}>
        {tiles.map(t => (
          <div key={t.label} style={{ background: CARD2, borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: GOLD, fontFamily: "'Space Grotesk', sans-serif" }}>{fmtNum(t.value)}</div>
            <div style={{ fontSize: 9, color: WARM_GREY, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>{t.label}</div>
          </div>
        ))}
      </div>
      {hasDemographics ? (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <DemographicBars title="Paesi" results={account.dem_country} mapLabel={c => COUNTRY_NAMES[c] || c} />
          <DemographicBars title="Età" results={account.dem_age} />
          <DemographicBars title="Genere" results={account.dem_gender} mapLabel={g => ({ M: "Uomini", F: "Donne", U: "N/D" }[g] || g)} />
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>Demografia follower non disponibile (richiede &gt;100 follower o permessi insights).</div>
      )}
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
      <div style={{ fontSize: 13, fontWeight: 700, color: GOLD, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function NextPostCard({ post, onSuggestBrief, saved, onMarkUsed }) {
  return (
    <div style={{ background: CARD2, border: "1px solid rgba(201,169,110,0.15)", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: OFF_WHITE }}>{post.idea}</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {post.hook_type && (
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "rgba(124,106,155,0.18)", color: "#9E8FBF", fontWeight: 700, whiteSpace: "nowrap" }}>{post.hook_type}</span>
          )}
          {post.content_type && (
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: `${IG_PINK}18`, color: IG_PINK, fontWeight: 700, whiteSpace: "nowrap" }}>{post.content_type}</span>
          )}
        </div>
      </div>
      {post.hook && (
        <div style={{ fontSize: 12.5, color: OFF_WHITE, fontStyle: "italic", lineHeight: 1.5, marginBottom: 8, paddingLeft: 10, borderLeft: `2px solid ${IG_PINK}55` }}>“{post.hook}”</div>
      )}
      {post.rationale && <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.5, marginBottom: 10 }}>{post.rationale}</div>}
      <button
        onClick={() => { onSuggestBrief([post.hook, post.visual_scout_brief].filter(Boolean).join(" — ") || post.idea); onMarkUsed?.(); }}
        disabled={!post.visual_scout_brief && !post.idea}
        style={{ ...goldBtn(false), background: `linear-gradient(135deg, ${IG_PINK}, #c0254e)`, color: "#fff", fontSize: 10, padding: "8px 14px" }}
      >
        {saved === false ? "✓ Inviato a Visual Scout" : "🎯 Genera con Visual Scout →"}
      </button>
    </div>
  );
}

// ── Sponsorizzate (Meta Ads) ───────────────────────────────────────────────

const GENDER_LABEL = { 1: "Uomini", 2: "Donne" };

// Riassume l'oggetto targeting di un adset in qualcosa di leggibile + estrae gli
// interessi (le "parole chiave del target" richieste dall'utente).
function summarizeTargeting(t) {
  if (!t || typeof t !== "object") return { line: "Targeting non disponibile", interests: [] };
  const parts = [];
  if (t.age_min || t.age_max) parts.push(`${t.age_min || 13}-${t.age_max || 65} anni`);
  const g = Array.isArray(t.genders) ? t.genders.map(x => GENDER_LABEL[x]).filter(Boolean).join("/") : "";
  if (g) parts.push(g); else parts.push("tutti i generi");

  const geo = t.geo_locations || {};
  const geoBits = [
    ...(geo.countries || []),
    ...(geo.regions || []).map(r => r.name),
    ...(geo.cities || []).map(c => c.name),
  ];
  if (geoBits.length) parts.push(geoBits.slice(0, 4).join(", "));
  if (geo.custom_locations?.length) parts.push(`${geo.custom_locations.length} aree su mappa`);
  if (t.custom_audiences?.length) parts.push(`${t.custom_audiences.length} pubblici personalizzati`);

  const interests = [];
  (t.flexible_spec || []).forEach(spec => {
    (spec.interests || []).forEach(i => i.name && interests.push(i.name));
    (spec.behaviors || []).forEach(b => b.name && interests.push(b.name));
    (spec.life_events || []).forEach(l => l.name && interests.push(l.name));
  });
  (t.interests || []).forEach(i => i.name && interests.push(i.name));

  const advantage = t.targeting_automation?.advantage_audience === 1 || t.targeting_optimization === "expansion_all";
  return {
    line: parts.join(" · ") + (advantage ? " · Advantage+ (pubblico automatico)" : ""),
    interests: [...new Set(interests)],
    advantage,
  };
}

function adResults(ins) {
  const row = ins?.data?.[0] || {};
  const n = v => (v == null ? null : Number(v));
  const actions = {};
  (row.actions || []).forEach(a => { actions[a.action_type] = n(a.value); });
  const cpa = {};
  (row.cost_per_action_type || []).forEach(a => { cpa[a.action_type] = n(a.value); });
  return {
    spend: n(row.spend), reach: n(row.reach), impressions: n(row.impressions),
    clicks: n(row.clicks), ctr: n(row.ctr), cpc: n(row.cpc), freq: n(row.frequency), actions, cpa,
  };
}

// L'ID dell'account Instagram che ha pubblicato la sponsorizzata (per filtrare
// solo quelle della pagina del progetto).
function adInstagramActorId(cr) {
  if (!cr) return null;
  const spec = cr.object_story_spec || {};
  return String(spec.instagram_actor_id || spec.instagram_user_id || cr.instagram_actor_id || "") || null;
}

// Da quale contenuto è partita la sponsorizzata (post IG, immagine, ecc.).
function adCreativeInfo(cr) {
  if (!cr) return null;
  const spec = cr.object_story_spec || {};
  const link = cr.instagram_permalink_url
    || (spec.link_data?.link)
    || (cr.effective_object_story_id ? `https://www.facebook.com/${cr.effective_object_story_id.replace("_", "/posts/")}` : null);
  const caption = cr.body || spec.link_data?.message || spec.video_data?.message || spec.photo_data?.caption || cr.title || "";
  const thumb = cr.thumbnail_url || cr.image_url || spec.link_data?.picture || null;
  const kind = cr.instagram_permalink_url ? "Post Instagram"
    : cr.object_type === "VIDEO" ? "Video"
    : cr.object_type === "SHARE" || spec.link_data ? "Post con link"
    : cr.object_type === "PHOTO" ? "Foto"
    : "Contenuto";
  return { link, caption: caption.slice(0, 160), thumb, kind, name: cr.name };
}

function AdsPanel({ brand, igAccountId, igUsername }) {
  const [status, setStatus] = useState(null); // null=checking, {connected,...}
  const [accounts, setAccounts] = useState(null);
  const [acctId, setAcctId] = useState(() => localStorage.getItem("fb_ad_account") || "");
  const [ads, setAds] = useState(() => readJsonLS("fb_ads_list", null));
  const [fetchedAt, setFetchedAt] = useState(() => localStorage.getItem("fb_ads_fetched_at") || "");
  const [loading, setLoading] = useState("");
  const [err, setErr] = useState("");
  const [analysis, setAnalysis] = useState(() => readJsonLS("fb_ads_analysis", null));
  const [analyzing, setAnalyzing] = useState(false);
  const [tokenPaste, setTokenPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [datePreset, setDatePreset] = useState(() => localStorage.getItem("fb_ads_date") || "last_90d");
  useEffect(() => { try { localStorage.setItem("fb_ads_date", datePreset); } catch {} }, [datePreset]);
  // Account IG rilevati tra le sponsorizzate caricate (server risolve a._ig).
  const igOptions = (() => {
    const map = new Map();
    (ads || []).forEach(a => {
      const ig = a._ig;
      if (!ig) return;
      const key = String(ig.username || ig.id);
      if (!map.has(key)) map.set(key, { key, id: ig.id, username: ig.username || null, count: 0 });
      map.get(key).count++;
    });
    return [...map.values()];
  })();
  const handle = (brand?.instagramHandle || igUsername || "").replace(/^@/, "").toLowerCase();
  const [igFilter, setIgFilter] = useState("auto"); // "auto" | "all" | key
  const autoMatch = igOptions.find(o => o.username && o.username.toLowerCase() === handle);
  const activeKey = igFilter === "auto" ? (autoMatch?.key || "all") : igFilter;
  const shownAds = activeKey === "all" ? (ads || [])
    : (ads || []).filter(a => a._ig && String(a._ig.username || a._ig.id) === activeKey);
  const noIgInfo = (ads || []).length > 0 && igOptions.length === 0;

  const checkStatus = () => fetch("/api/instagram?action=fb_status").then(r => r.json()).then(setStatus).catch(() => setStatus({ connected: false }));

  async function connectWithToken() {
    if (!tokenPaste.trim()) return;
    setErr(""); setLoading("token");
    try {
      const r = await fetch("/api/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fb_action: "connect_token", token: tokenPaste.trim() }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setTokenPaste(""); setShowPaste(false);
      await checkStatus();
      loadAccounts();
    } catch (e) { setErr(e.message); }
    setLoading("");
  }
  useEffect(() => { checkStatus(); }, []);
  useEffect(() => {
    const onMsg = e => { if (e.data === "fb_connected") { checkStatus(); loadAccounts(); } };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => { try { analysis ? localStorage.setItem("fb_ads_analysis", JSON.stringify(analysis)) : localStorage.removeItem("fb_ads_analysis"); } catch {} }, [analysis]);

  async function loadAccounts() {
    setErr(""); setLoading("accounts");
    try {
      const r = await fetch("/api/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fb_action: "adaccounts" }) });
      const d = await r.json();
      if (d.error) throw new Error(d.message || d.error);
      setAccounts(d.accounts || []);
      if (!acctId && d.accounts?.[0]) { setAcctId(d.accounts[0].id); localStorage.setItem("fb_ad_account", d.accounts[0].id); }
    } catch (e) { setErr(e.message); }
    setLoading("");
  }

  async function loadAds() {
    if (!acctId) return;
    setErr(""); setLoading("ads"); setAds(null);
    localStorage.setItem("fb_ad_account", acctId);
    try {
      const targets = acctId === "__all__" ? (accounts || []).map(a => a.id) : [acctId];
      const results = await Promise.all(targets.map(async id => {
        const r = await fetch("/api/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fb_action: "ads", ad_account_id: id, date_preset: datePreset }) });
        const d = await r.json();
        if (d.error) throw new Error(d.message || d.error);
        return (d.ads || []).map(a => ({ ...a, _acct: id }));
      }));
      const list = results.flat();
      setAds(list);
      const now = new Date().toISOString();
      setFetchedAt(now);
      try {
        localStorage.setItem("fb_ads_list", JSON.stringify(list));
        localStorage.setItem("fb_ads_fetched_at", now);
      } catch {}
    } catch (e) { setErr(e.message); }
    setLoading("");
  }

  useEffect(() => { if (status?.connected && accounts === null) loadAccounts(); /* eslint-disable-next-line */ }, [status?.connected]);

  async function analyzeAds() {
    if (!shownAds?.length) return;
    setAnalyzing(true); setErr("");
    const rows = shownAds.map(a => {
      const tg = summarizeTargeting(a.adset?.targeting);
      const m = adResults(a.insights);
      const cr = adCreativeInfo(a.creative);
      const results = Object.entries(m.actions).filter(([k]) => /lead|purchase|link_click|landing_page_view|messaging|onsite_conversion/.test(k));
      return {
        nome: a.name, stato: a.effective_status,
        contenuto: cr ? `${cr.kind}: ${(cr.caption || cr.name || "").slice(0, 80)}` : null,
        target: tg.line, interessi: tg.interests.slice(0, 10),
        spesa: m.spend, reach: m.reach, ctr: m.ctr, cpc: m.cpc, frequenza: m.freq,
        risultati: Object.fromEntries(results),
        costo_per_risultato: Object.fromEntries(Object.entries(m.cpa).filter(([k]) => results.some(([rk]) => rk === k))),
      };
    });
    const brandCtx = brand?.name ? ` BRAND: ${brand.name}${brand.sector ? ` (${brand.sector})` : ""}.` : "";
    const system = `Sei un media buyer Meta Ads senior.${brandCtx} Analizza le sponsorizzate Instagram/Facebook e rispondi SOLO con JSON valido (no markdown, no testo extra).
Struttura ESATTA:
{"riepilogo":"UNA frase, max 22 parole","audience_migliori":[{"chi":"max 10 parole","perche":"cita numeri: spesa/CPC/costo per risultato, max 16 parole"}],"da_tagliare":[{"chi":"max 10 parole","perche":"max 14 parole"}],"target_consigliato":{"eta":"25-45","genere":"tutti|donne|uomini","aree":"max 8 parole","interessi":["interesse Meta 1","interesse 2","interesse 3","interesse 4"],"note":"max 16 parole"},"prossimo_test":"max 20 parole","budget":"max 16 parole"}
REGOLE: max 3 elementi per lista. Nessun markdown. Numeri concreti dai dati. Interessi = interessi reali di targeting Meta (ampi e trovabili).`;
    try {
      const raw = await callClaude(system, `Sponsorizzate reali (ultimi 90 giorni):\n${JSON.stringify(rows)}`, []);
      const parsed = parseJsonResponse(raw);
      setAnalysis(parsed);
      // Storico + memoria di progetto (Dashboard + Visual Scout).
      if (brand?.id) {
        saveToHistory({ project_id: brand.id, type: "ads_analysis", prompt: `Analisi ${shownAds.length} sponsorizzate`, result_json: parsed });
        const rt = parsed.target_consigliato || {};
        fetch("/api/history?action=merge_insights", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "merge_insights", project_id: brand.id,
            ad_strategy: {
              riepilogo: parsed.riepilogo || "",
              eta: rt.eta || "", genere: rt.genere || "", aree: rt.aree || "",
              interessi: rt.interessi || [], note: rt.note || "",
              prossimo_test: parsed.prossimo_test || "", budget: parsed.budget || "",
              audience_migliori: (parsed.audience_migliori || []).map(x => x.chi).filter(Boolean),
              da_tagliare: (parsed.da_tagliare || []).map(x => x.chi).filter(Boolean),
            },
          }),
        }).catch(() => {});
      }
    } catch (e) { setErr("Analisi AI: " + e.message); }
    setAnalyzing(false);
  }

  // ── Render ──
  if (status === null) return null;

  if (!status.connected) {
    return (
      <div style={{ ...card, marginBottom: 24, borderColor: "rgba(24,119,242,0.25)" }}>
        <div style={{ ...label, marginBottom: 8, color: "#4A90E2" }}>💰 Analisi Sponsorizzate (Meta Ads)</div>
        <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.6, marginBottom: 14 }}>
          Collega Facebook per vedere il <strong>target e gli interessi usati</strong> nelle tue promozioni Instagram/Facebook, spesa, reach e costo per risultato — e farti consigliare il targeting migliore.
          <br /><span style={{ fontSize: 11, opacity: 0.7 }}>Serve un account IG collegato a una Pagina FB dentro un Business Manager con un account pubblicitario.</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => window.open("/api/instagram?action=fb_login", "_blank", "width=680,height=760")}
            style={{ ...goldBtn(false), background: "linear-gradient(135deg, #1877F2, #0C5AC7)", color: "#fff" }}
          >
            Connetti Facebook (Ads)
          </button>
          <button onClick={() => setShowPaste(v => !v)}
            style={{ background: "transparent", border: "1px solid #333", borderRadius: 9, color: WARM_GREY, padding: "10px 14px", fontSize: 10, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
            {showPaste ? "Chiudi" : "oppure incolla un token"}
          </button>
        </div>

        {showPaste && (
          <div style={{ marginTop: 14, padding: 14, background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.15)", borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: WARM_GREY, lineHeight: 1.6, marginBottom: 10 }}>
              Da <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ color: "#4A90E2" }}>Graph API Explorer</a>: seleziona la tua app → aggiungi i permessi <code style={{ color: GOLD }}>ads_read</code> <code style={{ color: GOLD }}>instagram_basic</code> <code style={{ color: GOLD }}>pages_read_engagement</code> → <strong>Generate Access Token</strong> → copia e incolla qui. Lo converto in token da ~60 giorni. (<code>instagram_basic</code> serve per distinguere le sponsorizzate per account IG.)
            </div>
            <textarea value={tokenPaste} onChange={e => setTokenPaste(e.target.value)} rows={3} placeholder="EAAxxxxxxxxxxxx..."
              style={{ width: "100%", background: "#141414", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 8, color: OFF_WHITE, padding: "9px 11px", fontSize: 11, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
            <button onClick={connectWithToken} disabled={!tokenPaste.trim() || loading === "token"}
              style={{ ...goldBtn(!tokenPaste.trim() || loading === "token"), marginTop: 8, fontSize: 10 }}>
              {loading === "token" ? "Verifico…" : "Collega con questo token"}
            </button>
          </div>
        )}

        {err && <div style={{ marginTop: 12, fontSize: 12, color: "#ff7070" }}>{err}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...card, marginBottom: 24, borderColor: "rgba(24,119,242,0.25)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ ...label, marginBottom: 0, color: "#4A90E2" }}>💰 Analisi Sponsorizzate</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {status.expires_in_days != null && (
            <span style={{ fontSize: 9, color: status.expires_in_days < 7 ? "#E4A050" : "#555" }}>
              token ~{status.expires_in_days}gg{status.expires_in_days < 7 ? " · sta per scadere, ricollega" : ""}
            </span>
          )}
          <button onClick={() => setShowPaste(v => !v)}
            style={{ background: "transparent", border: "1px solid #333", borderRadius: 8, color: WARM_GREY, padding: "5px 10px", fontSize: 10, cursor: "pointer" }}>
            Aggiorna token
          </button>
          <button onClick={() => { fetch("/api/instagram?action=fb_logout").then(() => { setStatus({ connected: false }); setAds(null); setAccounts(null); }); try { ["fb_ads_list", "fb_ads_fetched_at"].forEach(k => localStorage.removeItem(k)); } catch {} }}
            style={{ background: "transparent", border: "1px solid #333", borderRadius: 8, color: WARM_GREY, padding: "5px 10px", fontSize: 10, cursor: "pointer" }}>
            Disconnetti FB
          </button>
        </div>
      </div>

      {showPaste && (
        <div style={{ marginBottom: 16, padding: 12, background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.15)", borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: WARM_GREY, marginBottom: 8 }}>Incolla un nuovo token <code style={{ color: GOLD }}>ads_read</code> da Graph API Explorer (lo converto in ~60gg).</div>
          <textarea value={tokenPaste} onChange={e => setTokenPaste(e.target.value)} rows={2} placeholder="EAAxxxxxxxxxxxx..."
            style={{ width: "100%", background: "#141414", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 8, color: OFF_WHITE, padding: "8px 10px", fontSize: 11, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
          <button onClick={connectWithToken} disabled={!tokenPaste.trim() || loading === "token"} style={{ ...goldBtn(!tokenPaste.trim() || loading === "token"), marginTop: 8, fontSize: 10 }}>
            {loading === "token" ? "Verifico…" : "Salva token"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <select value={acctId} onChange={e => setAcctId(e.target.value)}
          style={{ background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 8, color: OFF_WHITE, padding: "8px 10px", fontSize: 12, minWidth: 180 }}>
          {accounts === null && <option>Carico account…</option>}
          {accounts?.length > 1 && <option value="__all__">Tutti gli account pubblicitari</option>}
          {(accounts || []).map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          {accounts?.length === 0 && <option value="">Nessun account pubblicitario</option>}
        </select>
        <select value={datePreset} onChange={e => setDatePreset(e.target.value)}
          style={{ background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 8, color: OFF_WHITE, padding: "8px 10px", fontSize: 12 }}>
          <option value="last_30d">Ultimi 30 giorni</option>
          <option value="last_90d">Ultimi 90 giorni</option>
          <option value="this_year">Quest'anno</option>
          <option value="last_year">Anno scorso</option>
          <option value="maximum">Sempre</option>
        </select>
        <button onClick={loadAds} disabled={!acctId || loading === "ads"} style={{ ...goldBtn(!acctId || loading === "ads"), fontSize: 10 }}>
          {loading === "ads" ? "Carico…" : "Carica sponsorizzate"}
        </button>
        {shownAds?.length > 0 && (
          <button onClick={analyzeAds} disabled={analyzing}
            style={{ ...goldBtn(analyzing), background: analyzing ? "#2a2a2a" : "linear-gradient(135deg, #E1306C, #c0254e)", color: analyzing ? WARM_GREY : "#fff", fontSize: 10 }}>
            {analyzing ? "Analisi…" : "🎯 Analizza con Claude"}
          </button>
        )}
      </div>

      {ads?.length > 0 && igOptions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: WARM_GREY }}>Account Instagram:</span>
            <select value={igFilter} onChange={e => setIgFilter(e.target.value)}
              style={{ background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 8, color: OFF_WHITE, padding: "6px 8px", fontSize: 11 }}>
              {autoMatch && <option value="auto">@{autoMatch.username} (del progetto)</option>}
              <option value="all">Tutti gli account ({ads.length})</option>
              {igOptions.map(o => (
                <option key={o.key} value={o.key}>{o.username ? `@${o.username}` : `ID ${o.id}`} ({o.count})</option>
              ))}
            </select>
          </div>
          {!autoMatch && handle && (
            <div style={{ fontSize: 10, color: "#E4A050", marginTop: 6 }}>
              Nessuna sponsorizzata di @{handle} in questo periodo/account. Trovate: {igOptions.map(o => o.username ? `@${o.username}` : `ID ${o.id}`).join(", ")}. Prova "Sempre" o "Tutti gli account pubblicitari" qui sopra.
            </div>
          )}
        </div>
      )}

      {err && <div style={{ marginBottom: 12, fontSize: 12, color: "#ff7070" }}>{err}</div>}

      {fetchedAt && ads?.length > 0 && (
        <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>
          {shownAds.length}{shownAds.length !== ads.length ? ` di ${ads.length}` : ""} sponsorizzate · aggiornate il {new Date(fetchedAt).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          {noIgInfo && <span style={{ color: "#E4A050" }}> · non riesco a distinguere gli account IG con questo token (aggiungi lo scope instagram_basic o pages_read_engagement)</span>}
        </div>
      )}

      {ads?.length === 0 && <div style={{ fontSize: 12, color: "#666" }}>Nessuna sponsorizzata negli ultimi 90 giorni su questo account.</div>}
      {ads?.length > 0 && shownAds.length === 0 && (
        <div style={{ fontSize: 12, color: "#666" }}>Nessuna sponsorizzata per l'account IG selezionato. Scegli "Tutti gli account".</div>
      )}

      {shownAds.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: analysis ? 20 : 0 }}>
          {shownAds.map((a, i) => {
            const tg = summarizeTargeting(a.adset?.targeting);
            const m = adResults(a.insights);
            const cr = adCreativeInfo(a.creative);
            return (
              <div key={i} style={{ background: "#141414", border: "1px solid rgba(201,169,110,0.1)", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 12.5, color: OFF_WHITE, fontWeight: 600 }}>{a.name}</div>
                  <span style={{ fontSize: 9, color: a.effective_status === "ACTIVE" ? "#5ABA5A" : "#888", fontWeight: 700, whiteSpace: "nowrap" }}>{a.effective_status}</span>
                </div>
                {cr && (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8, padding: "8px", background: "#0E0E0E", borderRadius: 10 }}>
                    {cr.thumb && <img src={cr.thumb} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, color: "#8B7355", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                        Contenuto sponsorizzato · {cr.kind}
                      </div>
                      {cr.caption && <div style={{ fontSize: 11, color: "#C9BEA8", lineHeight: 1.45 }}>{cr.caption}{cr.caption.length >= 160 ? "…" : ""}</div>}
                      {cr.link && <a href={cr.link} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#4A90E2" }}>↗ Apri il post</a>}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#B9AE98", marginBottom: 8, lineHeight: 1.5 }}>🎯 {tg.line}</div>
                {tg.interests.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                    {tg.interests.slice(0, 12).map((x, j) => (
                      <span key={j} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, background: "rgba(74,144,226,0.12)", color: "#7FB4EE" }}>{x}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: WARM_GREY }}>
                  {m.spend != null && <span>Spesa <strong style={{ color: GOLD }}>{m.spend.toFixed(2)}</strong></span>}
                  {m.reach != null && <span>Reach <strong style={{ color: OFF_WHITE }}>{m.reach.toLocaleString("it-IT")}</strong></span>}
                  {m.ctr != null && <span>CTR <strong style={{ color: OFF_WHITE }}>{m.ctr.toFixed(2)}%</strong></span>}
                  {m.cpc != null && <span>CPC <strong style={{ color: OFF_WHITE }}>{m.cpc.toFixed(2)}</strong></span>}
                  {Object.entries(m.actions).filter(([k]) => /lead|purchase|link_click|messaging_conversation|landing_page_view/.test(k)).slice(0, 2).map(([k, v]) => (
                    <span key={k}>{k.replace(/_/g, " ").replace("onsite conversion.", "")} <strong style={{ color: "#5ABA5A" }}>{v}</strong>{m.cpa[k] != null ? ` (${m.cpa[k].toFixed(2)}/cad)` : ""}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {analyzing && <div style={{ fontSize: 12, color: WARM_GREY, marginTop: 12 }}>Claude sta analizzando il targeting e i risultati…</div>}

      {analysis && <AdsAnalysis data={analysis} />}
    </div>
  );
}

function AdsAnalysis({ data }) {
  const List = ({ items, color }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {(items || []).map((it, i) => (
        <div key={i} style={{ fontSize: 12, color: OFF_WHITE, lineHeight: 1.5 }}>
          <span style={{ color, fontWeight: 700 }}>{it.chi}</span>{it.perche ? ` — ${it.perche}` : ""}
        </div>
      ))}
    </div>
  );
  const rt = data.target_consigliato || {};
  return (
    <div style={{ marginTop: 6, paddingTop: 16, borderTop: "1px solid rgba(201,169,110,0.12)" }}>
      <div style={{ ...label, marginBottom: 10, color: "#E1306C" }}>🎯 Analisi Claude</div>
      {data.riepilogo && <div style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.6, marginBottom: 16, background: "rgba(225,48,108,0.06)", borderLeft: "3px solid #E1306C", borderRadius: 10, padding: "10px 14px" }}>{data.riepilogo}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div><div style={{ ...label, marginBottom: 8, color: "#5ABA5A" }}>✓ Audience migliori</div><List items={data.audience_migliori} color="#5ABA5A" /></div>
        <div><div style={{ ...label, marginBottom: 8, color: "#E4A050" }}>✕ Da tagliare</div><List items={data.da_tagliare} color="#E4A050" /></div>
      </div>
      <div style={{ background: "#141414", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ ...label, marginBottom: 10 }}>Target consigliato per il prossimo boost</div>
        <div style={{ fontSize: 12, color: WARM_GREY, lineHeight: 1.7 }}>
          {rt.eta && <>Età <strong style={{ color: OFF_WHITE }}>{rt.eta}</strong> · </>}
          {rt.genere && <>Genere <strong style={{ color: OFF_WHITE }}>{rt.genere}</strong> · </>}
          {rt.aree && <>Aree <strong style={{ color: OFF_WHITE }}>{rt.aree}</strong></>}
        </div>
        {!!rt.interessi?.length && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
            {rt.interessi.map((x, i) => <span key={i} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: "rgba(74,144,226,0.14)", color: "#7FB4EE" }}>{x}</span>)}
          </div>
        )}
        {rt.note && <div style={{ fontSize: 11, color: WARM_GREY, fontStyle: "italic", marginTop: 8 }}>{rt.note}</div>}
      </div>
      {data.prossimo_test && <div style={{ fontSize: 12, color: OFF_WHITE, marginBottom: 6 }}><strong style={{ color: GOLD }}>Prossimo test:</strong> {data.prossimo_test}</div>}
      {data.budget && <div style={{ fontSize: 12, color: OFF_WHITE }}><strong style={{ color: GOLD }}>Budget:</strong> {data.budget}</div>}
    </div>
  );
}

function AnalysisPanel({ data, onSuggestBrief, title = "Analisi Strategica · Claude" }) {
  if (!data) return null;
  const { patterns, timing, content_pillars, visual_storytelling: vs, corrections, next_posts } = data;

  return (
    <div style={{ ...card, marginTop: 24 }}>
      <div style={{ ...label, marginBottom: 20 }}>{title}</div>

      {data._visualUnavailable && (
        <div style={{ fontSize: 11, color: "#E4A050", background: "#E4A05012", border: "1px solid #E4A05030", borderRadius: 12, padding: "8px 12px", marginBottom: 20 }}>
          ⚠ Analisi visiva non disponibile questa volta (il resto dell'analisi è comunque completo) — riprova più tardi.
        </div>
      )}

      {patterns?.summary && (
        <AnalysisSection title="📊 Pattern Vincenti">
          <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7, margin: 0, opacity: 0.9 }}>{patterns.summary}</p>
          <ChipList items={patterns.winning_formats} />
        </AnalysisSection>
      )}

      {timing?.summary && (
        <AnalysisSection title="⏰ Timing Ottimale">
          <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7, margin: 0, opacity: 0.9 }}>{timing.summary}</p>
          {timing.best_slot && <div style={{ marginTop: 8, display: "inline-block", fontSize: 12, fontWeight: 700, color: GOLD, background: `${GOLD}15`, padding: "4px 12px", borderRadius: 9 }}>{timing.best_slot}</div>}
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
                      style={{ fontSize: 10, color: GOLD, background: "transparent", border: "1px solid rgba(201,169,110,0.2)", borderRadius: 9, padding: "3px 8px", cursor: "pointer" }}>
                      {expanded ? "Nascondi" : "Dettagli"}
                    </button>
                    <button onClick={() => handleDelete(item.id)}
                      style={{ fontSize: 10, color: "#E47070", background: "transparent", border: "1px solid rgba(180,60,60,0.25)", borderRadius: 9, padding: "3px 8px", cursor: "pointer" }}>
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
  const [account,   setAccount]   = useState(() => readJsonLS("ig_account", null));
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
      if (account) localStorage.setItem("ig_account", JSON.stringify(account));
      else localStorage.removeItem("ig_account");
    } catch {}
  }, [account]);

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

  // Niente più "Carica Post" manuale ogni volta: appena connesso (o al mount,
  // se la sessione persistita non ha ancora post cache) carica da solo. Il
  // pulsante "Aggiorna Feed" resta per un refresh esplicito quando serve.
  useEffect(() => {
    if (isConnected && posts.length === 0 && !loading) fetchPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  function disconnect() {
    ["ig_token", "ig_account_id", "ig_username", "ig_profile_pic", "ig_analysis_json", "ig_posts", "ig_account"].forEach(k => localStorage.removeItem(k));
    setToken(""); setAccountId(""); setUsername(defaultHandle); setProfilePic("");
    setPosts([]); setAccount(null); setAnalysis(null); setError("");
  }

  async function fetchPosts() {
    setLoading(true);
    setError("");
    setPosts([]);
    setAnalysis(null);

    try {
      setStep("Recupero panoramica account…");
      fetchAccountOverview(token, accountId).then(setAccount).catch(() => {});

      setStep("Recupero ultimi 30 post…");
      const mediaRes = await igCall(token, `${accountId}/media`, {
        fields: "id,caption,media_type,media_product_type,timestamp,like_count,comments_count,media_url,thumbnail_url,permalink",
        limit: 30,
      });
      if (mediaRes.error) throw new Error(mediaRes.error.message);

      const mediaList = mediaRes.data || [];
      if (!mediaList.length) throw new Error("Nessun post trovato sull'account.");

      setStep(`Recupero insights per ${mediaList.length} post…`);
      const enriched = await Promise.all(
        mediaList.map(async (post) => ({ ...post, insights: await fetchPostInsights(token, post) }))
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
    fetch("/api/history?action=merge_insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "merge_insights",
        project_id: brand.id,
        tips: parsed.corrections || [],
        strengths: parsed.visual_storytelling?.strengths || [],
        weaknesses: parsed.visual_storytelling?.weaknesses || [],
        strategy: {
          winning_formats: parsed.patterns?.winning_formats || [],
          patterns_summary: parsed.patterns?.summary || "",
          best_slot: parsed.timing?.best_slot || "",
          timing_summary: parsed.timing?.summary || "",
          content_pillars: parsed.content_pillars || [],
          visual_style: parsed.visual_storytelling?.style_description || "",
        },
        calendar_entries: (parsed.next_posts || []).map(p => ({
          idea: p.idea, rationale: p.rationale, content_type: p.content_type,
          hook: p.hook, hook_type: p.hook_type,
          visual_scout_brief: [p.hook, p.visual_scout_brief].filter(Boolean).join(" — ") || p.visual_scout_brief,
        })),
      }),
    }).catch(err => console.warn("[InstagramAnalytics] merge insights fallito:", err.message));
  }

  async function analyze() {
    if (!posts.length) return;
    setAnalyzing(true);
    setError("");

    const postsSummary = [...posts]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(p => ({
        data: fmtDate(p.timestamp),
        ora: `${new Date(p.timestamp).getHours()}:00`,
        tipo: mediaLabel(p.media_type),
        likes: metric(p, "likes"),
        commenti: metric(p, "comments"),
        reach: metric(p, "reach"),
        views: metric(p, "views"),
        saves: metric(p, "saved"),
        condivisioni: metric(p, "shares"),
        interazioni_tot: metric(p, "total_interactions"),
        visite_profilo: metric(p, "profile_visits"),
        nuovi_follow: metric(p, "follows"),
        eng_pct: engRate(p).toFixed(2) + "%",
        caption: (p.caption || "").substring(0, 200),
      }));

    const accountCtx = account
      ? `\nACCOUNT: ${account.followers_count ?? "?"} follower${account.reach_28d != null ? ` | reach 28gg: ${account.reach_28d}` : ""}${account.profile_views_28d != null ? ` | visite profilo 28gg: ${account.profile_views_28d}` : ""}${account.dem_country?.length ? ` | top paesi follower: ${[...account.dem_country].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 3).map(r => r.dimension_values?.[0]).join(", ")}` : ""}${account.dem_age?.length ? ` | fasce età: ${[...account.dem_age].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 2).map(r => r.dimension_values?.[0]).join(", ")}` : ""}`
      : "";

    const priorInsights = await fetchPriorInsights();
    const priorCtx = priorInsights && (priorInsights.tips?.length || priorInsights.strengths?.length || priorInsights.weaknesses?.length)
      ? `\n\nMEMORIA ACCUMULATA DA ANALISI PRECEDENTI DI QUESTO PROGETTO — non ripetere gli stessi identici consigli, verifica se sono stati applicati (confronta con i dati attuali) e approfondisci/evolvi:
${priorInsights.strengths?.length ? `Punti di forza già confermati in passato: ${priorInsights.strengths.join(" | ")}` : ""}
${priorInsights.weaknesses?.length ? `Debolezze già individuate in passato: ${priorInsights.weaknesses.join(" | ")}` : ""}
${priorInsights.tips?.length ? `Consigli già dati in passato: ${priorInsights.tips.join(" | ")}` : ""}`
      : "";

    const brandCtx = brand?.name
      ? `\nBRAND: ${brand.name}${brand.sector ? ` | Settore: ${brand.sector}` : ""}${brand.tone ? ` | Tono: ${brand.tone}` : ""}${brand.description ? `\nDescrizione: ${brand.description}` : ""}`
      : "";

    // Sequencing: dice al modello cosa è stato pubblicato per ultimo, così
    // "next_posts" propone qualcosa di diverso (formato E tema) invece di
    // un'altra idea scenografica simile all'ultima.
    const lastPost = [...posts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    const lastPostCtx = lastPost ? `\nULTIMO CONTENUTO PUBBLICATO: ${mediaLabel(lastPost.media_type)} — "${(lastPost.caption || "").substring(0, 100)}"` : "";

    // Due chiamate separate e in parallelo invece di una sola grande richiesta
    // testo+immagini: quella testuale (patterns/timing/pillars/corrections/
    // next_posts) è la parte essenziale e deve sempre riuscire; quella visiva
    // (foto allegate) è più pesante/rischiosa e a "best effort" — se va in
    // timeout o fallisce, l'analisi resta comunque completa e utile, solo
    // senza la sezione di stile visivo, invece di fallire tutto.
    // IMPORTANTE — trovato testando direttamente in produzione (curl contro
    // vmscout.vercel.app/api/chat con payload realistici): il vero collo di
    // bottiglia non erano le immagini né la dimensione dell'input, ma il
    // MODELLO che, con dati ricchi da analizzare, ignora istruzioni "soft" di
    // brevità e genera analisi lunghissime in markdown (1500-2000+ token di
    // output, a ~45 token/s → oltre 45s con post reali). Con vincoli di
    // concisione FERREI (limite di parole per campo, niente markdown, meno
    // elementi) lo stesso payload di 24 post reali è sceso da >45s (timeout)
    // a ~9s. Le istruzioni sotto sono quelle testate, non un tentativo nuovo.
    const textSystem = `Sei un social media strategist. Analizza i dati e rispondi SOLO con JSON valido (no markdown fences, no testo extra).${brandCtx}${directivesBlock(priorInsights?.directives)}${accountCtx}${priorCtx}${lastPostCtx}

Ogni post nei dati include: reach, likes, commenti, saves, condivisioni, interazioni_tot, visite_profilo, nuovi_follow. Usa condivisioni e saves come segnale di valore/virality, visite_profilo e nuovi_follow come segnale di conversione: cita numeri concreti nelle tue osservazioni.

Struttura ESATTA:
{"patterns":{"summary":"UNA frase, max 20 parole","winning_formats":["formato1","formato2"]},"timing":{"summary":"UNA frase, max 20 parole","best_slot":"es. 19:00-21:00"},"content_pillars":["tema1","tema2","tema3"],"corrections":["max 12 parole","max 12 parole"],"next_posts":[{"idea":"max 6 parole","content_type":"Post|Reel|Carosello","hook_type":"Curiosità|Storia|Valore|Contrarian","hook":"prima riga pronta all'uso, max 12 parole","rationale":"UNA frase, max 15 parole","visual_scout_brief":"max 30 parole, in italiano: soggetto, location/mood"}]}

REGOLE FERREE:
- Genera SOLO 2 elementi in "next_posts".
- SEQUENZA: le 2 idee devono avere formato, tema E hook_type diversi tra loro E diversi dall'ULTIMO CONTENUTO PUBBLICATO (se indicato sopra) — mai la stessa idea scenografica riproposta.
- MIX OBBLIGATORIO: almeno 1 delle 2 idee deve riguardare l'OFFERTA/I SERVIZI CONCRETI del brand (es. pacchetti su misura, prenotazioni, esperienze specifiche, collaborazioni, orari/luoghi dedicati) — non solo atmosfera/paesaggio. L'altra può essere più scenografica/emotiva.
- FRAMEWORK: ogni "correction" nomina la leva concreta (hook debole / pillar poco chiari / CTA assente / carosello senza struttura / poca riprova sociale / timing) + l'azione. "hook" è la prima riga vera del post nel tono del brand. Se content_type è "Carosello", il visual_scout_brief nomina l'architettura (Value-Stack/Problem-Proof/Hack-List/Rant/Demo).
- Ogni campo testuale ha un limite di parole indicato sopra: NON superarlo.
- NON usare markdown (niente #, **, tabelle, emoji decorative).
- NON aggiungere spiegazioni, premesse o testo fuori dal JSON.
- Risposta totale: massimo 400 parole in tutto il JSON.
- Mantieni comunque dati concreti e tono lusso/evocativo, solo estremamente sintetico.

${MARKETING_TOOLKIT_BRIEF}`;

    const textUserMsg = `Dati Instagram reali di ${username || "questo account"} (ultimi ${posts.length} post):

${JSON.stringify(postsSummary)}`;

    // Solo 3 foto e un compito piccolo e mirato: molto più veloce del
    // precedente prompt unico che chiedeva TUTTO (testo + visivo) insieme.
    const topForVision = [...posts].sort((a, b) => engRate(b) - engRate(a)).slice(0, 3);
    const imageUrls = topForVision.map(p => p.thumbnail_url || p.media_url).filter(Boolean);

    const visualSystem = `Sei un direttore artistico esperto di visual storytelling per Instagram.${brandCtx} Guarda le foto allegate e rispondi SOLO con JSON valido (no markdown fences, no testo extra).

Struttura ESATTA:
{"visual_storytelling":{"style_description":"UNA frase, max 20 parole","recurring_elements":["max 3 parole","max 3 parole"],"storytelling_pattern":"UNA frase, max 15 parole","strengths":["max 8 parole"],"weaknesses":["max 8 parole"]}}

REGOLE FERREE:
- NON usare markdown. NON aggiungere testo fuori dal JSON.
- Rispetta i limiti di parole indicati per ogni campo.
- Massimo 1 elemento in "strengths" e in "weaknesses".
- Valuta lo storytelling anche rispetto a: coerenza dei pillar visivi, forza dell'hook nel primo frame/prima slide, architettura del carosello (una sola, riconoscibile), uso etico di leve psicologiche (riprova sociale, peak-end, loop aperti).`;
    const visualUserMsg = `Analizza lo stile visivo di queste ${imageUrls.length} foto, i post più performanti di ${username || "questo account"}.`;

    try {
      const [textSettled, visualSettled] = await Promise.allSettled([
        callClaude(textSystem, textUserMsg, []).then(parseJsonResponse),
        imageUrls.length ? callClaude(visualSystem, visualUserMsg, imageUrls).then(parseJsonResponse) : Promise.reject(new Error("nessuna immagine disponibile")),
      ]);

      if (textSettled.status === "rejected") throw textSettled.reason;
      const parsed = textSettled.value;

      if (visualSettled.status === "fulfilled") {
        parsed.visual_storytelling = visualSettled.value.visual_storytelling || null;
      } else {
        console.warn("[InstagramAnalytics] analisi visiva non disponibile:", visualSettled.reason?.message);
        parsed.visual_storytelling = null;
        parsed._visualUnavailable = true;
      }

      setAnalysis(parsed);
      const saved = await saveToHistory({ project_id: brand?.id, type: "analytics", prompt: textUserMsg, result_json: parsed });
      mergeIntoProjectInsights(parsed);
      if (saved?.ok) setHistoryRefreshKey(k => k + 1);

      // Loop di auto-apprendimento: dopo l'analisi, in background, l'AI riscrive
      // le direttive specifiche del progetto (non blocca la UI).
      if (brand?.id) {
        const vs = parsed.visual_storytelling;
        const ctx = `RISULTATO ANALISI INSTAGRAM (@${username || "account"}, ${posts.length} post):
- pattern: ${parsed.patterns?.summary || "-"} | formati vincenti: ${(parsed.patterns?.winning_formats || []).join(", ")}
- timing: ${parsed.timing?.summary || "-"} (${parsed.timing?.best_slot || "-"})
- content pillar: ${(parsed.content_pillars || []).join(", ")}
- correzioni: ${(parsed.corrections || []).join(" | ")}
- stile visivo: ${vs?.style_description || "-"} | punti forti: ${(vs?.strengths || []).join(", ")} | debolezze: ${(vs?.weaknesses || []).join(", ")}
- prossimi post proposti: ${(parsed.next_posts || []).map(p => `[${p.hook_type || "?"}/${p.content_type || "?"}] ${p.idea || ""}`).join(" || ")}`;
        refineProjectDirectives({
          projectId: brand.id, kind: "analysis", current: priorInsights?.directives,
          brandName: brand?.name, context: ctx,
        });
      }
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

  // ── Dataset per i grafici avanzati ─────────────────────────────────────────

  const trendData = useMemo(() =>
    [...posts]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(p => ({ label: fmtDate(p.timestamp), value: engRate(p) })),
    [posts]);

  const formatData = useMemo(() =>
    Object.entries(mediaTypeCounts).map(([type, count]) => {
      const value = posts.filter(p => p.media_type === type).reduce((s, p) => s + engRate(p), 0) / count;
      return { label: mediaLabel(type), value, count, color: FORMAT_COLORS[type] };
    }),
    [posts, mediaTypeCounts]);

  const weekdayData = useMemo(() => {
    const WD_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
    const acc = WD_LABELS.map(label => ({ label, total: 0, count: 0 }));
    posts.forEach(p => {
      const idx = (new Date(p.timestamp).getDay() + 6) % 7; // 0=Lun..6=Dom
      acc[idx].total += engRate(p);
      acc[idx].count++;
    });
    return acc.map(({ label, total, count }) => ({ label, value: count ? total / count : 0, count }));
  }, [posts]);

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
              <div style={{ fontSize: 16, color: OFF_WHITE, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
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
            style={{ background: "transparent", border: "1px solid #333", borderRadius: 9, color: WARM_GREY, padding: "10px 16px", fontSize: 10, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.08em" }}
          >
            Disconnetti
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 20, padding: "10px 14px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 12, color: "#ff7070", fontSize: 12 }}>
          {error}
        </div>
      )}

      <AdsPanel brand={brand} igAccountId={accountId} igUsername={username} />

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
            <StatCard label="Engagement Medio" value={`${avgEng}%`} sub="interazioni totali / reach" />
            <StatCard label="Formato Vincente" value={mediaLabel(bestType)} sub="per engagement medio" />
            <StatCard label="Ora Migliore" value={hourBest || "—"} sub="engagement più alto" />
            <StatCard label="Reach Medio" value={avgReach ? avgReach.toLocaleString("it-IT") : "—"} sub="per post" />
          </div>

          <AccountOverviewPanel account={account} />

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

          {/* Analisi Avanzata — grafici */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 14 }}>📈 Analisi Avanzata</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ ...card, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, color: OFF_WHITE, fontWeight: 600, marginBottom: 4 }}>Andamento Engagement</div>
                <div style={{ fontSize: 10, color: WARM_GREY, marginBottom: 12 }}>Ordine cronologico, post più vecchio → più recente</div>
                <EngagementTrendChart data={trendData} />
              </div>
              <div style={{ ...card }}>
                <div style={{ fontSize: 12, color: OFF_WHITE, fontWeight: 600, marginBottom: 4 }}>Engagement per Formato</div>
                <div style={{ fontSize: 10, color: WARM_GREY, marginBottom: 12 }}>Media per tipo di contenuto</div>
                <MiniBarChart data={formatData} />
              </div>
              <div style={{ ...card }}>
                <div style={{ fontSize: 12, color: OFF_WHITE, fontWeight: 600, marginBottom: 4 }}>Engagement per Giorno</div>
                <div style={{ fontSize: 10, color: WARM_GREY, marginBottom: 12 }}>Media per giorno della settimana</div>
                <MiniBarChart data={weekdayData} highlightBest />
              </div>
            </div>
          </div>

          <AllPostsList posts={posts} />

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
              <div style={{ fontSize: 11, color: WARM_GREY }}>Claude sta analizzando {posts.length} post e le foto con più engagement…</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>Può richiedere fino a un minuto: analizza anche le immagini, non solo i numeri.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
