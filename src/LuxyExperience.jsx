import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────
const GOLD = "#C9A96E";
const GOLD_DARK = "#A8813F";
const DARK = "#0D0D0D";
const CARD_BG = "#141414";
const OFF_WHITE = "#F8F4EE";
const WARM_GREY = "#8A8070";

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
    parse: (d) => (d.videos || []).map(v => ({ id: v.id, videoUrl: v.video_files?.[0]?.link, image: v.image, author: v.user?.name, link: v.url })),
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
  { label: "Post Ibiza Summer", text: "Crea 3 post Instagram per promuovere le ville di lusso a Ibiza in estate. Target: coppie affluent 35-50 anni.", icon: "🌴" },
  { label: "Yacht Weekend", text: "Caption per un weekend su yacht a Formentera. Tone: aspirazionale ma autentico. Include CTA per prenotazione.", icon: "⛵" },
  { label: "Nightlife Ibiza", text: "Post per promuovere accesso VIP a tavoli nei migliori club di Ibiza. Tone: esclusivo, FOMO marketing.", icon: "🎭" },
  { label: "Piano Mensile", text: "Piano editoriale 4 settimane per Luxy Experience estate 2025. Focus: awareness e lead generation.", icon: "📅" },
  { label: "H24 Promise", text: "Post sulla promessa H24 di Luxy: assistenza totale, nessun problema irrisolvibile. Tone: rassicurante e premium.", icon: "💎" },
  { label: "Bio Instagram", text: "Scrivi 3 versioni della bio Instagram per Luxy Experience. Deve comunicare lusso, personalizzazione e Ibiza.", icon: "👤" },
];

// ─────────────────────────────────────────────────
// LUXY SYSTEM PROMPT (specializzato)
// ─────────────────────────────────────────────────
const getLuxySystemPrompt = (memory, contentType, language) => {
  const memoryContext = memory.length > 0
    ? "\n\nBRAND MEMORY (usa sempre queste info):\n" + memory.map(m => `- ${m.key}: ${m.value}`).join("\n")
    : "";

  const langInstruction = language === "all"
    ? "Genera contenuti in ITALIANO, INGLESE e SPAGNOLO."
    : language === "it" ? "Genera contenuti in ITALIANO."
    : language === "en" ? "Genera contenuti in INGLESE."
    : "Genera contenuti in SPAGNOLO.";

  const overrideRules = contentType === "video_storyboard" 
    ? "LUXY STORYTELLING: Genera uno storyboard video. L'array 'outputs' DEVE rappresentare le SCENE del video (id: 1 = Scena 1). Per ogni scena: 'visual_description' (azione chiara), 'search_query' (massimo 3 parole in inglese esattissime per trovare il footage), 'caption' (il voiceover o testo in overlay)."
    : "Per piano editoriale, ogni output è un giorno. Per hashtag strategy, outputs = gruppi hashtag. Per bio profilo, outputs = 3 bio.";

  return `Sei il Senior Marketing Strategist di Luxy Experience, un servizio concierge di lusso con base a Ibiza.
${memoryContext}

REGOLA D'ORO: Contenuti autentici, mai plastic luxury. Foto reali, lifestyle documentaristico, golden hour, mare cristallino, momenti candid. 
Stile visivo: minimal luxury. Nero, oro, bianco avorio. Mai pacchiano.
Tone: Elegante e diretto. Il cliente si sente capito e coccolato. Non "economico", non "conveniente" — sempre "esclusivo", "su misura", "irripetibile".

${langInstruction}

Rispondi SOLO con JSON valido (nessun markdown, nessun testo prima o dopo). Struttura:

{
  "content_type": "${contentType}",
  "language": "${language}",
  "strategy_note": "Nota strategica breve in italiano",
  "outputs": [
    {
      "id": 1,
      "title": "Titolo breve",
      "platform": "instagram|facebook|multi",
      "format": "post|story|reel|bio|piano|scene",
      "caption": { "it": "...", "en": "...", "es": "..." },
      "hashtags_instagram": ["tag1", "tag2"],
      "hashtags_facebook": ["tag1", "tag2"],
      "cta": { "it": "...", "en": "...", "es": "..." },
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

${overrideRules}
CRITICAL: Rispondi SOLO con il JSON. Zero testo extra.`;
};

// ─────────────────────────────────────────────────
// API CALLS
// ─────────────────────────────────────────────────
async function callLuxyAI(prompt, memory, contentType, language) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: getLuxySystemPrompt(memory, contentType, language),
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
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 6px 4px", background: "linear-gradient(transparent, rgba(0,0,0,0.8))", fontSize: 8, color: OFF_WHITE, fontFamily: "'Montserrat', sans-serif" }}>{v.author || "Creator"}</div>
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
// OUTPUT CARD
// ─────────────────────────────────────────────────
function OutputCard({ output, lang, platform, onSave, isSaving, isSaved }) {
  const [expanded, setExpanded] = useState(true);

  const getCaption = () => {
    if (!output.caption) return "";
    if (typeof output.caption === "string") return output.caption;
    return output.caption[lang] || output.caption.it || output.caption.en || "";
  };

  const getCta = () => {
    if (!output.cta) return "";
    if (typeof output.cta === "string") return output.cta;
    return output.cta[lang] || output.cta.it || "";
  };

  const getHashtags = () => {
    const tags = platform === "facebook" ? output.hashtags_facebook : output.hashtags_instagram;
    return (tags || []).map(h => `#${h.replace(/^#/, "")}`).join(" ");
  };

  const caption = getCaption();
  const cta = getCta();
  const hashtags = getHashtags();
  const copyText = `${caption}\n\n${hashtags}${cta ? `\n\n${cta}` : ""}`;

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
                  <SceneVideoPlayer query={output.search_query} sourceKey="pexels_video" />
                </div>
              )}
            </div>
          )}

          {/* Caption */}
          {caption && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>Caption</div>
              <div style={{ fontSize: 13.5, color: OFF_WHITE, lineHeight: 1.75, whiteSpace: "pre-line", fontFamily: "'Cormorant Garamond', serif" }}>
                {caption}
              </div>
            </div>
          )}

          {/* Hashtags */}
          {hashtags && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                Hashtag {platform === "facebook" ? "(FB)" : "(IG)"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(platform === "facebook" ? output.hashtags_facebook : output.hashtags_instagram || []).map((h, i) => (
                  <span key={i} style={{ fontSize: 11, color: `${GOLD}CC`, fontWeight: 500 }}>#{h.replace(/^#/, "")}</span>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          {cta && (
            <div style={{ padding: "8px 12px", background: `${GOLD}10`, borderRadius: 8, marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: WARM_GREY, letterSpacing: "0.15em", textTransform: "uppercase" }}>CTA:</span>
              <span style={{ fontSize: 12, color: GOLD, fontWeight: 600 }}>{cta}</span>
            </div>
          )}

          {/* Platform tip */}
          {output.platform_tip && (
            <div style={{ fontSize: 11, color: WARM_GREY, fontStyle: "italic", marginBottom: 14, padding: "6px 0", borderTop: `1px solid ${GOLD}10` }}>
              💡 {output.platform_tip}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <CopyBtn text={copyText} />
            <CopyBtn text={caption} small />
            {!isSaved ? (
              <button onClick={() => onSave(output)} disabled={isSaving}
                style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${GOLD}50`, background: isSaving ? `${GOLD}10` : `${GOLD}18`, color: GOLD, fontSize: 11, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                {isSaving ? "Salvo..." : "💾 Salva Post"}
              </button>
            ) : (
              <span style={{ fontSize: 11, color: "#5A9A5A", fontWeight: 600, padding: "7px 0" }}>✓ Salvato nel DB</span>
            )}
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
  const [language, setLanguage] = useState("it");
  const [displayLang, setDisplayLang] = useState("it");
  const [displayPlatform, setDisplayPlatform] = useState("instagram");

  const promptRef = useRef(null);

  // ── DB Init ───────────────────────────────────
  useEffect(() => {
    initDB();
  }, []);

  const initDB = async () => {
    try {
      const initRes = await dbCall("init");
      if (initRes.ok) {
        setDbStatus("ok");
        await Promise.all([loadStats(), loadMemory(), loadHistory(), loadPosts()]);
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
      const parsed = await callLuxyAI(finalPrompt, memory, contentType, language);
      setResult(parsed);

      // Save request to DB
      if (dbStatus === "ok") {
        await dbCall("save_request", "POST", {
          type: contentType.includes("piano") ? "strategy" : contentType.includes("campagna") ? "campaign" : "content",
          prompt: finalPrompt,
          result_json: parsed,
          language,
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
      const caption = typeof output.caption === "object" ? output.caption[displayLang] || output.caption.it : output.caption;
      const cta = typeof output.cta === "object" ? output.cta[displayLang] || output.cta.it : output.cta;
      await dbCall("save_post", "POST", {
        platform: output.platform || displayPlatform,
        language: displayLang,
        caption,
        hashtags: displayPlatform === "facebook" ? output.hashtags_facebook : output.hashtags_instagram,
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

  // ── Tabs ──────────────────────────────────────
  const TABS = [
    { id: "genera", label: "Genera", icon: "✨" },
    { id: "memoria", label: "Memoria", icon: "🧠" },
    { id: "storico", label: "Storico", icon: "📚" },
    { id: "post", label: "Post Salvati", icon: "📌" },
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

            {/* Lingua */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: WARM_GREY, marginBottom: 12 }}>Lingua Output</div>
              <div style={{ display: "flex", gap: 8 }}>
                {LANGUAGES.map(l => (
                  <button key={l.id} onClick={() => { setLanguage(l.id); if (l.id !== "all") setDisplayLang(l.id); }}
                    style={{ padding: "7px 16px", borderRadius: 8, border: `1px solid ${language === l.id ? GOLD : GOLD + "30"}`, background: language === l.id ? `${GOLD}18` : "transparent", color: language === l.id ? GOLD : WARM_GREY, fontSize: 11, cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                    {l.flag} {l.label}
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

                {/* Language / Platform toggles for display */}
                <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                  {language === "all" && LANGUAGES.filter(l => l.id !== "all").map(l => (
                    <button key={l.id} onClick={() => setDisplayLang(l.id)}
                      style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${displayLang === l.id ? GOLD : GOLD + "30"}`, background: displayLang === l.id ? `${GOLD}18` : "transparent", color: displayLang === l.id ? GOLD : WARM_GREY, fontSize: 10, cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                      {l.flag} {l.label}
                    </button>
                  ))}
                  <div style={{ width: 1, background: `${GOLD}20` }} />
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
                      lang={displayLang}
                      platform={displayPlatform}
                      onSave={handleSavePost}
                      isSaving={savingOutput === output.id}
                      isSaved={!!savedOutputs[output.id]}
                    />
                  ))}
                </div>

                {/* Copy all */}
                {result.outputs?.length > 1 && (
                  <div style={{ marginTop: 16 }}>
                    <CopyBtn text={result.outputs.map(o => {
                      const cap = typeof o.caption === "object" ? o.caption[displayLang] || o.caption.it : o.caption;
                      const tags = (displayPlatform === "facebook" ? o.hashtags_facebook : o.hashtags_instagram || []).map(h => `#${h.replace(/^#/, "")}`).join(" ");
                      return `--- ${o.title} ---\n${cap}\n\n${tags}`;
                    }).join("\n\n")} label={`Copia Tutti (${result.outputs.length} output)`} />
                  </div>
                )}
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
