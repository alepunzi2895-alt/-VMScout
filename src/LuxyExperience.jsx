import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────
const GOLD       = "#C9A96E";
const GOLD_DARK  = "#A8813F";
const DARK       = "#0D0D0D";
const CARD_BG    = "#141414";
const OFF_WHITE  = "#F8F4EE";
const WARM_GREY  = "#8A8070";
const CANVA_TEAL = "#00C4CC";

// @luxy.exp Instagram DNA — injected into every prompt
const IG_STYLE_GUIDE = `
STILE UFFICIALE @luxy.exp INSTAGRAM (applica SEMPRE):
• Caption: max 3-4 righe. Mai blocchi lunghi. Prima frase = gancio evocativo (NON iniziare con "Benvenuti" o "Vi presentiamo").
• Firma: il carattere ✦ è il signature di Luxy — usarlo come separatore o chiusura.
• Emoji: massimo 1-2 per post. Nessuna decorazione eccessiva.
• CTA: sempre alla fine — "→ DM per info" | "→ link in bio" | "→ info@luxy.exp"
• Hashtag: 8-12 TAG nel PRIMO COMMENTO, mai nel caption. Core: #luxyexperience #ibiza #ibizaluxury
• Hashtag niche: #villasibiza #yachtibiza #luxuryconcierge #ibizalifestyle #ibizasunset #luxuryvilla
• Story: dietro-le-quinte raw, sondaggi binari ("Villa o Yacht?"), sticker DM per booking.
• Reel: B-roll 15-30s, niente voiceover, musica ambient/house, testo overlay minimal.
• Best timing: 18:00-20:00 CET (aperitivo), 22:00-23:00 CET (nightlife).
• Target: IT + UK + DE + ES → bilingue IT/EN preferito, a volte ES per reach.
• NEVER: foto stock pulite, tono corporate, prezzi nel caption, urgency forzata.
`;

const LUXY_SERVICES = [
  { id: "ville", label: "Ville & Hotel", icon: "🏛", color: "#7B6A4A" },
  { id: "yacht", label: "Yacht & Barche", icon: "⛵", color: "#2A4A6B" },
  { id: "auto", label: "Auto & Scooter", icon: "🚗", color: "#4A2A2A" },
  { id: "nightlife", label: "Nightlife & Tavoli", icon: "🎭", color: "#4A2A5A" },
  { id: "eventi", label: "Ticket & Eventi", icon: "🎟", color: "#2A4A3A" },
  { id: "concierge", label: "Concierge H24", icon: "💎", color: "#4A4A2A" },
];

const API_KEYS = {
  pexels: import.meta.env.VITE_PEXELS_KEY || "",
  pixabay: import.meta.env.VITE_PIXABAY_KEY || "",
};

const VIDEO_SOURCES = {
  pexels_video: {
    name: "Pexels Video", icon: "▶", color: "#05A081",
    webUrl: (q) => `https://www.pexels.com/search/videos/${encodeURIComponent(q)}/`,
    apiUrl: (q) => `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=3`,
    headers: () => ({ Authorization: API_KEYS.pexels }),
    parse: (d) => (d.videos || []).map(v => {
      const files = (v.video_files || []).filter(f => f.file_type === "video/mp4");
      const preview = files.find(f => f.quality === "hd") || files[0];
      const upload  = [...files].sort((a, b) => (a.width || 9999) - (b.width || 9999))[0] || files[0];
      return { id: v.id, videoUrl: preview?.link, uploadUrl: upload?.link, image: v.image, author: v.user?.name, link: v.url };
    }),
  },
  coverr: {
    name: "Coverr", icon: "C", color: "#1A1A2E",
    webUrl: (q) => `https://coverr.co/s?q=${encodeURIComponent(q)}`,
  },
  pixabay_video: {
    name: "Pixabay Video", icon: "X", color: "#00AB6C",
    webUrl: (q) => `https://pixabay.com/videos/search/${encodeURIComponent(q)}/`,
    apiUrl: (q) => `https://pixabay.com/api/videos/?key=${API_KEYS.pixabay}&q=${encodeURIComponent(q)}&per_page=3`,
    headers: () => ({}),
    parse: (d) => (d.hits || []).map(h => ({ id: h.id, videoUrl: h.videos?.tiny?.url || h.videos?.medium?.url, image: h.userImageURL, author: h.user, link: h.pageURL })),
  },
  pinterest_video: {
    name: "Pinterest Video", icon: "P", color: "#E60023",
    webUrl: (q) => `https://www.pinterest.com/search/videos/?q=${encodeURIComponent(q)}&rs=typed`,
  },
};

async function fetchVideos(query, sourceKey) {
  const src = VIDEO_SOURCES[sourceKey];
  if (!src?.apiUrl || !API_KEYS[sourceKey.split("_")[0]]) return null;
  try {
    const res = await fetch(src.apiUrl(query), { headers: src.headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return src.parse(data);
  } catch { return null; }
}

const CONTENT_TYPES = [
  { id: "post_instagram", label: "Post Instagram", icon: "📸", platform: "instagram" },
  { id: "post_facebook", label: "Post Facebook", icon: "📘", platform: "facebook" },
  { id: "story", label: "Story / Reel", icon: "🎬", platform: "instagram" },
  { id: "video_storyboard", label: "Video Storyboard", icon: "🎞", platform: "multi" },
  { id: "caption_pack", label: "Pack Caption (3)", icon: "✍️", platform: "multi" },
  { id: "piano_settimanale", label: "Piano 7 giorni", icon: "📅", platform: "multi" },
  { id: "hashtag_strategy", label: "Strategia Hashtag", icon: "#️⃣", platform: "multi" },
  { id: "bio_profilo", label: "Bio Profilo", icon: "👤", platform: "multi" },
  { id: "campagna_full", label: "Campagna Completa", icon: "🚀", platform: "multi" },
];

const LANGUAGES = [
  { id: "it", label: "Italiano", flag: "🇮🇹" },
  { id: "en", label: "English", flag: "🇬🇧" },
  { id: "es", label: "Español", flag: "🇪🇸" },
  { id: "all", label: "Tutte e 3", flag: "🌐" },
];

const LUXY_QUICK_PROMPTS = [
  { label: "Villa Golden Hour", text: "Caption @luxy.exp per villa privata con piscina a strapiombo sul mare di Ibiza. Il cliente arriva al tramonto. Stile candid, autentico. Max 3 righe + CTA DM.", icon: "🌅" },
  { label: "Yacht Formentera", text: "Post Instagram per weekend su yacht a Formentera. Candid, no forced luxury. Hashtag core + niche. IT/EN bilingue.", icon: "⛵" },
  { label: "Nightlife VIP", text: "Story + post per accesso VIP Pacha/Ushuaia Ibiza. Tone: FOMO autentico, mai pacchiano. Include sondaggio per story 'Dove stasera?'.", icon: "🎭" },
  { label: "Piano 7 giorni", text: "Piano editoriale 7 giorni @luxy.exp. Mix: 3 ville, 1 yacht, 1 nightlife, 1 concierge H24, 1 destination beauty Ibiza. Estate 2025, real content style.", icon: "📅" },
  { label: "Bio Update", text: "3 versioni bio Instagram per @luxy.exp. Max 150 char. Comunica: lusso, Ibiza, concierge H24, personalizzazione. Includi ✦ come firma Luxy.", icon: "👤" },
  { label: "Reel Storyboard", text: "Storyboard reel 30s @luxy.exp: arrivo villa → piscina → tramonto → aperitivo. No voiceover, solo testo overlay minimal. Footage B-roll autentico.", icon: "🎬" },
];

// ─────────────────────────────────────────────────
// LUXY SYSTEM PROMPT (specializzato)
// ─────────────────────────────────────────────────
const getLuxySystemPrompt = (memory, contentType) => {
  const memoryContext = memory.length > 0
    ? "\n\nBRAND MEMORY (usa sempre queste info):\n" + memory.map(m => `- ${m.key}: ${m.value}`).join("\n")
    : "";
  const igMemory = memory.filter(m => m.category === "instagram").map(m => `- ${m.key}: ${m.value}`).join("\n");

  const overrideRules = contentType === "video_storyboard"
    ? "LUXY STORYTELLING: Genera uno storyboard video. L'array 'outputs' DEVE rappresentare le SCENE del video (id: 1 = Scena 1). Per ogni scena: 'visual_description' (azione chiara), 'search_query' (massimo 3 parole in inglese esattissime per trovare il footage), 'caption' (il voiceover o testo in overlay)."
    : "Per piano editoriale, ogni output è un giorno. Per hashtag strategy, outputs = gruppi hashtag. Per bio profilo, outputs = 3 bio.";

  return `Sei il Senior Marketing Strategist di Luxy Experience, un servizio concierge di lusso con base a Ibiza.
${memoryContext}

${IG_STYLE_GUIDE}
${igMemory ? `\nCONFIG INSTAGRAM DALLA BRAND MEMORY:\n${igMemory}\n` : ""}
REGOLA D'ORO: Contenuti autentici, mai plastic luxury. Foto reali, lifestyle documentaristico, golden hour, mare cristallino, momenti candid.
Stile visivo: minimal luxury. Nero, oro, bianco avorio. Mai pacchiano.
Tone: Elegante e diretto. Il cliente si sente capito e coccolato. Non "economico", non "conveniente" — sempre "esclusivo", "su misura", "irripetibile".

LINGUA: Genera SEMPRE caption in INGLESE, SPAGNOLO e ITALIANO (in questo ordine). Il campo caption è un oggetto con chiavi "en", "es", "it".

Rispondi SOLO con JSON valido (nessun markdown, nessun testo prima o dopo). Struttura:

{
  "content_type": "${contentType}",
  "strategy_note": "Nota strategica breve in italiano",
  "outputs": [
    {
      "id": 1,
      "title": "Titolo breve",
      "platform": "instagram|facebook|multi",
      "format": "post|story|reel|bio|piano|scene",
      "caption": { "en": "...", "es": "...", "it": "..." },
      "hashtags_instagram": ["tag1","tag2","tag3","tag4","tag5"],
      "hashtags_facebook": ["tag1", "tag2"],
      "cta": { "en": "...", "es": "...", "it": "..." },
      "visual_description": "Descrizione dell'immagine ideale",
      "search_query": "english search query for stock photos",
      "best_time": "18:30",
      "platform_tip": "Suggerimento specifico piattaforma",
      "mood": "aspirational|authentic|exclusive|playful"
    }
  ],
  "visual_palette": ["#hex1", "#hex2", "#hex3"],
  "mood_tags": ["tag1", "tag2", "tag3"],
  "save_to_memory": []
}

IMPORTANTE: hashtags_instagram DEVE avere ESATTAMENTE 5 hashtag significativi (non di più, non di meno).
${overrideRules}
CRITICAL: Rispondi SOLO con il JSON. Zero testo extra.`;
};

// ─────────────────────────────────────────────────
// API CALLS
// ─────────────────────────────────────────────────
async function callLuxyAI(prompt, memory, contentType) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: getLuxySystemPrompt(memory, contentType),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const raw = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("");
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

async function dbCall(action, method = "GET", body = null, params = "") {
  const res = await fetch(`/api/luxy-db?action=${action}${params}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null,
  });
  return res.json();
}

// ─────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────
function GoldDivider() {
  return (
    <div style={{ width: "100%", height: 1, background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, margin: "20px 0", opacity: 0.3 }} />
  );
}

function LuxyTag({ children, color = GOLD }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 4,
      border: `1px solid ${color}40`, color, fontSize: 10,
      fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase",
      fontFamily: "'Montserrat', sans-serif", background: `${color}08`
    }}>
      {children}
    </span>
  );
}

function CopyBtn({ text, small }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{
        padding: small ? "4px 10px" : "7px 16px", borderRadius: 6,
        border: `1px solid ${GOLD}30`, background: copied ? `${GOLD}18` : "transparent",
        color: copied ? GOLD : WARM_GREY, fontSize: small ? 10 : 11,
        fontWeight: 600, cursor: "pointer", fontFamily: "'Montserrat', sans-serif",
        transition: "all 0.2s", whiteSpace: "nowrap"
      }}>
      {copied ? "✓ Copiato" : "Copia"}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft: { label: "Bozza", color: "#888" },
    approved: { label: "Approvato", color: "#5A9A5A" },
    published: { label: "Pubblicato", color: GOLD },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${s.color}18`, color: s.color, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────────
// CANVA UPLOAD BUTTON — riutilizzabile per foto e video
// ─────────────────────────────────────────────────
function CanvaUploadBtn({ url }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error

  async function handleUpload() {
    setStatus("loading");
    try {
      const res = await fetch("/api/canva-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name: "luxy-media" }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("done");
      } else if (data.error === "CANVA_NOT_CONNECTED") {
        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
        setStatus("idle");
      } else {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const base = {
    padding: "4px 8px", borderRadius: 5, fontSize: 9, fontWeight: 700,
    fontFamily: "'Montserrat', sans-serif", cursor: "pointer", border: "none",
    display: "flex", alignItems: "center", gap: 3,
  };

  if (status === "done")
    return <span style={{ ...base, background: "#3A7A3A", color: "#9EE49E" }}>✓ In Canva</span>;
  if (status === "error")
    return <span style={{ ...base, background: "#7A3A3A", color: "#E49E9E" }}>⚠ Errore</span>;

  return (
    <button onClick={handleUpload} disabled={status === "loading"}
      style={{ ...base, background: `${CANVA_TEAL}CC`, color: "#fff", opacity: status === "loading" ? 0.6 : 1 }}>
      {status === "loading" ? "⏳" : "⬆"} Canva
    </button>
  );
}

// ─────────────────────────────────────────────────
// PEXELS PHOTO STRIP — foto reali con upload a Canva
// ─────────────────────────────────────────────────
function PexelsPhotoStrip({ query, vertical = false, count = 4 }) {
  const [photos, setPhotos]   = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || !API_KEYS.pexels) { setPhotos(null); return; }
    let active = true;
    setLoading(true);
    fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${vertical ? "portrait" : "landscape"}`,
      { headers: { Authorization: API_KEYS.pexels } }
    )
      .then(r => r.json())
      .then(d => { if (active) { setPhotos(d.photos || []); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, vertical, count]);

  if (!API_KEYS.pexels) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
        📸 Foto Pexels
      </div>
      {loading ? (
        <div style={{ fontSize: 10, color: WARM_GREY, fontStyle: "italic" }}>Cerco foto...</div>
      ) : photos && photos.length > 0 ? (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {photos.slice(0, count).map(p => (
            <div key={p.id} style={{
              width: vertical ? 90 : 120, flexShrink: 0, borderRadius: 8, overflow: "hidden",
              background: "#000", position: "relative",
              aspectRatio: vertical ? "9/16" : "4/3",
              border: `1px solid ${GOLD}20`,
            }}>
              <img src={p.src.medium} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "18px 4px 5px",
                background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                display: "flex", justifyContent: "center",
              }}>
                <CanvaUploadBtn url={p.src.large2x || p.src.large} />
              </div>
              <a href={p.url} target="_blank" rel="noopener noreferrer"
                style={{
                  position: "absolute", top: 4, right: 4,
                  width: 18, height: 18, background: "rgba(0,0,0,0.55)", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: OFF_WHITE, textDecoration: "none", fontSize: 10,
                }}>↗</a>
            </div>
          ))}
        </div>
      ) : photos !== null ? (
        <div style={{ fontSize: 10, color: WARM_GREY }}>Nessuna foto per "{query}"</div>
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 5, padding: "6px 0", alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, opacity: 0.6, animation: `luxyBounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
      ))}
    </div>
  );
}

function SceneVideoPlayer({ query, sourceKey = "pexels_video" }) {
  const [videos, setVideos] = useState(null);
  const [loading, setLoading] = useState(false);
  const src = VIDEO_SOURCES[sourceKey];
  const apiKeyKey = sourceKey.split("_")[0];
  const canFetch = src?.apiUrl && API_KEYS[apiKeyKey];

  useEffect(() => {
    if (!query || !canFetch) { setVideos(null); return; }
    let active = true;
    setLoading(true);
    fetchVideos(query, sourceKey).then(res => {
      if (active) { setVideos(res); setLoading(false); }
    });
    return () => { active = false; };
  }, [query, sourceKey, canFetch]);

  if (!canFetch) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {loading ? (
        <div style={{ fontSize: 10, color: WARM_GREY, fontStyle: "italic" }}>Cerco footage "{query}" su {src.name}...</div>
      ) : videos && videos.length > 0 ? (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {videos.slice(0,3).map(v => (
            <div key={v.id} style={{ width: 140, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "#000", position: "relative", aspectRatio: "9/16", border: `1px solid ${GOLD}20` }}>
              <video src={v.videoUrl} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "20px 6px 6px", background: "linear-gradient(transparent, rgba(0,0,0,0.85))", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 8, color: OFF_WHITE, fontFamily: "'Montserrat', sans-serif" }}>{v.author || "Creator"}</span>
                {v.uploadUrl && <CanvaUploadBtn url={v.uploadUrl} />}
              </div>
              <a href={v.link} target="_blank" rel="noopener noreferrer" style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, background: "rgba(0,0,0,0.5)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: OFF_WHITE, textDecoration: "none", fontSize: 12 }}>↗</a>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: WARM_GREY }}>Nessun video trovato per "{query}"</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// INSTAGRAM PREVIEW (phone mockup)
// ─────────────────────────────────────────────────
function InstagramPreview({ outputs, displayLang }) {
  const [idx, setIdx] = useState(0);
  const output = outputs[idx];

  const caption = output
    ? typeof output.caption === "object"
      ? output.caption[displayLang] || output.caption.it || ""
      : output.caption || ""
    : "";
  const hashtags = output
    ? (output.hashtags_instagram || []).slice(0, 6).map(h => `#${h.replace(/^#/, "")}`).join(" ")
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "8px 0" }}>
      {outputs.length > 1 && (
        <div style={{ display: "flex", gap: 6 }}>
          {outputs.map((o, i) => (
            <button key={i} onClick={() => setIdx(i)}
              style={{
                width: 30, height: 30, borderRadius: 8,
                border: `2px solid ${i === idx ? GOLD : GOLD + "30"}`,
                background: i === idx ? `${GOLD}20` : "transparent",
                color: i === idx ? GOLD : WARM_GREY,
                fontSize: 10, cursor: "pointer", fontWeight: 700,
              }}>
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Phone frame */}
      <div style={{
        width: 290, background: "#000", borderRadius: 36,
        border: "6px solid #1c1c1c", overflow: "hidden",
        boxShadow: "0 24px 60px rgba(0,0,0,0.7), inset 0 0 0 1px #333"
      }}>
        {/* Status bar */}
        <div style={{ padding: "8px 20px 0", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#fff", fontFamily: "monospace" }}>
          <span>9:41</span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span>▐▐▐</span><span>WiFi</span><span>🔋</span>
          </div>
        </div>

        {/* IG top bar */}
        <div style={{ background: "#000", padding: "8px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1a1a1a" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", fontFamily: "serif", letterSpacing: "-0.5px" }}>Instagram</span>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ fontSize: 18, cursor: "pointer" }}>♡</span>
            <span style={{ fontSize: 18, cursor: "pointer" }}>✉</span>
          </div>
        </div>

        {/* Post header */}
        <div style={{ background: "#000", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", padding: 2, background: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", flexShrink: 0 }}>
            <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: GOLD }}>✦</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>luxy.exp</div>
            <div style={{ fontSize: 9, color: "#666" }}>Ibiza, Spain</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 18, color: "#fff" }}>⋯</div>
        </div>

        {/* Image area 1:1 */}
        <div style={{
          aspectRatio: "1/1",
          background: `linear-gradient(160deg, #1a1208 0%, #2d2010 40%, #0d0a04 100%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden"
        }}>
          {output?.visual_description ? (
            <div style={{ padding: 18, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: GOLD, fontStyle: "italic", lineHeight: 1.7, opacity: 0.9 }}>
                {output.visual_description.slice(0, 110)}
                {output.visual_description.length > 110 ? "..." : ""}
              </div>
              {output.search_query && (
                <div style={{ marginTop: 10, fontSize: 8, color: WARM_GREY }}>
                  🔍 "{output.search_query}"
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 36, opacity: 0.3 }}>📸</span>
          )}
          {output?.mood && (
            <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 8, padding: "2px 7px", borderRadius: 4, background: "rgba(0,0,0,0.75)", color: GOLD, fontFamily: "'Montserrat',sans-serif", letterSpacing: "0.1em" }}>
              {output.mood}
            </div>
          )}
          {output?.best_time && (
            <div style={{ position: "absolute", bottom: 8, right: 8, fontSize: 8, padding: "2px 7px", borderRadius: 4, background: "rgba(0,0,0,0.75)", color: "#aaa" }}>
              ⏰ {output.best_time}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ background: "#000", padding: "8px 14px 4px", display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ fontSize: 20 }}>🤍</span>
          <span style={{ fontSize: 20 }}>💬</span>
          <span style={{ fontSize: 20 }}>↗</span>
          <span style={{ fontSize: 20, marginLeft: "auto" }}>🔖</span>
        </div>

        {/* Caption */}
        <div style={{ background: "#000", padding: "0 14px 14px", maxHeight: 130, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: "#fff", lineHeight: 1.55 }}>
            <span style={{ fontWeight: 700, fontFamily: "-apple-system,sans-serif" }}>luxy.exp</span>{" "}
            <span style={{ color: "#ddd", fontFamily: "-apple-system,sans-serif" }}>
              {caption.slice(0, 140)}{caption.length > 140 ? "..." : ""}
            </span>
          </div>
          {hashtags && (
            <div style={{ marginTop: 5, fontSize: 10, color: "#6b8ec7", lineHeight: 1.5, fontFamily: "-apple-system,sans-serif" }}>
              {hashtags}
            </div>
          )}
          {output?.cta && (
            <div style={{ marginTop: 6, fontSize: 10, color: GOLD, fontStyle: "italic" }}>
              {typeof output.cta === "object" ? output.cta[displayLang] || output.cta.it : output.cta}
            </div>
          )}
        </div>
      </div>

      {output?.platform_tip && (
        <div style={{ maxWidth: 270, fontSize: 10, color: WARM_GREY, textAlign: "center", fontStyle: "italic", lineHeight: 1.6 }}>
          💡 {output.platform_tip}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// OUTPUT CARD
// ─────────────────────────────────────────────────
function OutputCard({ output, lang, platform, onSave, isSaving, isSaved, canvaTemplates }) {
  const [expanded, setExpanded] = useState(true);
  const [canvaType, setCanvaType] = useState(
    output.format === "scene" ? "reel" : output.format === "story" ? "story" : "post"
  );
  const [canvaLoading, setCanvaLoading]   = useState(false);
  const [canvaUrl, setCanvaUrl]           = useState(null);
  const [canvaImageUrl, setCanvaImageUrl] = useState(null);

  const getCta = (langKey) => {
    if (!output.cta) return "";
    if (typeof output.cta === "string") return output.cta;
    return output.cta[langKey] || "";
  };

  // Build single Instagram-ready caption block: EN → ES → IT + 5 hashtags
  const buildIGCaption = () => {
    const cap = output.caption || {};
    const en  = typeof cap === "string" ? cap : (cap.en || "");
    const es  = typeof cap === "string" ? "" : (cap.es || "");
    const it  = typeof cap === "string" ? "" : (cap.it || "");
    const tags = (output.hashtags_instagram || []).slice(0, 5).map(h => `#${h.replace(/^#/, "")}`).join(" ");

    const lines = [];
    if (en) lines.push(`🇬🇧 ${en}${getCta("en") ? `\n${getCta("en")}` : ""}`);
    if (es) lines.push(`🇪🇸 ${es}${getCta("es") ? `\n${getCta("es")}` : ""}`);
    if (it) lines.push(`🇮🇹 ${it}${getCta("it") ? `\n${getCta("it")}` : ""}`);
    if (tags) lines.push(tags);
    return lines.join("\n\n");
  };

  const igCaption = buildIGCaption();
  // Fallback single-language caption for preview / save
  const caption = (() => {
    if (!output.caption) return "";
    if (typeof output.caption === "string") return output.caption;
    return output.caption.en || output.caption.it || "";
  })();

  const moodColors = {
    aspirational: "#7B6A4A", authentic: "#4A6B7B",
    exclusive: GOLD_DARK, playful: "#7B4A6B"
  };

  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${GOLD}20`, borderRadius: 14,
      overflow: "hidden", transition: "all 0.3s", marginBottom: 12
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
        borderBottom: `1px solid ${GOLD}12`, cursor: "pointer",
        background: `linear-gradient(90deg, ${GOLD}08, transparent)`
      }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, fontFamily: "'Montserrat', sans-serif", letterSpacing: "0.1em" }}>
          #{output.id}
        </span>
        <span style={{ flex: 1, fontSize: 13, color: OFF_WHITE, fontFamily: "'Cormorant Garamond', serif" }}>
          {output.title || `Output ${output.id}`}
        </span>
        {output.mood && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${moodColors[output.mood] || GOLD}20`, color: moodColors[output.mood] || GOLD, fontWeight: 600 }}>{output.mood}</span>}
        {output.best_time && <span style={{ fontSize: 9, color: WARM_GREY, fontFamily: "monospace" }}>⏰ {output.best_time}</span>}
        <span style={{ fontSize: 12, color: WARM_GREY }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "16px" }}>
          {/* Visual hint */}
          {output.visual_description && (
            <div style={{ padding: "10px 14px", background: `${GOLD}06`, borderRadius: 8, borderLeft: `2px solid ${GOLD}40`, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>📷 Visual</div>
              <div style={{ fontSize: 12, color: "#BBB", lineHeight: 1.6, fontStyle: "italic" }}>{output.visual_description}</div>
              {output.search_query && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    {["unsplash.com/s/photos/", "pexels.com/search/", "pinterest.com/search/pins/?q="].map((base, i) => {
                      const sites = ["Unsplash", "Pexels", "Pinterest"];
                      const colors = ["#111", "#05A081", "#E60023"];
                      return (
                        <a key={i} href={`https://www.${base}${encodeURIComponent(output.search_query)}`} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 9, padding: "3px 8px", borderRadius: 5, background: `${colors[i]}20`, color: colors[i], textDecoration: "none", fontWeight: 600 }}>
                          {sites[i]} ↗
                        </a>
                      );
                    })}
                  </div>
                  {/* 1 foto per slide (carosello/post), più per altri formati */}
                  <PexelsPhotoStrip
                    query={output.search_query}
                    vertical={output.format === "story" || output.format === "reel" || output.format === "scene"}
                    count={1}
                  />
                  {/* Video solo per reel, story, scene — non per post/carosello */}
                  {(output.format === "reel" || output.format === "story" || output.format === "scene") && (
                    <SceneVideoPlayer query={output.search_query} sourceKey="pexels_video" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Instagram Caption — blocco unico copiabile EN → ES → IT + hashtag */}
          {igCaption && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 8 }}>
                Caption Instagram
              </div>
              <div style={{
                background: "#0A0A0A", border: `1px solid ${GOLD}20`, borderRadius: 10,
                padding: "14px 16px", fontSize: 13, color: OFF_WHITE,
                lineHeight: 1.8, whiteSpace: "pre-line", fontFamily: "'Cormorant Garamond', serif",
                userSelect: "all",
              }}>
                {igCaption}
              </div>
              <div style={{ marginTop: 8 }}>
                <CopyBtn text={igCaption} label="📋 Copia Caption IG" />
              </div>
            </div>
          )}

          {/* Platform tip */}
          {output.platform_tip && (
            <div style={{ fontSize: 11, color: WARM_GREY, fontStyle: "italic", marginBottom: 14, padding: "6px 0", borderTop: `1px solid ${GOLD}10` }}>
              💡 {output.platform_tip}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!isSaved ? (
              <button onClick={() => onSave(output)} disabled={isSaving}
                style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${GOLD}50`, background: isSaving ? `${GOLD}10` : `${GOLD}18`, color: GOLD, fontSize: 11, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                {isSaving ? "Salvo..." : "💾 Salva Post"}
              </button>
            ) : (
              <span style={{ fontSize: 11, color: "#5A9A5A", fontWeight: 600, padding: "7px 0" }}>✓ Salvato nel DB</span>
            )}

            {/* Canva — auto-create design with Pexels background */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
              {/* Format selector */}
              {[
                { id: "post",  icon: "📸", label: "1:1"   },
                { id: "story", icon: "📱", label: "Story" },
                { id: "reel",  icon: "🎬", label: "Reel"  },
              ].map(t => (
                <button key={t.id} onClick={() => { setCanvaType(t.id); setCanvaUrl(null); setCanvaImageUrl(null); }}
                  title={t.label}
                  style={{
                    padding: "4px 7px", fontSize: 8, borderRadius: 4, cursor: "pointer",
                    border: `1px solid ${canvaType === t.id ? CANVA_TEAL : CANVA_TEAL + "25"}`,
                    background: canvaType === t.id ? `${CANVA_TEAL}18` : "transparent",
                    color: canvaType === t.id ? CANVA_TEAL : WARM_GREY,
                    fontFamily: "'Montserrat', sans-serif",
                  }}>
                  {t.icon}
                </button>
              ))}

              {canvaUrl ? (
                /* Template ready — open link + optional image URL copy */
                <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                  <a href={canvaUrl} target="_blank" rel="noopener noreferrer"
                    style={{
                      padding: "7px 12px", borderRadius: 6, textDecoration: "none",
                      border: `1px solid #5A9A5A80`, background: "#5A9A5A18",
                      color: "#5A9A5A", fontSize: 11, fontWeight: 600,
                      fontFamily: "'Montserrat', sans-serif",
                    }}>
                    ✓ Apri Template →
                  </a>
                  {canvaImageUrl && (
                    <button
                      onClick={() => navigator.clipboard.writeText(canvaImageUrl)}
                      title="Incolla l'URL in Canva → Immagine → da link"
                      style={{
                        padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                        border: `1px solid ${CANVA_TEAL}40`, background: `${CANVA_TEAL}10`,
                        color: CANVA_TEAL, fontSize: 10, fontWeight: 600,
                        fontFamily: "'Montserrat', sans-serif",
                      }}>
                      📋 Copia URL foto
                    </button>
                  )}
                </div>
              ) : (
                /* Create button */
                <button disabled={canvaLoading} onClick={async () => {
                    setCanvaLoading(true);
                    try {
                      const res = await fetch("/api/canva-create", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          caption,
                          cta:          getCta(),
                          search_query: output.search_query || "",
                          format:       canvaType,
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setCanvaUrl(data.url);
                        if (data.imageUrl) setCanvaImageUrl(data.imageUrl);
                      } else if (data.error === "CANVA_NOT_CONNECTED") {
                        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
                      } else {
                        alert(data.message || "Errore creazione design Canva");
                      }
                    } finally {
                      setCanvaLoading(false);
                    }
                  }}
                  style={{
                    padding: "7px 14px", borderRadius: 6,
                    cursor: canvaLoading ? "wait" : "pointer",
                    border: `1px solid ${CANVA_TEAL}50`, background: `${CANVA_TEAL}15`,
                    color: CANVA_TEAL, fontSize: 11, fontWeight: 600,
                    fontFamily: "'Montserrat', sans-serif", opacity: canvaLoading ? 0.6 : 1,
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                  {canvaLoading
                    ? <><span style={{ fontSize: 9 }}>⏳</span> Creo...</>
                    : <><span style={{ fontSize: 9 }}>✦</span> Crea Design</>
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// MEMORY PANEL
// ─────────────────────────────────────────────────
function MemoryPanel({ memory, onUpdate }) {
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = [...new Set(memory.map(m => m.category))];

  const handleSave = async () => {
    setSaving(true);
    await dbCall("memory", "PUT", { key: editing.key, value: editVal, category: editing.category });
    setSaving(false);
    setEditing(null);
    onUpdate();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 18 }}>🧠</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: OFF_WHITE, fontFamily: "'Cormorant Garamond', serif" }}>Brand Memory</div>
          <div style={{ fontSize: 11, color: WARM_GREY }}>Informazioni persistenti su Luxy — vengono usate in ogni generazione</div>
        </div>
      </div>

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: GOLD, marginBottom: 10, fontFamily: "'Montserrat', sans-serif" }}>
            {cat}
          </div>
          {memory.filter(m => m.category === cat).map(m => (
            <div key={m.key} style={{ background: "#1A1A1A", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: `1px solid ${GOLD}15` }}>
              {editing?.key === m.key ? (
                <div>
                  <div style={{ fontSize: 10, color: GOLD, marginBottom: 6, fontWeight: 600 }}>{m.key}</div>
                  <textarea value={editVal} onChange={e => setEditVal(e.target.value)} rows={3}
                    style={{ width: "100%", background: "#111", border: `1px solid ${GOLD}30`, borderRadius: 8, padding: "8px 10px", color: OFF_WHITE, fontSize: 12, fontFamily: "'Montserrat', sans-serif", resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={handleSave} disabled={saving}
                      style={{ padding: "6px 14px", borderRadius: 6, background: GOLD, color: DARK, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none" }}>
                      {saving ? "..." : "Salva"}
                    </button>
                    <button onClick={() => setEditing(null)}
                      style={{ padding: "6px 14px", borderRadius: 6, background: "transparent", color: WARM_GREY, fontSize: 11, cursor: "pointer", border: `1px solid ${WARM_GREY}40` }}>
                      Annulla
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: GOLD, marginBottom: 4, fontWeight: 600, letterSpacing: "0.1em" }}>{m.key}</div>
                    <div style={{ fontSize: 12, color: "#BBB", lineHeight: 1.6 }}>{m.value}</div>
                    {m.updated_at && <div style={{ fontSize: 9, color: "#555", marginTop: 6 }}>Aggiornato: {m.updated_at}</div>}
                  </div>
                  <button onClick={() => { setEditing(m); setEditVal(m.value); }}
                    style={{ padding: "4px 10px", borderRadius: 6, background: "transparent", color: WARM_GREY, fontSize: 10, cursor: "pointer", border: `1px solid ${WARM_GREY}30`, flexShrink: 0 }}>
                    ✏️
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────
// HISTORY PANEL
// ─────────────────────────────────────────────────
function HistoryPanel({ history }) {
  const typeColors = { content: GOLD, strategy: "#5A9A9A", post: "#9A5A9A", campaign: "#9A7A5A" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 18 }}>📚</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: OFF_WHITE, fontFamily: "'Cormorant Garamond', serif" }}>Storico Richieste</div>
          <div style={{ fontSize: 11, color: WARM_GREY }}>{history.length} richieste salvate</div>
        </div>
      </div>

      {history.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: WARM_GREY, fontSize: 13 }}>
          Nessuna richiesta ancora. Inizia a generare contenuti!
        </div>
      )}

      {history.map(h => (
        <div key={h.id} style={{ background: "#1A1A1A", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: `1px solid ${GOLD}12` }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: `${typeColors[h.type] || GOLD}20`, color: typeColors[h.type] || GOLD, fontWeight: 700, textTransform: "uppercase" }}>{h.type}</span>
            {h.language && <LuxyTag>{h.language}</LuxyTag>}
            <span style={{ fontSize: 10, color: "#555", marginLeft: "auto" }}>{h.created_at?.replace("T", " ").slice(0, 16)}</span>
          </div>
          <div style={{ fontSize: 12, color: "#CCC", lineHeight: 1.5 }}>{h.prompt?.slice(0, 120)}{h.prompt?.length > 120 ? "..." : ""}</div>
          {h.tags && (
            <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {JSON.parse(h.tags || "[]").map((t, i) => (
                <span key={i} style={{ fontSize: 9, color: WARM_GREY, background: "#222", padding: "2px 6px", borderRadius: 4 }}>#{t}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────
// SAVED POSTS PANEL
// ─────────────────────────────────────────────────
function SavedPostsPanel({ posts, onStatusChange }) {
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = posts.filter(p =>
    (filterPlatform === "all" || p.platform === filterPlatform) &&
    (filterStatus === "all" || p.status === filterStatus)
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 18 }}>📌</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: OFF_WHITE, fontFamily: "'Cormorant Garamond', serif" }}>Post Salvati</div>
          <div style={{ fontSize: 11, color: WARM_GREY }}>{posts.length} post nel database</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all", "instagram", "facebook", "linkedin"].map(p => (
          <button key={p} onClick={() => setFilterPlatform(p)}
            style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${filterPlatform === p ? GOLD : GOLD + "30"}`, background: filterPlatform === p ? `${GOLD}18` : "transparent", color: filterPlatform === p ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {p}
          </button>
        ))}
        <div style={{ width: 1, background: `${GOLD}20`, margin: "0 4px" }} />
        {["all", "draft", "approved", "published"].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${filterStatus === s ? GOLD : GOLD + "30"}`, background: filterStatus === s ? `${GOLD}18` : "transparent", color: filterStatus === s ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: WARM_GREY, fontSize: 13 }}>
          Nessun post salvato per questi filtri.
        </div>
      )}

      {filtered.map(post => (
        <div key={post.id} style={{ background: "#1A1A1A", borderRadius: 12, padding: "14px 16px", marginBottom: 10, border: `1px solid ${GOLD}15` }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: WARM_GREY, fontFamily: "monospace" }}>#{post.id}</span>
            <StatusBadge status={post.status} />
            <LuxyTag>{post.platform}</LuxyTag>
            {post.language && <LuxyTag>{post.language}</LuxyTag>}
            <span style={{ fontSize: 10, color: "#444", marginLeft: "auto" }}>{post.created_at?.slice(0, 10)}</span>
          </div>
          <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.6, marginBottom: 10, fontFamily: "'Cormorant Garamond', serif" }}>
            {post.caption?.slice(0, 150)}{post.caption?.length > 150 ? "..." : ""}
          </div>
          {post.cta && <div style={{ fontSize: 11, color: GOLD, marginBottom: 10 }}>CTA: {post.cta}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            {["draft", "approved", "published"].map(s => (
              <button key={s} onClick={() => onStatusChange(post.id, s)} disabled={post.status === s}
                style={{ padding: "4px 10px", borderRadius: 6, fontSize: 9, cursor: post.status === s ? "default" : "pointer", border: `1px solid ${post.status === s ? GOLD : GOLD + "30"}`, background: post.status === s ? `${GOLD}20` : "transparent", color: post.status === s ? GOLD : WARM_GREY, fontWeight: post.status === s ? 700 : 400, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {s}
              </button>
            ))}
            <div style={{ marginLeft: "auto" }}>
              <CopyBtn text={post.caption || ""} small />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────
// STATS BAR
// ─────────────────────────────────────────────────
function StatsBar({ stats, dbStatus }) {
  return (
    <div style={{
      display: "flex", gap: 16, padding: "12px 20px", background: "#0A0A0A",
      borderBottom: `1px solid ${GOLD}20`, flexWrap: "wrap", alignItems: "center"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: dbStatus === "ok" ? "#5A9A5A" : "#9A5A5A" }} />
        <span style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'Montserrat', sans-serif" }}>
          DB {dbStatus === "ok" ? "connesso" : "..."}
        </span>
      </div>
      {stats && (
        <>
          <div style={{ width: 1, height: 16, background: `${GOLD}20` }} />
          {[
            { label: "Richieste", value: stats.total_requests },
            { label: "Post salvati", value: stats.total_posts },
            { label: "Approvati", value: stats.approved_posts },
          ].map(s => (
            <div key={s.label} style={{ fontSize: 10, color: WARM_GREY }}>
              <span style={{ color: GOLD, fontWeight: 700, marginRight: 4 }}>{s.value}</span>
              {s.label}
            </div>
          ))}
          {stats.last_request && (
            <div style={{ fontSize: 9, color: "#444", marginLeft: "auto" }}>
              Ultima: {stats.last_request?.slice(0, 16)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// MAIN LUXY EXPERIENCE COMPONENT
// ─────────────────────────────────────────────────
export default function LuxyExperience() {
  // DB state
  const [dbStatus, setDbStatus] = useState("loading");
  const [stats, setStats] = useState(null);
  const [memory, setMemory] = useState([]);
  const [history, setHistory] = useState([]);
  const [savedPosts, setSavedPosts] = useState([]);

  // Canva state
  const [canvaConnected, setCanvaConnected] = useState(null); // null=checking, true, false

  // UI state
  const [activeTab, setActiveTab] = useState("genera");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [savedOutputs, setSavedOutputs] = useState({});
  const [savingOutput, setSavingOutput] = useState(null);
  const [error, setError] = useState(null);

  // Form state
  const [prompt, setPrompt] = useState("");
  const [selectedService, setSelectedService] = useState(null);
  const [contentType, setContentType] = useState("post_instagram");
  const [displayPlatform, setDisplayPlatform] = useState("instagram");

  const promptRef = useRef(null);

  // ── DB Init ───────────────────────────────────
  useEffect(() => {
    initDB();
  }, []);

  const checkCanvaStatus = async () => {
    try {
      const res = await fetch("/api/canva-auth?action=status");
      const data = await res.json();
      setCanvaConnected(data.connected);
    } catch {
      setCanvaConnected(false);
    }
  };

  const initDB = async () => {
    try {
      const initRes = await dbCall("init");
      if (initRes.ok) {
        setDbStatus("ok");
        await Promise.all([loadStats(), loadMemory(), loadHistory(), loadPosts(), checkCanvaStatus()]);
      } else {
        setDbStatus("error");
      }
    } catch (e) {
      setDbStatus("error");
      console.error("DB init failed:", e);
    }
  };

  const loadStats = async () => {
    const r = await dbCall("stats");
    if (r.ok) setStats(r.stats);
  };

  const loadMemory = async () => {
    const r = await dbCall("memory");
    if (r.ok) setMemory(r.data);
  };

  const loadHistory = async () => {
    const r = await dbCall("history", "GET", null, "&limit=30");
    if (r.ok) setHistory(r.data);
  };

  const loadPosts = async () => {
    const r = await dbCall("posts", "GET", null, "&limit=50");
    if (r.ok) setSavedPosts(r.data);
  };

  // ── Generate ──────────────────────────────────
  const handleGenerate = async (customPrompt) => {
    const finalPrompt = customPrompt || prompt.trim();
    if (!finalPrompt || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);
    setSavedOutputs({});

    try {
      const tags = [
        selectedService,
        contentType,
        "ibiza",
        "luxy"
      ].filter(Boolean);

      // Call AI
      const parsed = await callLuxyAI(finalPrompt, memory, contentType);
      setResult(parsed);

      // Save request to DB
      if (dbStatus === "ok") {
        await dbCall("save_request", "POST", {
          type: contentType.includes("piano") ? "strategy" : contentType.includes("campagna") ? "campaign" : "content",
          prompt: finalPrompt,
          result_json: parsed,
          language: "all",
          tags
        });
        await Promise.all([loadStats(), loadHistory()]);
      }

      if (!customPrompt) setPrompt("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Save post ─────────────────────────────────
  const handleSavePost = async (output) => {
    setSavingOutput(output.id);
    try {
      const cap = output.caption || {};
      const en  = typeof cap === "string" ? cap : (cap.en || "");
      const es  = typeof cap === "string" ? "" : (cap.es || "");
      const it  = typeof cap === "string" ? "" : (cap.it || "");
      const ctaEn = typeof output.cta === "object" ? output.cta.en || "" : output.cta || "";
      const ctaEs = typeof output.cta === "object" ? output.cta.es || "" : "";
      const ctaIt = typeof output.cta === "object" ? output.cta.it || "" : "";
      const tags = (output.hashtags_instagram || []).slice(0, 5).map(h => `#${h.replace(/^#/, "")}`).join(" ");
      const lines = [];
      if (en) lines.push(`🇬🇧 ${en}${ctaEn ? `\n${ctaEn}` : ""}`);
      if (es) lines.push(`🇪🇸 ${es}${ctaEs ? `\n${ctaEs}` : ""}`);
      if (it) lines.push(`🇮🇹 ${it}${ctaIt ? `\n${ctaIt}` : ""}`);
      if (tags) lines.push(tags);
      const caption = lines.join("\n\n");
      const cta = ctaEn || ctaIt || "";
      await dbCall("save_post", "POST", {
        platform: output.platform || displayPlatform,
        language: "all",
        caption,
        hashtags: output.hashtags_instagram,
        cta,
        visual_description: output.visual_description,
        search_query: output.search_query,
        campaign_tag: selectedService || contentType,
      });
      setSavedOutputs(prev => ({ ...prev, [output.id]: true }));
      await Promise.all([loadStats(), loadPosts()]);
    } catch (e) {
      console.error("Save post failed:", e);
    } finally {
      setSavingOutput(null);
    }
  };

  // ── Post status change ────────────────────────
  const handleStatusChange = async (id, status) => {
    await dbCall("update_post", "PUT", { id, status });
    await loadPosts();
    await loadStats();
  };

  // Canva template IDs derived from brand memory
  const canvaTemplates = {
    post:  memory.find(m => m.key === "canva_template_post")?.value  || "",
    story: memory.find(m => m.key === "canva_template_story")?.value || "",
    reel:  memory.find(m => m.key === "canva_template_reel")?.value  || "",
  };

  // ── Tabs ──────────────────────────────────────
  const TABS = [
    { id: "genera",  label: "Genera",      icon: "✨" },
    { id: "preview", label: "Preview IG",  icon: "📱" },
    { id: "memoria", label: "Memoria",     icon: "🧠" },
    { id: "storico", label: "Storico",     icon: "📚" },
    { id: "post",    label: "Post Salvati", icon: "📌" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: DARK, fontFamily: "'Montserrat', sans-serif", color: OFF_WHITE }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Montserrat:wght@200;300;400;500;600&display=swap');
        @keyframes luxyBounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-5px);opacity:1} }
        @keyframes luxyFade { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .luxy-btn:hover { background: rgba(201,169,110,0.15) !important; }
        .luxy-quick:hover { border-color: ${GOLD}80 !important; background: ${GOLD}10 !important; }
        textarea:focus, input:focus { outline: none !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${GOLD}30; border-radius: 4px; }
      `}</style>

      {/* Stats bar */}
      <StatsBar stats={stats} dbStatus={dbStatus} />

      {/* Header */}
      <div style={{
        padding: "32px 24px 24px", textAlign: "center",
        borderBottom: `1px solid ${GOLD}15`,
        background: `linear-gradient(180deg, #0A0A0A, ${DARK})`
      }}>
        <div style={{ fontSize: 9, letterSpacing: "0.5em", textTransform: "uppercase", color: GOLD, marginBottom: 12, fontWeight: 500 }}>
          ✦ MARKETING HUB ✦
        </div>
        <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 300, color: OFF_WHITE, margin: 0, letterSpacing: "0.05em" }}>
          Luxy <em style={{ color: GOLD, fontStyle: "italic" }}>Experience</em>
        </h1>
        <p style={{ fontSize: 11, color: WARM_GREY, marginTop: 8, letterSpacing: "0.3em", textTransform: "uppercase" }}>
          Concierge di Lusso · Ibiza · Mondo
        </p>
        
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: canvaConnected === true ? "#5A9A5A" : canvaConnected === false ? "#9A5A5A" : "#666", transition: "background 0.4s" }} />
          {canvaConnected === true ? (
            <span style={{ fontSize: 9, color: "#5A9A5A", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "'Montserrat', sans-serif" }}>
              Canva connesso
              <button onClick={async () => { await fetch("/api/canva-auth?action=logout"); setCanvaConnected(false); }}
                style={{ marginLeft: 10, fontSize: 8, color: WARM_GREY, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                disconnetti
              </button>
            </span>
          ) : (
            <a href="/api/canva-auth?action=login" target="_blank" rel="noopener noreferrer"
              onClick={() => setTimeout(checkCanvaStatus, 4000)}
              style={{ fontSize: 9, padding: "4px 14px", borderRadius: 20, border: `1px solid ${CANVA_TEAL}40`, background: `${CANVA_TEAL}10`, color: CANVA_TEAL, textDecoration: "none", fontFamily: "'Montserrat', sans-serif", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              🔗 Connetti Canva
            </a>
          )}
        </div>

        {/* Divider ornament */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 300, margin: "16px auto 0" }}>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${GOLD}40)` }} />
          <span style={{ color: GOLD, fontSize: 10 }}>✦</span>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${GOLD}40, transparent)` }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${GOLD}15`, background: "#0A0A0A" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: "14px 8px", border: "none",
              borderBottom: activeTab === tab.id ? `2px solid ${GOLD}` : "2px solid transparent",
              background: "transparent", color: activeTab === tab.id ? GOLD : WARM_GREY,
              fontSize: 11, fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: "pointer", fontFamily: "'Montserrat', sans-serif",
              letterSpacing: "0.1em", transition: "all 0.2s"
            }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 20px 120px" }}>

        {/* ═══ TAB: GENERA ═══ */}
        {activeTab === "genera" && (
          <div style={{ animation: "luxyFade 0.3s ease-out" }}>

            {/* Quick prompts */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: WARM_GREY, marginBottom: 12 }}>Quick Start</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {LUXY_QUICK_PROMPTS.map((qp, i) => (
                  <button key={i} className="luxy-quick" onClick={() => { setPrompt(qp.text); promptRef.current?.focus(); }}
                    style={{
                      padding: "8px 14px", borderRadius: 8,
                      border: `1px solid ${GOLD}25`, background: "transparent",
                      color: "#CCC", fontSize: 11, cursor: "pointer",
                      fontFamily: "'Montserrat', sans-serif", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s"
                    }}>
                    <span>{qp.icon}</span>
                    <span>{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <GoldDivider />

            {/* Servizio target */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: WARM_GREY, marginBottom: 12 }}>Servizio Focus (opzionale)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => setSelectedService(null)}
                  style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${!selectedService ? GOLD : GOLD + "30"}`, background: !selectedService ? `${GOLD}18` : "transparent", color: !selectedService ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                  Tutti i servizi
                </button>
                {LUXY_SERVICES.map(s => (
                  <button key={s.id} onClick={() => setSelectedService(selectedService === s.id ? null : s.id)}
                    style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${selectedService === s.id ? GOLD : GOLD + "30"}`, background: selectedService === s.id ? `${GOLD}18` : "transparent", color: selectedService === s.id ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif', display: 'flex", alignItems: "center", gap: 5 }}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo contenuto */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: WARM_GREY, marginBottom: 12 }}>Tipo Contenuto</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {CONTENT_TYPES.map(ct => (
                  <button key={ct.id} onClick={() => setContentType(ct.id)}
                    style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${contentType === ct.id ? GOLD : GOLD + "30"}`, background: contentType === ct.id ? `${GOLD}18` : "transparent", color: contentType === ct.id ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                    {ct.icon} {ct.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt input */}
            <div style={{ marginBottom: 20 }}>
              <textarea ref={promptRef} value={prompt} onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                placeholder="Descrivi cosa vuoi generare per Luxy Experience... (Cmd/Ctrl+Enter per generare)"
                rows={4}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "16px 18px", borderRadius: 12,
                  border: `1px solid ${GOLD}30`, background: "#111",
                  color: OFF_WHITE, fontSize: 13, lineHeight: 1.6,
                  fontFamily: "'Montserrat', sans-serif", resize: "vertical",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => e.target.style.borderColor = GOLD}
                onBlur={e => e.target.style.borderColor = `${GOLD}30`}
              />
            </div>

            <button onClick={() => handleGenerate()} disabled={loading || !prompt.trim()}
              style={{
                width: "100%", padding: "16px", borderRadius: 12,
                border: `1px solid ${loading || !prompt.trim() ? GOLD + "20" : GOLD}`,
                background: loading || !prompt.trim() ? `${GOLD}08` : `linear-gradient(135deg, ${GOLD}25, ${GOLD}10)`,
                color: loading || !prompt.trim() ? `${GOLD}60` : GOLD,
                fontSize: 13, fontWeight: 600, cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
                fontFamily: "'Montserrat', sans-serif", letterSpacing: "0.2em",
                textTransform: "uppercase", transition: "all 0.3s"
              }}>
              {loading ? "Generazione in corso..." : "✦ Genera Contenuto"}
            </button>

            {/* Loading */}
            {loading && (
              <div style={{ textAlign: "center", padding: "32px 20px", animation: "luxyFade 0.3s ease-out" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                  <TypingDots />
                </div>
                <div style={{ fontSize: 11, color: WARM_GREY, letterSpacing: "0.2em" }}>
                  Creazione contenuto personalizzato Luxy...
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 10, background: "#2A1A1A", border: "1px solid #5A2A2A", color: "#E88", fontSize: 12 }}>
                ⚠️ {error}
              </div>
            )}

            {/* Result */}
            {result && !loading && (
              <div style={{ marginTop: 28, animation: "luxyFade 0.4s ease-out" }}>
                <GoldDivider />

                {/* Strategy note */}
                {result.strategy_note && (
                  <div style={{ padding: "14px 18px", background: `${GOLD}08`, borderRadius: 10, borderLeft: `3px solid ${GOLD}`, marginBottom: 20 }}>
                    <div style={{ fontSize: 9, color: GOLD, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 6 }}>Nota Strategica</div>
                    <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.6, fontStyle: "italic", fontFamily: "'Cormorant Garamond', serif" }}>
                      {result.strategy_note}
                    </div>
                  </div>
                )}

                {/* Palette */}
                {result.visual_palette?.length > 0 && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.2em", textTransform: "uppercase", marginRight: 4 }}>Palette:</span>
                    {result.visual_palette.map((c, i) => (
                      <div key={i} title={c} style={{ width: 32, height: 32, borderRadius: 8, background: c, border: `1px solid ${GOLD}20`, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }} />
                    ))}
                    {result.mood_tags?.map((t, i) => (
                      <span key={i} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 10, background: `${GOLD}12`, color: GOLD, marginLeft: 4 }}>#{t}</span>
                    ))}
                  </div>
                )}

                {/* Platform toggle */}
                <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                  {["instagram", "facebook"].map(p => (
                    <button key={p} onClick={() => setDisplayPlatform(p)}
                      style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${displayPlatform === p ? GOLD : GOLD + "30"}`, background: displayPlatform === p ? `${GOLD}18` : "transparent", color: displayPlatform === p ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif", textTransform: "uppercase" }}>
                      {p}
                    </button>
                  ))}
                </div>

                {/* Output cards */}
                <div>
                  {(result.outputs || []).map(output => (
                    <OutputCard
                      key={output.id}
                      output={output}
                      lang="en"
                      platform={displayPlatform}
                      onSave={handleSavePost}
                      isSaving={savingOutput === output.id}
                      isSaved={!!savedOutputs[output.id]}
                      canvaTemplates={canvaTemplates}
                    />
                  ))}
                </div>

                {/* Copy all */}
                {result.outputs?.length > 1 && (
                  <div style={{ marginTop: 16 }}>
                    <CopyBtn text={result.outputs.map(o => {
                      const cap = o.caption || {};
                      const en = typeof cap === "string" ? cap : (cap.en || "");
                      const es = typeof cap === "string" ? "" : (cap.es || "");
                      const it = typeof cap === "string" ? "" : (cap.it || "");
                      const ctaEn = typeof o.cta === "object" ? o.cta.en || "" : o.cta || "";
                      const ctaEs = typeof o.cta === "object" ? o.cta.es || "" : "";
                      const ctaIt = typeof o.cta === "object" ? o.cta.it || "" : "";
                      const tags = (o.hashtags_instagram || []).slice(0, 5).map(h => `#${h.replace(/^#/, "")}`).join(" ");
                      const parts = [];
                      if (en) parts.push(`🇬🇧 ${en}${ctaEn ? `\n${ctaEn}` : ""}`);
                      if (es) parts.push(`🇪🇸 ${es}${ctaEs ? `\n${ctaEs}` : ""}`);
                      if (it) parts.push(`🇮🇹 ${it}${ctaIt ? `\n${ctaIt}` : ""}`);
                      if (tags) parts.push(tags);
                      return `━━━ ${o.title} ━━━\n${parts.join("\n\n")}`;
                    }).join("\n\n")} label={`Copia Tutti (${result.outputs.length} output)`} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: PREVIEW IG ═══ */}
        {activeTab === "preview" && (
          <div style={{ animation: "luxyFade 0.3s ease-out" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
              <span style={{ fontSize: 18 }}>📱</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: OFF_WHITE, fontFamily: "'Cormorant Garamond', serif" }}>Preview Instagram</div>
                <div style={{ fontSize: 11, color: WARM_GREY }}>Anteprima mockup come appare su @luxy.exp</div>
              </div>
            </div>

            {result?.outputs?.length > 0 ? (
              <>
                <InstagramPreview outputs={result.outputs} displayLang="en" />
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "60px 20px", color: WARM_GREY }}>
                <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>📱</div>
                <div style={{ fontSize: 13 }}>Genera contenuti nella tab Genera per vedere la preview IG.</div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: MEMORIA ═══ */}
        {activeTab === "memoria" && (
          <div style={{ animation: "luxyFade 0.3s ease-out" }}>
            <MemoryPanel memory={memory} onUpdate={loadMemory} />
          </div>
        )}

        {/* ═══ TAB: STORICO ═══ */}
        {activeTab === "storico" && (
          <div style={{ animation: "luxyFade 0.3s ease-out" }}>
            <HistoryPanel history={history} />
          </div>
        )}

        {/* ═══ TAB: POST SALVATI ═══ */}
        {activeTab === "post" && (
          <div style={{ animation: "luxyFade 0.3s ease-out" }}>
            <SavedPostsPanel posts={savedPosts} onStatusChange={handleStatusChange} />
          </div>
        )}

      </div>
    </div>
  );
}
