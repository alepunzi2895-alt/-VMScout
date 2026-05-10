import { useState, useMemo } from "react";

const GOLD      = "#C9A96E";
const DARK      = "#0D0D0D";
const CARD_BG   = "#141414";
const CARD2     = "#1A1A1A";
const OFF_WHITE = "#F8F4EE";
const WARM_GREY = "#8A8070";
const IG_PINK   = "#E1306C";

// ── API helpers ──────────────────────────────────────────────────────────────

async function igCall(token, path, params = {}) {
  const res = await fetch("/api/instagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, path, params }),
  });
  return res.json();
}

async function callClaude(system, userMsg) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
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

function ConnectPanel({ onConnect }) {
  const [tokenInput, setTokenInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect() {
    const t = tokenInput.trim();
    if (!t) return;
    setLoading(true);
    setError("");
    try {
      const pages = await igCall(t, "me/accounts");
      if (pages.error) throw new Error(pages.error.message);
      if (!pages.data?.length) throw new Error("Nessuna Facebook Page trovata. Controlla il permesso 'pages_show_list'.");

      const page = pages.data[0];
      const igData = await igCall(t, page.id, { fields: "instagram_business_account{id,username}" });
      if (igData.error) throw new Error(igData.error.message);

      const igUser = igData.instagram_business_account;
      if (!igUser) throw new Error("Nessun account Instagram Business collegato a questa Page.");

      onConnect({ token: t, accountId: igUser.id, username: igUser.username });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 640, margin: "60px auto", padding: "0 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
        <div style={{ fontSize: 22, color: OFF_WHITE, fontFamily: "'Playfair Display', serif", marginBottom: 8 }}>
          Connetti @luxy.exp
        </div>
        <div style={{ fontSize: 13, color: WARM_GREY, lineHeight: 1.7 }}>
          Analisi intelligente dei post per costruire la strategia perfetta.
        </div>
      </div>

      {/* Steps */}
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ ...label, marginBottom: 16 }}>Come ottenere il token</div>
        {[
          ["1", "Vai su", "developers.facebook.com/tools/explorer"],
          ["2", "Seleziona la tua app Facebook (o creane una gratuita)"],
          ["3", "Clicca "Generate Access Token" e aggiungi i permessi:", "instagram_basic  instagram_manage_insights  pages_show_list"],
          ["4", "Copia il token e incollalo qui sotto"],
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
          Il token dura 60 giorni. Puoi generarne uno long-lived via Graph API Explorer → "Extend Token".
        </div>
      </div>

      {/* Token input */}
      <div style={{ ...card }}>
        <div style={{ ...label, marginBottom: 10 }}>Access Token</div>
        <textarea
          value={tokenInput}
          onChange={e => setTokenInput(e.target.value)}
          placeholder="EAAxxxxxxxxxxxxx..."
          rows={3}
          style={{
            width: "100%", background: "#0a0a0a", border: "1px solid rgba(201,169,110,0.2)",
            borderRadius: 6, color: OFF_WHITE, padding: "10px 12px", fontSize: 12,
            fontFamily: "monospace", resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
        {error && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#2a1010", border: "1px solid #ff444440", borderRadius: 6, color: "#ff7070", fontSize: 12 }}>
            {error}
          </div>
        )}
        <button
          onClick={handleConnect}
          disabled={loading || !tokenInput.trim()}
          style={{ ...goldBtn(loading || !tokenInput.trim()), marginTop: 14, width: "100%" }}
        >
          {loading ? "Connessione in corso…" : "Connetti Account Instagram"}
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

// ── Analysis Panel ────────────────────────────────────────────────────────────

function AnalysisPanel({ text }) {
  if (!text) return null;

  const sections = text.split(/(?=##\s)/g).filter(Boolean);

  return (
    <div style={{ ...card, marginTop: 24 }}>
      <div style={{ ...label, marginBottom: 20 }}>Analisi Strategica · Claude</div>
      {sections.map((section, i) => {
        const lines = section.split("\n").filter(l => l.trim());
        const heading = lines[0].replace(/^##\s*/, "").trim();
        const body = lines.slice(1).join("\n");
        return (
          <div key={i} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: GOLD, fontFamily: "'Montserrat', sans-serif", marginBottom: 10 }}>
              {heading}
            </div>
            <div style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.8, whiteSpace: "pre-wrap", opacity: 0.9 }}>
              {body.replace(/\*\*(.*?)\*\*/g, "$1")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function InstagramAnalytics() {
  const [token,     setToken]     = useState(() => localStorage.getItem("ig_token") || "");
  const [accountId, setAccountId] = useState(() => localStorage.getItem("ig_account_id") || "");
  const [username,  setUsername]  = useState(() => localStorage.getItem("ig_username") || "@luxy.exp");
  const [posts,     setPosts]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [step,      setStep]      = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis,  setAnalysis]  = useState(() => localStorage.getItem("ig_analysis") || "");
  const [error,     setError]     = useState("");

  const isConnected = !!(token && accountId);

  function handleConnect({ token: t, accountId: id, username: u }) {
    localStorage.setItem("ig_token", t);
    localStorage.setItem("ig_account_id", id);
    localStorage.setItem("ig_username", u || "@luxy.exp");
    setToken(t);
    setAccountId(id);
    setUsername(u || "@luxy.exp");
  }

  function disconnect() {
    ["ig_token", "ig_account_id", "ig_username", "ig_analysis"].forEach(k => localStorage.removeItem(k));
    setToken(""); setAccountId(""); setUsername("@luxy.exp");
    setPosts([]); setAnalysis(""); setError("");
  }

  async function fetchPosts() {
    setLoading(true);
    setError("");
    setPosts([]);
    setAnalysis("");
    localStorage.removeItem("ig_analysis");

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
          const metric = post.media_type === "VIDEO"
            ? "reach,impressions,saved,video_views"
            : "reach,impressions,saved";
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
      impressioni: p.insights?.impressions || 0,
      saves: p.insights?.saved || 0,
      eng_pct: engRate(p).toFixed(2) + "%",
      caption: (p.caption || "").substring(0, 200),
    }));

    const system = `Sei il social media strategist di @luxy.exp, concierge di lusso a Ibiza.

STILE UFFICIALE:
• Caption: max 3-4 righe. Prima frase = gancio evocativo. MAI "Benvenuti" o "Vi presentiamo".
• Firma ✦ come separatore o chiusura.
• Emoji: max 1-2. CTA finale: "→ DM per info" | "→ link in bio" | "→ info@luxy.exp"
• Hashtag: 8-12 nel PRIMO COMMENTO. Core: #luxyexperience #ibiza #ibizaluxury
• Niche: #villasibiza #yachtibiza #luxuryconcierge #ibizalifestyle #ibizasunset
• Reel: B-roll 15-30s, niente voiceover, musica ambient/house, testo overlay minimal
• Target: IT + UK + DE + ES. Bilingue IT/EN preferito.
• Best timing: 18:00-20:00 e 22:00-23:00 CET
• Servizi: Ville & Hotel, Yacht & Barche, Auto & Scooter, Nightlife, Ticket & Eventi, Concierge H24
• NEVER: foto stock, tono corporate, prezzi nel caption, urgency forzata`;

    const userMsg = `Analizza i dati Instagram reali di @luxy.exp (ultimi ${posts.length} post):

${JSON.stringify(postsSummary, null, 2)}

Fornisci:

## 📊 Pattern Vincenti
Quali tipi di contenuto e caption funzionano meglio, con dati a supporto.

## ⏰ Timing Ottimale
Orari/giorni con engagement più alto. Confronto con la fascia target 18-23h.

## 🎯 Content Pillars
I 3-4 temi di contenuto più efficaci identificati nei post reali.

## 📅 Prossimi 7 Post — Piano Editoriale
Per ogni post: tipo, giorno+ora consigliati, tema, bozza caption IT/EN bilingue con firma ✦, hashtag per il commento.

## ⚠️ Cosa Correggere
Pattern che abbassano le performance. Abitudini da eliminare.

Usa sempre dati concreti. Mantieni tono lusso/evocativo.`;

    try {
      const result = await callClaude(system, userMsg);
      setAnalysis(result);
      localStorage.setItem("ig_analysis", result);
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
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg, ${IG_PINK}, #F77737, #FCAF45)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📱</div>
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

          <AnalysisPanel text={analysis} />

          {!analysis && !analyzing && (
            <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>✦</div>
              <div style={{ fontSize: 13, color: OFF_WHITE, marginBottom: 6 }}>Analisi strategica pronta</div>
              <div style={{ fontSize: 11, color: WARM_GREY, marginBottom: 20 }}>
                Claude analizzerà i tuoi {posts.length} post e genererà un piano editoriale personalizzato per @{username}.
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
