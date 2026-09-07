import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MARKETING_TOOLKIT } from "./marketingFrameworks";
import { saveCanvaDesign, listCanvaDesigns } from "./canvaDesigns";

// Claude a volte antepone/pospone del testo al JSON nonostante l'istruzione
// "solo JSON": invece di assumere che l'intera stringa ripulita sia JSON puro,
// estrae la sottostringa dalla prima "{" all'ultima "}".
function parseJsonResponse(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Il modello non ha risposto con un JSON valido.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ─────────────────────────────────────────────────
// API CONFIGURATION
// Le keys vengono lette dalle Environment Variables di Vercel
// Fallback: l'utente può inserirle nel pannello API Setup in-app
// ─────────────────────────────────────────────────
const API_KEYS = {
  unsplash: import.meta.env.VITE_UNSPLASH_KEY || "",
  pexels: import.meta.env.VITE_PEXELS_KEY || "",
  pixabay: import.meta.env.VITE_PIXABAY_KEY || "",
};

// ─────────────────────────────────────────────────
// SYSTEM PROMPT GENERATOR
// ─────────────────────────────────────────────────
const getSystemPrompt = (config = { duration: "1 settimana", frequency: 3 }, brand = null, insights = null) => {
  const { duration, frequency } = config;
  const brandCtx = brand?.name ? `\n\nBRAND CONTEXT (usa sempre queste info per personalizzare ogni output):\n- Brand: ${brand.name}${brand.sector ? `\n- Settore: ${brand.sector}` : ""}${brand.tone ? `\n- Tono di voce: ${brand.tone}` : ""}${brand.description ? `\n- Descrizione: ${brand.description}` : ""}${brand.instagramHandle ? `\n- Instagram: ${brand.instagramHandle}` : ""}${brand.hashtags ? `\n- Hashtag principali: ${brand.hashtags}` : ""}` : "";

  // Memoria di progetto accumulata dalle analisi Instagram passate (loop di
  // auto-apprendimento): ogni nuova strategia costruisce sopra a quanto già
  // imparato, invece di ripartire sempre da zero.
  const insightsCtx = insights && (insights.tips?.length || insights.strengths?.length || insights.weaknesses?.length)
    ? `\n\nMEMORIA DI PROGETTO (da analisi Instagram precedenti — usala per migliorare la strategia, non ripetere consigli già dati):${insights.strengths?.length ? `\n- Punti di forza confermati: ${insights.strengths.join(" | ")}` : ""}${insights.weaknesses?.length ? `\n- Debolezze da correggere: ${insights.weaknesses.join(" | ")}` : ""}${insights.tips?.length ? `\n- Consigli accumulati: ${insights.tips.join(" | ")}` : ""}`
    : "";

  // IMPORTANTE — trovato testando ripetutamente contro produzione (curl diretto
  // su vmscout.vercel.app/api/chat): questo modello, se non vincolato con limiti
  // di parole ESPLICITI e RIGIDI su ogni campo, scrive risposte molto più lunghe
  // del necessario e, con uno schema ampio come questo (3 lingue × 3 slide × più
  // campi + piano editoriale di 7 giorni + storyboard video), il tempo di
  // generazione supera facilmente i 45-60s e la richiesta va in timeout (stesso
  // problema diagnosticato in Analytics). Con i limiti sotto, verificato 3 volte
  // di fila con brief reali: 32-34s, JSON sempre valido. Non allentare questi
  // limiti senza ritestare — vedi PROJECT_DIRECTIVES.md.
  return `You are Visual Marketing Scout — Senior Marketing Strategist & Visual Director. Respond ONLY with valid JSON (no markdown fences, no preamble).

GOLDEN RULE: "Anti-AI Aesthetic" — authentic, real, imperfect visuals only. No plastic stock photos or corporate B-roll.

CONCISION IS MANDATORY. Every field below has a hard word limit — respect it exactly, this is the single most important rule. Short, direct, professional copy. Zero flowery preamble, zero filler, zero repeated ideas across fields.

Structure (word limits in parentheses):
{"strategy":{"emotion":"(2 words)","framework":"carousel architecture: Value-Stack|Problem-Proof|Hack-List|Rant|Demo","palette":["c1","c2","c3","c4"],"palette_hex":["#h1","#h2","#h3","#h4"],"narrative":"Italian, max 18 words"},"direction":{"style":"max 5 words","composition":"max 5 words","lighting":"max 5 words"},"queries":{"primary":["q1","q2","q3"],"secondary":["q4","q5"],"avoid":["bad1","bad2"]},"video_queries":{"primary":["vq1","vq2","vq3"],"secondary":["vq4","vq5"],"style_notes":"max 8 words"},"post_composer":[{"slide_number":1,"hook_type":"Curiosity|Story|Value|Contrarian","visual_description":"max 10 words, in the user's language","search_query":"max 3 English words","instagram_hashtag":"#tag","captions":{"it":"max 18 words","en":"max 18 words","es":"max 18 words"},"hashtags_instagram":["6 tags"],"hashtags_facebook":["3 tags"],"cta":{"it":"max 4 words","en":"max 4 words","es":"max 4 words"},"platform_tip":"max 6 words"}],"editorial_plan":{"duration_context":"${duration}","weekly_focus":"max 6 words","days":[{"day":"Lunedì","content_type":"Post|Story|Reel|Carousel","topic":"max 4 words","goal":"Awareness|Engagement|Conversion|Community","best_time":"18:30","fb_cross_post_tip":"max 6 words","story_reel_hint":"max 6 words"}]},"video_storytelling":{"concept":{"it":"max 8 words","en":"max 8 words","es":"max 8 words"},"duration":"15s","aspect_ratio":"9:16","music_mood":"2 words","scenes":[{"scene_number":1,"duration":"3s","footage_type":"type","description":{"it":"max 5 words","en":"max 5 words","es":"max 5 words"},"search_query":"max 3 English words","text_overlay":{"it":"max 3 words","en":"max 3 words","es":"max 3 words"},"transition":"cut"}],"audio_notes":{"it":"max 6 words","en":"max 6 words","es":"max 6 words"}},"orientation":"portrait|landscape|square","mood_tags":["t1","t2","t3"]}

RULES:
- Generate exactly 3 post_composer slides, exactly 3 video_storytelling scenes.
- If duration is "1 settimana", generate all 7 editorial_plan days (Lunedì-Domenica). If longer (1 month+): Week 1 detailed (7 days), subsequent weeks as high-level entries with the same fields (topic = weekly theme).
- FREQUENCY: ${frequency} main posts/week on IG+FB — reflect this in the editorial plan's rhythm.
- English, max 3 words, every photo/video search_query: [adjective]+[subject]+[location]. Prefer broadly-tagged stock subjects (city/region/landscape type) over hyper-specific niche place names — those return zero results on Pexels/Pixabay. Put the niche place name in visual_description instead.
- No search_query string may repeat anywhere in the whole response (photo or video, any section).
- CAROUSEL/MULTI-SLIDE DIFFERENTIATION: if the brief involves N items of the same type (e.g. "3 villas"), each slide's search_query must be a VISUALLY DISTINCT subject, not the same subject from different angles (e.g. villa: exterior cliffside / infinity pool / minimalist interior — never the same query 3x).
- Each video scene's search_query must be visually distinct from the others and serve a clear narrative beat.

FRAMEWORK APPLICATION (apply the toolkit below concretely — do not name frameworks in captions):
- Pick ONE carousel architecture in strategy.framework; every slide must serve it. Slide 1 is a standalone scroll-stopping cover (works alone in the feed).
- Slide 1 caption opens with a hook of its hook_type. Every caption follows PAS, AIDA or BAB — lead with tension/benefit, never a flat description.
- Each cta is one concrete action leveraging exactly one ethical lever (social proof, loss aversion, curiosity gap) — no fake scarcity.
- editorial_plan: rotate 3-5 content pillars across the days, vary the goal each day, max 1 promotional day per week.
- video_storytelling: scene 1 is a 0-3s hook (visual + text_overlay); each later scene is a distinct narrative beat; the final scene carries the CTA.

${MARKETING_TOOLKIT}${brandCtx}${insightsCtx}`;
};

// ─────────────────────────────────────────────────
// PHOTO & VIDEO SOURCES
// ─────────────────────────────────────────────────
const PHOTO_SOURCES = {
  unsplash: {
    name: "Unsplash", icon: "U", color: "#111",
    webUrl: (q, o) => `https://unsplash.com/s/photos/${encodeURIComponent(q)}${o ? `?orientation=${o}` : ""}`,
    apiUrl: (q, o) => `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=6&content_filter=high${o ? `&orientation=${o}` : ""}`,
    headers: () => ({ Authorization: `Client-ID ${API_KEYS.unsplash}` }),
    parse: (d) => (d.results || []).map(r => ({ id: r.id, thumb: r.urls?.small, full: r.urls?.full || r.urls?.regular, alt: r.alt_description, author: r.user?.name, link: r.links?.html })),
  },
  pexels: {
    name: "Pexels", icon: "P", color: "#05A081",
    webUrl: (q) => `https://www.pexels.com/search/${encodeURIComponent(q)}/`,
    apiUrl: (q, o) => `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=6&size=large${o === "portrait" ? "&orientation=portrait" : o === "landscape" ? "&orientation=landscape" : ""}`,
    headers: () => ({ Authorization: API_KEYS.pexels }),
    parse: (d) => (d.photos || []).map(p => ({ id: p.id, thumb: p.src?.medium, full: p.src?.large2x || p.src?.large, alt: p.alt, author: p.photographer, link: p.url })),
  },
  pixabay: {
    name: "Pixabay", icon: "X", color: "#00AB6C",
    webUrl: (q) => `https://pixabay.com/images/search/${encodeURIComponent(q)}/`,
    apiUrl: (q, o) => `https://pixabay.com/api/?key=${API_KEYS.pixabay}&q=${encodeURIComponent(q)}&per_page=6&image_type=photo&min_width=1280${o === "portrait" ? "&orientation=vertical" : o === "landscape" ? "&orientation=horizontal" : ""}`,
    headers: () => ({}),
    parse: (d) => (d.hits || []).map(h => ({ id: h.id, thumb: h.webformatURL, full: h.fullHDURL || h.largeImageURL, alt: h.tags, author: h.user, link: h.pageURL })),
  },
  pinterest: {
    name: "Pinterest", icon: "P", color: "#E60023",
    webUrl: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}&rs=typed`,
  },
  instagram: {
    name: "Instagram", icon: "IG", color: "#E1306C",
    webUrl: (q) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`,
  },
};

const VIDEO_SOURCES = {
  pexels_video: {
    name: "Pexels Video", icon: "▶", color: "#05A081",
    webUrl: (q) => `https://www.pexels.com/search/videos/${encodeURIComponent(q)}/`,
    apiUrl: (q) => `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=3&size=large`,
    headers: () => ({ Authorization: API_KEYS.pexels }),
    parse: (d) => (d.videos || []).map(v => {
      const files = (v.video_files || []).filter(f => f.file_type === "video/mp4");
      const hd = files.find(f => f.quality === "hd") || files.find(f => (f.width || 0) >= 1280) || files[0];
      return { id: v.id, videoUrl: hd?.link, image: v.image, author: v.user?.name, link: v.url };
    }),
  },
  coverr: {
    name: "Coverr", icon: "C", color: "#1A1A2E",
    webUrl: (q) => `https://coverr.co/s?q=${encodeURIComponent(q)}`,
  },
  pixabay_video: {
    name: "Pixabay Video", icon: "X", color: "#00AB6C",
    webUrl: (q) => `https://pixabay.com/videos/search/${encodeURIComponent(q)}/`,
    apiUrl: (q) => `https://pixabay.com/api/videos/?key=${API_KEYS.pixabay}&q=${encodeURIComponent(q)}&per_page=3&min_width=1280`,
    headers: () => ({}),
    parse: (d) => (d.hits || []).map(h => ({ id: h.id, videoUrl: h.videos?.large?.url || h.videos?.medium?.url || h.videos?.tiny?.url, image: h.userImageURL, author: h.user, link: h.pageURL })),
  },
  pinterest_video: {
    name: "Pinterest Video", icon: "P", color: "#E60023",
    webUrl: (q) => `https://www.pinterest.com/search/videos/?q=${encodeURIComponent(q)}&rs=typed`,
  },
  instagram_video: {
    name: "Instagram Reels", icon: "IG", color: "#E1306C",
    webUrl: (q) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`,
  },
};

// ─────────────────────────────────────────────────
// API VIDEO FETCHER
// ─────────────────────────────────────────────────
async function fetchVideosOnce(query, sourceKey) {
  const src = VIDEO_SOURCES[sourceKey];
  if (!src?.apiUrl || !API_KEYS[sourceKey.split("_")[0]]) return null;
  try {
    const res = await fetch(src.apiUrl(query), { headers: src.headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return src.parse(data);
  } catch { return null; }
}

async function fetchVideos(query, sourceKey) {
  for (const attempt of broadenAttempts(query)) {
    const results = await fetchVideosOnce(attempt, sourceKey);
    if (results?.length) return results;
  }
  return null;
}

const EXAMPLES = [
  "Lancio campagna Instagram per brand di skincare naturale. Target: donne 25-35, tono soft e autentico.",
  "Campagna employer branding per startup tech a Milano. Voglio attrarre talenti Gen Z.",
  "Landing page per ritiri di yoga in Sardegna. Tono lussuoso ma spirituale.",
  "Ads Facebook per e-commerce abbigliamento outdoor Gen Z. Tono ribelle, ecosostenibile.",
  "Newsletter per un rooftop bar a Torino. Aperitivo vibes, golden hour.",
];

// ─────────────────────────────────────────────────
// API IMAGE FETCHER
// ─────────────────────────────────────────────────
async function fetchImagesOnce(query, orientation, sourceKey) {
  const src = PHOTO_SOURCES[sourceKey];
  if (!src?.apiUrl || !API_KEYS[sourceKey]) return null;
  try {
    const res = await fetch(src.apiUrl(query, orientation), { headers: src.headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return src.parse(data);
  } catch { return null; }
}

// Query troppo specifiche (nomi di luogo di nicchia, 3 parole rare insieme)
// spesso restituiscono 0 risultati su Pexels/Pixabay. Invece di lasciare la
// ricerca vuota, allarga progressivamente togliendo l'ultima parola (di solito
// la location, la più di nicchia) finché non trova risultati o le parole finiscono.
function broadenAttempts(query) {
  const words = (query || "").trim().split(/\s+/).filter(Boolean);
  const attempts = [];
  for (let n = words.length; n >= 1; n--) {
    const q = words.slice(0, n).join(" ");
    if (!attempts.includes(q)) attempts.push(q);
  }
  return attempts.length ? attempts : [query];
}

async function fetchImages(query, orientation, sourceKey) {
  for (const attempt of broadenAttempts(query)) {
    const results = await fetchImagesOnce(attempt, orientation, sourceKey);
    if (results?.length) return { results, queryUsed: attempt };
  }
  return null;
}

// ─────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#8B7355", animation: `typingBounce 1.2s ease-in-out ${i * 0.15}s infinite` }} />
      ))}
    </div>
  );
}

function PaletteStrip({ hex = [], names = [] }) {
  if (!hex.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, margin: "12px 0 8px" }}>
      {hex.map((c, i) => (
        <div key={i} style={{ textAlign: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: c, border: "2px solid rgba(0,0,0,0.08)", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }} />
          <div style={{ fontSize: 9, marginTop: 4, color: "#8B7355", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", maxWidth: 54, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {names[i] || c}
          </div>
        </div>
      ))}
    </div>
  );
}

function ImageGrid({ images }) {
  if (!images?.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "10px 0" }}>
      {images.slice(0, 6).map((img, i) => (
        <div key={i} style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1", position: "relative", background: "#111" }}>
          <img src={img.thumb} alt={img.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "18px 5px 5px", background: "linear-gradient(transparent, rgba(0,0,0,0.7))", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <span style={{ fontSize: 7, color: "rgba(255,255,255,0.7)", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{img.author}</span>
            {img.full && <CanvaUploadBtn url={img.full} />}
          </div>
          <a href={img.link} target="_blank" rel="noopener noreferrer" style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", textDecoration: "none", fontSize: 10 }}>↗</a>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children, color = "#8B7355" }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color, marginBottom: 8 }}>{children}</div>;
}

function CopyButton({ text, label = "Copia" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ width: "100%", padding: "7px", borderRadius: 12, border: "1px solid rgba(139,115,85,0.15)", background: copied ? "rgba(139,115,85,0.1)" : "transparent", color: "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif" }}>
      {copied ? "✓ Copiato!" : label}
    </button>
  );
}

function CanvaUploadBtn({ url }) {
  const [status, setStatus] = useState("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleUpload() {
    setStatus("loading");
    setErrMsg("");
    try {
      const res = await fetch("/api/canva-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name: "vmscout-media" }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("done");
      } else if (data.error === "CANVA_NOT_CONNECTED") {
        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
        setStatus("idle");
      } else {
        setErrMsg(data.message || `Errore`);
        setStatus("error");
        setTimeout(() => setStatus("idle"), 5000);
      }
    } catch (e) {
      setErrMsg(e.message || "Errore");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  }

  const base = { padding: "4px 8px", borderRadius: 8, fontSize: 9, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", cursor: "pointer", border: "none", display: "flex", alignItems: "center", gap: 3 };
  if (status === "done") return <span style={{ ...base, background: "#3A7A3A", color: "#9EE49E" }}>✓ Canva</span>;
  if (status === "error") return <span title={errMsg} style={{ ...base, background: "#7A3A3A", color: "#E49E9E", cursor: "help" }}>⚠ Err</span>;
  return (
    <button onClick={handleUpload} disabled={status === "loading"} style={{ ...base, background: "rgba(0,196,204,0.75)", color: "#fff", opacity: status === "loading" ? 0.6 : 1 }}>
      {status === "loading" ? "⏳" : "⬆"} Canva
    </button>
  );
}

// Formati design supportati dai template Canva per-slide (stessi di Canva Studio).
const CANVA_QD_FORMATS = [
  { id: "post", label: "Post 1:1", vertical: false },
  { id: "story", label: "Story 9:16", vertical: true },
  { id: "reel", label: "Reel 9:16", vertical: true },
];

// Modale "Crea design rapido" agganciata a una singola slide di Visual Scout:
// caption e query arrivano già dal suggerimento, l'utente sceglie il formato e
// UNA delle foto suggerite (o lascia la ricerca automatica), poi il backend
// carica quell'immagine e compila il template Canva.
function CanvaQuickDesignModal({ open, onClose, caption, cta, query, orientation, canvaTemplates, projectId }) {
  const [format, setFormat] = useState("post");
  const [captionText, setCaptionText] = useState(caption || "");
  const [queryText, setQueryText] = useState(query || "");
  const [source, setSource] = useState(() => defaultPhotoSource() || "pexels");
  const [images, setImages] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [selectedImg, setSelectedImg] = useState(null); // url immagine scelta, null = ricerca automatica
  const [creating, setCreating] = useState(false);
  const [designUrl, setDesignUrl] = useState(null);
  const [error, setError] = useState("");

  // reset quando si riapre su un'altra slide
  useEffect(() => {
    if (!open) return;
    setCaptionText(caption || "");
    setQueryText(query || "");
    setSelectedImg(null);
    setDesignUrl(null);
    setError("");
  }, [open, caption, query]);

  const fmt = CANVA_QD_FORMATS.find(f => f.id === format);
  const templateId = canvaTemplates?.[format] || "";
  const orient = fmt?.vertical ? "portrait" : (orientation || "square");

  // carica le foto suggerite per la query (debounce leggero sulla digitazione)
  useEffect(() => {
    if (!open) return;
    const q = queryText.trim();
    if (!q) { setImages(null); return; }
    let active = true;
    setImgLoading(true);
    const t = setTimeout(() => {
      fetchImages(q, orient, source).then(o => {
        if (!active) return;
        setImages(o?.results || []);
        setImgLoading(false);
      });
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [open, queryText, source, orient]);

  async function handleCreate() {
    if (!templateId) return;
    setCreating(true);
    setError("");
    setDesignUrl(null);
    try {
      const res = await fetch("/api/canva-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: captionText.trim(),
          cta: cta || "",
          search_query: queryText.trim(),
          format,
          templateId,
          imageUrl: selectedImg || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDesignUrl(data.url);
        saveCanvaDesign({
          project_id: projectId || null,
          kind: "design",
          format,
          title: captionText.trim().slice(0, 80) || "Design",
          design_url: data.url,
          thumb_url: selectedImg || data.imageUrl || null,
        });
      } else if (data.error === "CANVA_NOT_CONNECTED") {
        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
        setError("Connetti Canva nella finestra aperta, poi riprova.");
      } else {
        setError(data.message || "Errore durante la creazione del design.");
      }
    } catch (e) {
      setError(e.message || "Errore di rete.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, background: "#0C0C0C", border: "1px solid #1E1E1E", borderRadius: 20, padding: 22, fontFamily: "'Space Grotesk', sans-serif", color: "#F0EBE3" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "#00C4CC", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
            ✦ Crea design in Canva
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: "#3A3A3A", marginBottom: 16 }}>Da questo suggerimento di Visual Scout.</div>

        {/* Formato */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {CANVA_QD_FORMATS.map(f => (
            <button key={f.id} onClick={() => { setFormat(f.id); setDesignUrl(null); }}
              style={{ flex: 1, padding: "7px 4px", fontSize: 11, borderRadius: 12, cursor: "pointer", border: `1px solid ${format === f.id ? "#00C4CC70" : "#1E1E1E"}`, background: format === f.id ? "rgba(0,196,204,0.1)" : "transparent", color: format === f.id ? "#00C4CC" : "#555", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
              {f.label}
            </button>
          ))}
        </div>

        {!templateId && (
          <div style={{ padding: "9px 12px", borderRadius: 13, background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.2)", color: "#C9A96E", fontSize: 11, marginBottom: 14, lineHeight: 1.5 }}>
            Nessun Template ID per "{fmt?.label}" — impostalo in Canva Studio.
          </div>
        )}

        {/* Caption */}
        <label style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'Space Grotesk', sans-serif", display: "block", marginBottom: 5 }}>Caption</label>
        <textarea value={captionText} onChange={e => setCaptionText(e.target.value)} rows={3}
          style={{ width: "100%", background: "#141414", border: "1px solid #222", borderRadius: 13, padding: "9px 12px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", resize: "none", marginBottom: 12 }} />

        {/* Query */}
        <label style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'Space Grotesk', sans-serif", display: "block", marginBottom: 5 }}>Query foto</label>
        <input value={queryText} onChange={e => setQueryText(e.target.value)}
          style={{ width: "100%", background: "#141414", border: "1px solid #222", borderRadius: 13, padding: "8px 12px", color: "#F0EBE3", fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 10 }} />

        {/* Sorgente + immagini suggerite */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {Object.entries(PHOTO_SOURCES).filter(([k, s]) => s.apiUrl && API_KEYS[k]).map(([k, s]) => (
            <button key={k} onClick={() => setSource(k)}
              style={{ padding: "4px 10px", borderRadius: 10, border: `1px solid ${source === k ? "#8B7355" : "#222"}`, background: source === k ? "rgba(139,115,85,0.15)" : "transparent", color: source === k ? "#C9A96E" : "#555", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
              {s.name}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 6, fontSize: 10, color: "#555" }}>
          {selectedImg ? "Immagine scelta" : "Scegli una foto suggerita, o lascia la ricerca automatica"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 }}>
          <button onClick={() => setSelectedImg(null)}
            style={{ aspectRatio: "1", borderRadius: 12, border: `2px solid ${selectedImg === null ? "#00C4CC" : "#222"}`, background: "#141414", color: selectedImg === null ? "#00C4CC" : "#555", fontSize: 10, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, padding: 4 }}>
            🔀 Auto
          </button>
          {imgLoading && !images?.length
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ aspectRatio: "1", borderRadius: 12, background: "#141414" }} />
              ))
            : (images || []).slice(0, 5).map((img, i) => {
                const url = img.full || img.thumb;
                const active = selectedImg === url;
                return (
                  <button key={img.id || i} onClick={() => setSelectedImg(url)}
                    style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", padding: 0, border: `2px solid ${active ? "#00C4CC" : "#222"}`, cursor: "pointer", background: "#141414" }}>
                    <img src={img.thumb} alt={img.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: active ? 1 : 0.85 }} loading="lazy" />
                  </button>
                );
              })}
        </div>

        {error && (
          <div style={{ padding: "9px 12px", borderRadius: 13, background: "rgba(180,60,60,0.1)", border: "1px solid rgba(180,60,60,0.2)", color: "#E47070", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>{error}</div>
        )}

        {designUrl ? (
          <a href={designUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", padding: "12px", borderRadius: 13, textAlign: "center", textDecoration: "none", border: "1px solid rgba(90,186,90,0.35)", background: "rgba(90,186,90,0.1)", color: "#5ABA5A", fontSize: 13, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            ✓ Apri design in Canva →
          </a>
        ) : (
          <button onClick={handleCreate} disabled={creating || !templateId || !captionText.trim()}
            style={{ width: "100%", padding: "12px", borderRadius: 13, fontSize: 13, fontWeight: 700, cursor: creating || !templateId || !captionText.trim() ? "not-allowed" : "pointer", border: "1px solid #00C4CC45", background: "rgba(0,196,204,0.12)", color: "#00C4CC", fontFamily: "'Space Grotesk', sans-serif", opacity: creating || !templateId || !captionText.trim() ? 0.5 : 1 }}>
            {creating ? "⏳ Creo design…" : "✦ Crea Design in Canva"}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// Pulsante per-slide che apre CanvaQuickDesignModal.
function CanvaDesignButton({ caption, cta, query, orientation, canvaTemplates, projectId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ padding: "7px 12px", borderRadius: 12, border: "1px solid rgba(0,196,204,0.3)", background: "rgba(0,196,204,0.07)", color: "#00C4CC", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        ✦ Crea design
      </button>
      <CanvaQuickDesignModal
        open={open}
        onClose={() => setOpen(false)}
        caption={caption}
        cta={cta}
        query={query}
        orientation={orientation}
        canvaTemplates={canvaTemplates}
        projectId={projectId}
      />
    </>
  );
}

const CAROUSEL_MAX_PAGES = 10;

// Selettore foto compatto per una riga del composer carosello: mostra la foto
// scelta o "Auto", ed espande una griglia di risultati per la query della riga.
function RowImagePicker({ query, imageUrl, onPick }) {
  const [openGrid, setOpenGrid] = useState(false);
  const [imgs, setImgs] = useState(null);
  const [loading, setLoading] = useState(false);
  const source = defaultPhotoSource() || "pexels";

  useEffect(() => {
    if (!openGrid) return;
    const q = (query || "").trim();
    if (!q) { setImgs([]); return; }
    let active = true;
    setLoading(true);
    fetchImages(q, "portrait", source).then(o => { if (active) { setImgs(o?.results || []); setLoading(false); } });
    return () => { active = false; };
  }, [openGrid, query, source]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden", background: "#141414", border: "1px solid #262626", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#555" }}>
          {imageUrl ? <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "auto"}
        </div>
        <button type="button" onClick={() => setOpenGrid(v => !v)}
          style={{ padding: "5px 9px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#888", fontSize: 10, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
          {openGrid ? "Chiudi" : "🔎 Foto"}
        </button>
        {imageUrl && (
          <button type="button" onClick={() => onPick(null)}
            style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid #262626", background: "transparent", color: "#666", fontSize: 10, cursor: "pointer" }}>
            ✕ auto
          </button>
        )}
      </div>
      {openGrid && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginTop: 6 }}>
          {loading && !imgs?.length
            ? Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ aspectRatio: "1", borderRadius: 7, background: "#141414" }} />)
            : (imgs || []).slice(0, 8).map((img, i) => {
                const u = img.full || img.thumb;
                return (
                  <button key={img.id || i} type="button" onClick={() => { onPick(u); setOpenGrid(false); }}
                    style={{ aspectRatio: "1", borderRadius: 7, overflow: "hidden", padding: 0, border: `2px solid ${imageUrl === u ? "#00C4CC" : "#222"}`, cursor: "pointer", background: "#141414" }}>
                    <img src={img.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                  </button>
                );
              })}
          {!loading && imgs && !imgs.length && <div style={{ gridColumn: "1 / -1", fontSize: 10, color: "#555" }}>Nessun risultato per "{query}".</div>}
        </div>
      )}
    </div>
  );
}

// Composer del carosello: parte dalle slide di Visual Scout, ma si possono
// aggiungere/rimuovere/riordinare pagine, cambiare foto per pagina e inserire
// una pagina da un design Canva già creato (ne riusa foto + titolo). Un solo
// autofill del template carosello.
function CarouselComposer({ initialSlides, canvaTemplates, projectId }) {
  const templateId = canvaTemplates?.carousel || "";
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState([]);
  const [state, setState] = useState("idle");
  const [url, setUrl] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [savedDesigns, setSavedDesigns] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPages((initialSlides || []).map(s => ({
      caption: s.caption || "", search_query: s.search_query || "", image_url: s.image_url || null,
    })));
    setState("idle"); setUrl(null); setErrMsg(""); setPickerOpen(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(i, key, val) {
    setPages(p => p.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  }
  function move(i, dir) {
    setPages(p => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeRow(i) { setPages(p => p.filter((_, idx) => idx !== i)); }
  function addBlank() { setPages(p => p.length >= CAROUSEL_MAX_PAGES ? p : [...p, { caption: "", search_query: "", image_url: null }]); }

  async function openDesignPicker() {
    setPickerOpen(true);
    if (savedDesigns === null) setSavedDesigns(await listCanvaDesigns(projectId));
  }
  function addFromDesign(d) {
    setPages(p => p.length >= CAROUSEL_MAX_PAGES ? p : [...p, {
      caption: d.title || "", search_query: "", image_url: d.thumb_url || null, from_design: d.id,
    }]);
    setPickerOpen(false);
  }

  async function handleCreate() {
    setState("loading"); setErrMsg("");
    try {
      const res = await fetch("/api/canva-carousel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slides: pages.map(p => ({ caption: p.caption, search_query: p.search_query, image_url: p.image_url || undefined })),
          templateId, format: "post",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setUrl(data.url); setState("done");
        saveCanvaDesign({
          project_id: projectId || null, kind: "carousel", format: "carousel",
          title: `Carosello ${pages.length} pagine`, design_url: data.url,
          thumb_url: (pages.find(p => p.image_url)?.image_url) || data.imageUrls?.[0] || null,
          slides: pages.length,
        });
      } else if (data.error === "CANVA_NOT_CONNECTED") {
        window.open("/api/canva-auth?action=login", "_blank", "width=600,height=700");
        setState("idle");
      } else {
        setErrMsg(data.message || "Errore durante la creazione del carosello.");
        setState("idle");
      }
    } catch (e) {
      setErrMsg(e.message || "Errore di rete."); setState("idle");
    }
  }

  if (!templateId) {
    return (
      <span title='Configura il "Template Carosello" in Canva Studio (placeholder Image_1/Testo_1, ...)'
        style={{ padding: "9px 16px", borderRadius: 12, border: "1px solid rgba(139,115,85,0.15)", color: "#B5A88A", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", cursor: "help", userSelect: "none" }}>
        ✦ Configura template carosello in Canva Studio
      </span>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ padding: "9px 16px", borderRadius: 12, border: "1px solid rgba(0,196,204,0.3)", background: "rgba(0,196,204,0.07)", color: "#00C4CC", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
        ✦ Componi carosello su Canva ({(initialSlides || []).length} slide)
      </button>

      {open && createPortal(
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 560, background: "#0C0C0C", border: "1px solid #1E1E1E", borderRadius: 20, padding: 22, fontFamily: "'Space Grotesk', sans-serif", color: "#F0EBE3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "#00C4CC", fontWeight: 600 }}>✦ Componi carosello</div>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: "#3A3A3A", marginBottom: 16 }}>{pages.length} pagine · max {CAROUSEL_MAX_PAGES}. Riordina, cambia foto, aggiungi pagine.</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {pages.map((row, i) => (
                <div key={i} style={{ border: "1px solid #1E1E1E", borderRadius: 12, padding: 12, background: "#0E0E0E" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#8B7355", letterSpacing: "0.08em" }}>
                      PAGINA {i + 1}{row.from_design ? " · da design creato" : ""}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={miniBtn}>↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === pages.length - 1} style={miniBtn}>↓</button>
                      <button type="button" onClick={() => removeRow(i)} style={{ ...miniBtn, color: "#B06060", borderColor: "#3A2020" }}>✕</button>
                    </div>
                  </div>
                  <textarea value={row.caption} onChange={e => patch(i, "caption", e.target.value)} rows={2} placeholder="Testo della slide…"
                    style={{ width: "100%", background: "#141414", border: "1px solid #222", borderRadius: 10, padding: "7px 10px", color: "#F0EBE3", fontSize: 12.5, fontFamily: "'Space Grotesk', sans-serif", resize: "none", marginBottom: 6 }} />
                  <input value={row.search_query} onChange={e => patch(i, "search_query", e.target.value)} placeholder="Query foto (EN, max 3 parole)"
                    style={{ width: "100%", background: "#141414", border: "1px solid #222", borderRadius: 10, padding: "6px 10px", color: "#F0EBE3", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 8 }} />
                  <RowImagePicker query={row.search_query} imageUrl={row.image_url} onPick={u => patch(i, "image_url", u)} />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button type="button" onClick={addBlank} disabled={pages.length >= CAROUSEL_MAX_PAGES}
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #2A2A2A", background: "transparent", color: "#A0988E", fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", opacity: pages.length >= CAROUSEL_MAX_PAGES ? 0.4 : 1 }}>
                + Pagina vuota
              </button>
              <button type="button" onClick={openDesignPicker} disabled={pages.length >= CAROUSEL_MAX_PAGES}
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #2A2A2A", background: "transparent", color: "#A0988E", fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", opacity: pages.length >= CAROUSEL_MAX_PAGES ? 0.4 : 1 }}>
                + Da design creato
              </button>
            </div>

            {pickerOpen && (
              <div style={{ border: "1px solid #1E1E1E", borderRadius: 12, padding: 10, marginBottom: 14, maxHeight: 220, overflowY: "auto" }}>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Design creati dall'app</div>
                {savedDesigns === null && <div style={{ fontSize: 11, color: "#555" }}>Carico…</div>}
                {savedDesigns && !savedDesigns.length && <div style={{ fontSize: 11, color: "#555" }}>Nessun design ancora creato.</div>}
                {(savedDesigns || []).map(d => (
                  <button key={d.id} type="button" onClick={() => addFromDesign(d)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: 7, borderRadius: 8, border: "1px solid transparent", background: "transparent", cursor: "pointer", color: "#D0C8C0" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 6, overflow: "hidden", background: "#141414", flexShrink: 0 }}>
                      {d.thumb_url && <img src={d.thumb_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title || "Design"}</div>
                      <div style={{ fontSize: 9, color: "#555" }}>{d.kind === "carousel" ? "Carosello" : d.format || "design"} · {new Date(d.created_at + "Z").toLocaleDateString("it-IT")}</div>
                    </div>
                    <span style={{ fontSize: 10, color: "#00C4CC" }}>+ aggiungi</span>
                  </button>
                ))}
              </div>
            )}

            {errMsg && <div style={{ padding: "9px 12px", borderRadius: 12, background: "rgba(180,60,60,0.1)", border: "1px solid rgba(180,60,60,0.2)", color: "#E47070", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>{errMsg}</div>}

            {state === "done" && url ? (
              <a href={url} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", padding: "12px", borderRadius: 12, textAlign: "center", textDecoration: "none", border: "1px solid rgba(90,186,90,0.35)", background: "rgba(90,186,90,0.1)", color: "#5ABA5A", fontSize: 13, fontWeight: 700 }}>
                ✓ Apri carosello in Canva →
              </a>
            ) : (
              <button onClick={handleCreate} disabled={state === "loading" || !pages.length}
                style={{ width: "100%", padding: "12px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: state === "loading" || !pages.length ? "not-allowed" : "pointer", border: "1px solid #00C4CC45", background: "rgba(0,196,204,0.12)", color: "#00C4CC", fontFamily: "'Space Grotesk', sans-serif", opacity: state === "loading" || !pages.length ? 0.5 : 1 }}>
                {state === "loading" ? "⏳ Compongo il carosello…" : `✦ Crea carosello (${pages.length} pagine)`}
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const miniBtn = {
  width: 24, height: 24, borderRadius: 7, border: "1px solid #262626", background: "#0C0C0C",
  color: "#888", fontSize: 11, cursor: "pointer", lineHeight: 1, padding: 0, fontFamily: "'Space Grotesk', sans-serif",
};

function QueryCard({ query, orientation, sourceKey, onImagesFetched, images }) {
  const src = PHOTO_SOURCES[sourceKey];
  const url = src.webUrl(query, orientation);
  const canFetch = src.apiUrl && API_KEYS[sourceKey];
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [noResults, setNoResults] = useState(false);

  // Anteprima automatica appena la card compare (o quando si cambia fonte
  // foto) — non serve più cliccare "Anteprima" per vedere le immagini.
  useEffect(() => {
    if (!canFetch || images) return;
    let active = true;
    setLoading(true);
    setNoResults(false);
    fetchImages(query, orientation, sourceKey).then(outcome => {
      if (!active) return;
      if (outcome) onImagesFetched(query, outcome);
      else setNoResults(true);
      setLoading(false);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sourceKey, canFetch]);

  const handleToggle = (e) => {
    e.preventDefault();
    setExpanded(v => !v);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(139,115,85,0.06)", borderRadius: 14, textDecoration: "none", color: "#3D3225", border: "1px solid rgba(139,115,85,0.12)", fontSize: 13 }}>
          <span style={{ width: 24, height: 24, borderRadius: 9, background: src.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{src.icon}</span>
          <span style={{ fontStyle: "italic", opacity: 0.85 }}>"{query}"</span>
          <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.4 }}>↗</span>
        </a>
        {canFetch && (
          <button onClick={handleToggle}
            style={{ padding: "8px 12px", borderRadius: 12, border: "1px solid rgba(139,115,85,0.2)", background: expanded ? "rgba(139,115,85,0.1)" : "transparent", color: "#8B7355", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>
            {loading ? "..." : expanded ? "Nascondi" : "Mostra"}
          </button>
        )}
      </div>
      {expanded && images?.queryUsed && images.queryUsed !== query && (
        <div style={{ fontSize: 10, color: "#B46432", fontStyle: "italic", marginTop: 6, paddingLeft: 4 }}>
          Nessun risultato per "{query}" — risultati mostrati per "{images.queryUsed}"
        </div>
      )}
      {expanded && images && <ImageGrid images={images.results} />}
      {expanded && noResults && (
        <div style={{ fontSize: 11, color: "#999", fontStyle: "italic", marginTop: 8, paddingLeft: 4 }}>
          Nessun risultato trovato, nemmeno con una query più generica. Prova un'altra fonte foto.
        </div>
      )}
    </div>
  );
}

function VideoQueryCard({ query, sourceKey }) {
  const [videos, setVideos] = useState(null);
  const [loading, setLoading] = useState(false);
  const src = VIDEO_SOURCES[sourceKey];
  const apiKeyKey = sourceKey.split("_")[0];
  const canFetch = src?.apiUrl && API_KEYS[apiKeyKey];

  // Stessa logica/pattern di SceneVideoPlayer (tab Video): anteprima automatica
  // invece di solo un link, così anche i video_queries in Strategia si vedono.
  useEffect(() => {
    if (!query || !canFetch) { setVideos(null); return; }
    let active = true;
    setLoading(true);
    fetchVideos(query, sourceKey).then(res => {
      if (active) { setVideos(res); setLoading(false); }
    });
    return () => { active = false; };
  }, [query, sourceKey, canFetch]);

  return (
    <div>
      <a href={src.webUrl(query)} target="_blank" rel="noopener noreferrer"
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(26,26,46,0.05)", borderRadius: 14, textDecoration: "none", color: "#3D3225", border: "1px solid rgba(26,26,46,0.1)", fontSize: 13 }}>
        <span style={{ width: 24, height: 24, borderRadius: 9, background: src.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{src.icon}</span>
        <span style={{ fontStyle: "italic", opacity: 0.85 }}>"{query}"</span>
        <span style={{ marginLeft: "auto", fontSize: 14, opacity: 0.4 }}>▶</span>
      </a>
      {canFetch && (
        loading ? (
          <div style={{ fontSize: 10, color: "#999", fontStyle: "italic", marginTop: 8 }}>Cerco footage "{query}"...</div>
        ) : videos && videos.length > 0 ? (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 8, paddingBottom: 2 }}>
            {videos.slice(0, 3).map(v => (
              <div key={v.id} style={{ width: 110, flexShrink: 0, borderRadius: 12, overflow: "hidden", background: "#000", position: "relative", aspectRatio: "9/16" }}>
                <video src={v.videoUrl} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                <a href={v.link} target="_blank" rel="noopener noreferrer" style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, background: "rgba(0,0,0,0.5)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", textDecoration: "none", fontSize: 10 }}>↗</a>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "#999", marginTop: 8 }}>Nessun video trovato</div>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// TAB: STRATEGIA
// ─────────────────────────────────────────────────
function StrategyTab({ data, selectedSource, setSelectedSource, imageCache, onImagesFetched }) {
  const { strategy, direction, queries, video_queries, orientation, mood_tags } = data;
  const [selectedVideoSource, setSelectedVideoSource] = useState("pexels_video");

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <span style={{ display: "inline-block", padding: "5px 14px", borderRadius: 20, background: "linear-gradient(135deg, #8B7355, #A69070)", color: "#FFF", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          ◈ {strategy.emotion}
        </span>
        {strategy.framework && (
          <span title="Architettura del carosello (framework di marketing applicato)" style={{ display: "inline-block", padding: "5px 12px", borderRadius: 20, border: "1px solid rgba(139,115,85,0.35)", color: "#8B7355", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            ⚙ {strategy.framework}
          </span>
        )}
      </div>

      <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#3D3225", margin: "0 0 16px" }}>{strategy.narrative}</p>

      <div style={{ marginBottom: 16 }}>
        <SectionLabel>Palette Cromatica</SectionLabel>
        <PaletteStrip hex={strategy.palette_hex} names={strategy.palette} />
      </div>

      <div style={{ background: "rgba(139,115,85,0.05)", borderRadius: 16, padding: "14px 16px", marginBottom: 18, borderLeft: "3px solid #8B7355" }}>
        <SectionLabel>Direzione Artistica</SectionLabel>
        <div style={{ fontSize: 13, color: "#3D3225", lineHeight: 1.6 }}>
          <strong>Stile:</strong> {direction.style}<br />
          <strong>Composizione:</strong> {direction.composition}<br />
          <strong>Luce:</strong> {direction.lighting}
        </div>
      </div>

      {mood_tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {mood_tags.map((t, i) => <span key={i} style={{ display: "inline-block", padding: "4px 12px", borderRadius: 20, background: "rgba(139,115,85,0.1)", color: "#6B5B45", fontSize: 11, fontWeight: 500, textTransform: "lowercase" }}>#{t}</span>)}
        </div>
      )}

      <SectionLabel>Cerca Foto su</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {Object.entries(PHOTO_SOURCES).map(([key, src]) => (
          <button key={key} onClick={() => setSelectedSource(key)}
            style={{ padding: "6px 16px", borderRadius: 12, border: selectedSource === key ? "2px solid #8B7355" : "2px solid rgba(139,115,85,0.15)", background: selectedSource === key ? "rgba(139,115,85,0.12)" : "transparent", color: selectedSource === key ? "#3D3225" : "#8B7355", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {src.name} {API_KEYS[key] ? "●" : ""}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <SectionLabel>Query Primarie</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queries.primary.map((q, i) => <QueryCard key={i} query={q} orientation={orientation} sourceKey={selectedSource} images={imageCache[`${selectedSource}:${q}`]} onImagesFetched={(query, imgs) => onImagesFetched(`${selectedSource}:${query}`, imgs)} />)}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <SectionLabel>Query Secondarie</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queries.secondary.map((q, i) => <QueryCard key={i} query={q} orientation={orientation} sourceKey={selectedSource} images={imageCache[`${selectedSource}:${q}`]} onImagesFetched={(query, imgs) => onImagesFetched(`${selectedSource}:${query}`, imgs)} />)}
        </div>
      </div>

      <div style={{ padding: "10px 14px", background: "rgba(180,60,60,0.06)", borderRadius: 14, border: "1px solid rgba(180,60,60,0.12)", marginBottom: 18 }}>
        <SectionLabel color="#B43C3C">✕ Evita queste query</SectionLabel>
        {queries.avoid.map((q, i) => <div key={i} style={{ fontSize: 12, color: "#8B5A5A", fontStyle: "italic", padding: "2px 0" }}>"{q}"</div>)}
      </div>

      {video_queries?.primary && (
        <div style={{ padding: "18px", background: "linear-gradient(135deg, rgba(26,26,46,0.04), rgba(26,26,46,0.08))", borderRadius: 18, border: "1px solid rgba(26,26,46,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 28, height: 28, borderRadius: 12, background: "linear-gradient(135deg, #1A1A2E, #2D2D4A)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>▶</span>
            <SectionLabel color="#1A1A2E">Video & Footage</SectionLabel>
          </div>
          {video_queries.style_notes && <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#3D3225", margin: "0 0 14px", fontStyle: "italic", padding: "8px 12px", background: "rgba(255,255,255,0.5)", borderRadius: 12, borderLeft: "3px solid #1A1A2E" }}>{video_queries.style_notes}</p>}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {Object.entries(VIDEO_SOURCES).map(([key, src]) => (
              <button key={key} onClick={() => setSelectedVideoSource(key)}
                style={{ padding: "5px 14px", borderRadius: 12, border: selectedVideoSource === key ? "2px solid #1A1A2E" : "2px solid rgba(26,26,46,0.12)", background: selectedVideoSource === key ? "rgba(26,26,46,0.1)" : "transparent", color: selectedVideoSource === key ? "#1A1A2E" : "#666", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {src.name}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {video_queries.primary.map((q, i) => <VideoQueryCard key={i} query={q} sourceKey={selectedVideoSource} />)}
          </div>
          {video_queries.secondary?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {video_queries.secondary.map((q, i) => <VideoQueryCard key={i} query={q} sourceKey={selectedVideoSource} />)}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: "#8B7355", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{orientation === "portrait" ? "▯" : orientation === "landscape" ? "▭" : "□"}</span>
        Orientamento: <strong style={{ textTransform: "capitalize" }}>{orientation}</strong>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// TAB: POST COMPOSER
// ─────────────────────────────────────────────────
const REGEN_SLIDE_PROMPT = (slide, originalBrief) => `You previously generated a post_composer slide for a marketing campaign. The user wants a NEW version of this specific slide. Keep the same slide_number but generate completely different content.

Generate the slide with:
- hook_type: one of Curiosity|Story|Value|Contrarian — pick a DIFFERENT one than the current slide
- captions: object with "it", "en", "es" keys (each a native-feeling caption, not translations). Open with a hook of hook_type; follow PAS, AIDA or BAB — lead with tension or benefit, never a flat description
- hashtags_instagram: array of exactly 10 hashtags (3 broad, 4 mid-range niche, 3 micro-niche)
- hashtags_facebook: array of exactly 3 broad hashtags
- cta: object with "it", "en", "es" keys — one concrete action, one ethical persuasion lever, no fake scarcity
- visual_description, search_query, platform_tip

Original campaign brief: "${originalBrief}"

Current slide to regenerate:
${JSON.stringify(slide, null, 2)}

Respond ONLY with a single JSON object (the new slide). No markdown fences, no preamble.`;

function SlideSearchLinks({ query, orientation, instagramHashtag }) {
  if (!query) return null;
  const photoKeys = Object.keys(PHOTO_SOURCES);
  const sources = photoKeys.map(k => ({ key: k, ...PHOTO_SOURCES[k] }));
  const igHashtag = instagramHashtag?.replace(/^#/, "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {sources.filter(s => s.key !== "instagram").map(src => (
          <a key={src.key} href={src.webUrl(query, orientation)} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 9, border: "1px solid rgba(139,115,85,0.15)", textDecoration: "none", fontSize: 9, color: "#8B7355", fontFamily: "'JetBrains Mono', monospace", transition: "all 0.15s", background: "transparent" }}
            onMouseEnter={e => { e.currentTarget.style.background = src.color; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = src.color; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8B7355"; e.currentTarget.style.borderColor = "rgba(139,115,85,0.15)"; }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: src.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, flexShrink: 0 }}>{src.icon}</span>
            {src.name}
          </a>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <a href={PHOTO_SOURCES.instagram.webUrl(query)} target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 9, border: "1px solid rgba(225,48,108,0.25)", textDecoration: "none", fontSize: 9, color: "#E1306C", fontFamily: "'JetBrains Mono', monospace", background: "rgba(225,48,108,0.05)" }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: "#E1306C", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6, fontWeight: 700, flexShrink: 0 }}>IG</span>
          Instagram (ispirazione)
        </a>
        {igHashtag && (
          <a href={`https://www.instagram.com/explore/tags/${encodeURIComponent(igHashtag)}/`} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 9, border: "1px solid rgba(225,48,108,0.25)", textDecoration: "none", fontSize: 9, color: "#E1306C", fontFamily: "'JetBrains Mono', monospace", background: "rgba(225,48,108,0.05)" }}>
            #{igHashtag}
          </a>
        )}
      </div>
    </div>
  );
}

// Prima fonte foto con una chiave API configurata — per l'anteprima automatica
// nel tab Post non serve uno switcher, basta mostrare subito qualcosa di reale.
function defaultPhotoSource() {
  return Object.keys(PHOTO_SOURCES).find(k => PHOTO_SOURCES[k].apiUrl && API_KEYS[k]) || null;
}

function SlidePreviewImages({ query, orientation, sourceKey }) {
  const src = PHOTO_SOURCES[sourceKey];
  const canFetch = src?.apiUrl && API_KEYS[sourceKey];
  const [outcome, setOutcome] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || !canFetch) { setOutcome(null); return; }
    let active = true;
    setLoading(true);
    fetchImages(query, orientation, sourceKey).then(o => { if (active) { setOutcome(o); setLoading(false); } });
    return () => { active = false; };
  }, [query, orientation, sourceKey, canFetch]);

  // Pinterest/Instagram non hanno un'API di ricerca pubblica (solo link,
  // vedi PHOTO_SOURCES) — niente anteprima inline per quelle, resta il link
  // già mostrato sopra in SlideSearchLinks.
  if (!canFetch) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {loading ? (
        <div style={{ fontSize: 10, color: "#999", fontStyle: "italic" }}>Cerco immagini per "{query}" su {src.name}...</div>
      ) : outcome?.results?.length ? (
        <ImageGrid images={outcome.results.slice(0, 3)} />
      ) : (
        <div style={{ fontSize: 10, color: "#999", fontStyle: "italic" }}>Nessuna immagine trovata per "{query}" su {src.name}</div>
      )}
    </div>
  );
}

function PostsTab({ data, onRegenSlide, regenLoading, brand }) {
  const { post_composer, orientation } = data;
  const [lang, setLang] = useState("it");
  const [platform, setPlatform] = useState("instagram");
  const [selectedSource, setSelectedSource] = useState(() => defaultPhotoSource() || "unsplash");

  if (!post_composer?.length) return <p style={{ color: "#8B7355", fontSize: 13 }}>Nessun post generato.</p>;

  const LANGS = [
    { id: "it", label: "Italiano", flag: "🇮🇹" },
    { id: "en", label: "English", flag: "🇬🇧" },
    { id: "es", label: "Español", flag: "🇪🇸" },
  ];

  const PLATFORMS = [
    { id: "instagram", label: "Instagram", color: "#E1306C", icon: "IG" },
    { id: "facebook", label: "Facebook", color: "#1877F2", icon: "FB" },
  ];

  const getCaption = (post) => {
    if (post.captions && typeof post.captions === "object") return post.captions[lang] || post.captions.it || post.captions.en || "";
    return post.caption || "";
  };

  const getCta = (post) => {
    if (post.cta && typeof post.cta === "object") return post.cta[lang] || post.cta.it || post.cta.en || "";
    return post.cta || "";
  };

  const getHashtags = (post) => {
    if (platform === "instagram" && post.hashtags_instagram?.length) return post.hashtags_instagram;
    if (platform === "facebook" && post.hashtags_facebook?.length) return post.hashtags_facebook;
    return post.hashtags || [];
  };

  const getCopyText = (post) => {
    const cap = getCaption(post);
    const tags = getHashtags(post).map(h => `#${h.replace(/^#/, "")}`).join(" ");
    const cta = getCta(post);
    return `${cap}\n\n${tags}${cta ? `\n\n${cta}` : ""}`;
  };

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 28, height: 28, borderRadius: 12, background: "linear-gradient(135deg, #E1306C, #F77737)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>◻</span>
        <SectionLabel>Post Composer — {post_composer.length} Slide</SectionLabel>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8B7355", marginBottom: 6 }}>Anteprime foto da</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(PHOTO_SOURCES).map(([key, src]) => (
            <button key={key} onClick={() => setSelectedSource(key)}
              style={{ padding: "5px 14px", borderRadius: 12, border: selectedSource === key ? "2px solid #8B7355" : "2px solid rgba(139,115,85,0.15)", background: selectedSource === key ? "rgba(139,115,85,0.12)" : "transparent", color: selectedSource === key ? "#3D3225" : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {src.name} {API_KEYS[key] ? "●" : ""}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "rgba(139,115,85,0.06)", borderRadius: 14 }}>
          {LANGS.map(l => (
            <button key={l.id} onClick={() => setLang(l.id)}
              style={{ padding: "5px 12px", borderRadius: 10, border: "none", background: lang === l.id ? "#FBF8F3" : "transparent", boxShadow: lang === l.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: lang === l.id ? "#2C2418" : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif" }}>
              {l.flag} {l.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4, padding: 3, background: "rgba(139,115,85,0.06)", borderRadius: 14 }}>
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => setPlatform(p.id)}
              style={{ padding: "5px 12px", borderRadius: 10, border: "none", background: platform === p.id ? "#FBF8F3" : "transparent", boxShadow: platform === p.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: platform === p.id ? p.color : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif" }}>
              {p.icon} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10, color: "#999", marginBottom: 14, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
        {platform === "instagram" ? (
          <span>IG: 10 hashtag per slide — 3 broad + 4 niche + 3 micro-niche</span>
        ) : (
          <span>FB: 3 hashtag per slide — solo broad e ricercabili</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {post_composer.map((post, i) => {
          const caption = getCaption(post);
          const cta = getCta(post);
          const hashtags = getHashtags(post);

          return (
            <div key={`${i}-${lang}-${platform}`} style={{ background: "#FBF8F3", border: "1px solid rgba(139,115,85,0.12)", borderRadius: 18, overflow: "hidden", transition: "all 0.3s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(139,115,85,0.08)", background: "rgba(139,115,85,0.03)" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #8B7355, #A69070)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{post.slide_number}</span>
                <span style={{ fontSize: 10, color: "#8B7355", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Slide {post.slide_number}</span>
                {post.slide_number === 1 && (
                  <span style={{ fontSize: 9, color: "#A67C3D", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 6, background: "rgba(166,124,61,0.12)" }}>Copertina</span>
                )}
                {post.hook_type && (
                  <span title="Tipo di hook (prima riga)" style={{ fontSize: 9, color: "#7C6A9B", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 6, background: "rgba(124,106,155,0.12)" }}>hook: {post.hook_type}</span>
                )}
              </div>

              {post.search_query && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(139,115,85,0.06)", background: "rgba(139,115,85,0.02)" }}>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8B7355", marginBottom: 6, opacity: 0.7 }}>
                    Cerca "{post.search_query}" su:
                  </div>
                  <SlideSearchLinks query={post.search_query} orientation={orientation} instagramHashtag={post.instagram_hashtag} />
                  <SlidePreviewImages query={post.search_query} orientation={orientation} sourceKey={selectedSource} />
                </div>
              )}

              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#6B5B45", fontStyle: "italic", marginBottom: 12, padding: "8px 12px", background: "rgba(139,115,85,0.04)", borderRadius: 12, borderLeft: "3px solid rgba(139,115,85,0.2)", lineHeight: 1.55 }}>
                  📷 {post.visual_description}
                </div>

                <div style={{ fontSize: 13.5, color: "#2C2418", lineHeight: 1.65, marginBottom: 12, whiteSpace: "pre-line" }}>
                  {caption}
                </div>

                {hashtags.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: platform === "instagram" ? "rgba(225,48,108,0.1)" : "rgba(24,119,242,0.1)", color: platform === "instagram" ? "#E1306C" : "#1877F2", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                        {platform === "instagram" ? "IG" : "FB"} × {hashtags.length}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {hashtags.map((h, j) => (
                        <span key={j} style={{ fontSize: 11, color: platform === "instagram" ? "#4A7C9B" : "#1877F2", fontWeight: 500 }}>#{h.replace(/^#/, "")}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                  {cta && <span style={{ fontSize: 11, fontWeight: 600, color: "#8B7355", padding: "4px 10px", borderRadius: 9, background: "rgba(139,115,85,0.08)" }}>CTA: {cta}</span>}
                  {post.platform_tip && <span style={{ fontSize: 10, color: "#999", fontStyle: "italic", maxWidth: 220 }}>💡 {post.platform_tip}</span>}
                </div>
              </div>

              <div style={{ padding: "8px 16px 10px", borderTop: "1px solid rgba(139,115,85,0.08)", background: "rgba(139,115,85,0.02)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <CopyButton text={getCopyText(post)} label={`Copia ${platform === "instagram" ? "IG" : "FB"} Caption + Hashtag`} />
                </div>
                <CanvaDesignButton caption={getCaption(post)} cta={cta} query={post.search_query || ""} orientation={orientation} canvaTemplates={brand?.canvaTemplates} projectId={brand?.id} />
                <button onClick={() => onRegenSlide(i, post)} disabled={regenLoading === i}
                  style={{ padding: "7px 14px", borderRadius: 12, border: "1px solid rgba(180,100,50,0.2)", background: regenLoading === i ? "rgba(180,100,50,0.1)" : "transparent", color: "#B46432", fontSize: 11, fontWeight: 600, cursor: regenLoading === i ? "not-allowed" : "pointer", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap" }}>
                  {regenLoading === i ? "⟳ Rigenero..." : "⟳ Riformula"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <CopyButton text={post_composer.map(p => `--- SLIDE ${p.slide_number} ---\n${getCaption(p)}\n\n${getHashtags(p).map(h => `#${h.replace(/^#/, "")}`).join(" ")}\n\nCTA: ${getCta(p)}`).join("\n\n")} label={`Copia Tutte (${LANGS.find(l=>l.id===lang)?.flag} ${platform === "instagram" ? "IG" : "FB"})`} />
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
        <CarouselComposer
          initialSlides={post_composer.map(p => ({ caption: getCaption(p), search_query: p.search_query || "" }))}
          canvaTemplates={brand?.canvaTemplates}
          projectId={brand?.id}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// TAB: VIDEO STORYTELLING
// ─────────────────────────────────────────────────
function SceneVideoPlayer({ query, sourceKey }) {
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

  if (!canFetch) {
    return (
      <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {Object.entries(VIDEO_SOURCES).map(([key, s]) => (
          <a key={key} href={s.webUrl(query)} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 9, border: "1px solid rgba(26,26,46,0.12)", textDecoration: "none", fontSize: 9, color: sourceKey === key ? "#fff" : "#666", background: sourceKey === key ? s.color : "transparent", fontFamily: "'JetBrains Mono', monospace" }}>{s.name}</a>
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      {loading ? (
        <div style={{ fontSize: 10, color: "#999", fontStyle: "italic" }}>Cerco footage "{query}" su {src.name}...</div>
      ) : videos && videos.length > 0 ? (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {videos.slice(0,3).map(v => (
            <div key={v.id} style={{ width: 140, flexShrink: 0, borderRadius: 12, overflow: "hidden", background: "#000", position: "relative", aspectRatio: "9/16" }}>
              <video src={v.videoUrl} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 6px 4px", background: "linear-gradient(transparent, rgba(0,0,0,0.8))", fontSize: 8, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>{v.author || "Creator"}</div>
              <a href={v.link} target="_blank" rel="noopener noreferrer" style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, background: "rgba(0,0,0,0.5)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", textDecoration: "none", fontSize: 12 }}>↗</a>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#999" }}>Nessun video trovato per "{query}"</div>
      )}
    </div>
  );
}

function VideoTab({ data }) {
  const vs = data.video_storytelling;
  const [lang, setLang] = useState("it");
  const [videoSource, setVideoSource] = useState("pexels_video");

  if (!vs?.scenes) return <p style={{ color: "#8B7355", fontSize: 13 }}>Nessuno storyboard generato.</p>;

  const LANGS = [
    { id: "it", label: "Italiano", flag: "🇮🇹" },
    { id: "en", label: "English", flag: "🇬🇧" },
    { id: "es", label: "Español", flag: "🇪🇸" },
  ];

  const ml = (field) => {
    if (!field) return "";
    if (typeof field === "object") return field[lang] || field.it || field.en || "";
    return field;
  };

  const getCopyText = () => {
    return `VIDEO STORYBOARD\n${ml(vs.concept)}\nDurata: ${vs.duration} | Aspect: ${vs.aspect_ratio}\nMusica: ${vs.music_mood}\n\n${vs.scenes.map(s => `SC.${String(s.scene_number).padStart(2, "0")} [${s.duration}] ${s.footage_type}\n${ml(s.description)}${ml(s.text_overlay) ? `\nOverlay: "${ml(s.text_overlay)}"` : ""}\nFootage: "${s.search_query}"\n→ ${s.transition}`).join("\n\n")}\n\n🎵 ${ml(vs.audio_notes)}`;
  };

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 28, height: 28, borderRadius: 12, background: "linear-gradient(135deg, #1A1A2E, #4A1942)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🎬</span>
        <SectionLabel color="#1A1A2E">Video Storytelling</SectionLabel>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "rgba(26,26,46,0.06)", borderRadius: 14 }}>
          {LANGS.map(l => (
            <button key={l.id} onClick={() => setLang(l.id)}
              style={{ padding: "5px 12px", borderRadius: 10, border: "none", background: lang === l.id ? "#FBF8F3" : "transparent", boxShadow: lang === l.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: lang === l.id ? "#2C2418" : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
              {l.flag} {l.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4, padding: 3, background: "rgba(26,26,46,0.06)", borderRadius: 14 }}>
          {Object.entries(VIDEO_SOURCES).map(([key, src]) => (
            <button key={key} onClick={() => setVideoSource(key)}
              style={{ padding: "5px 12px", borderRadius: 10, border: "none", background: videoSource === key ? "#FBF8F3" : "transparent", boxShadow: videoSource === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: videoSource === key ? src.color : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
              {src.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {[{ l: "Durata", v: vs.duration }, { l: "Aspect", v: vs.aspect_ratio }, { l: "Musica", v: vs.music_mood }].filter(m => m.v).map((m, i) => (
          <div key={i} style={{ padding: "6px 12px", borderRadius: 12, background: "rgba(26,26,46,0.06)", border: "1px solid rgba(26,26,46,0.08)", fontSize: 11, color: "#3D3225" }}>
            <span style={{ fontWeight: 700, opacity: 0.5, marginRight: 4 }}>{m.l}:</span>{m.v}
          </div>
        ))}
      </div>

      {vs.concept && <p style={{ fontSize: 13, lineHeight: 1.6, color: "#3D3225", margin: "0 0 18px", padding: "10px 14px", background: "rgba(26,26,46,0.04)", borderRadius: 14, borderLeft: "3px solid #1A1A2E", fontStyle: "italic" }}>{ml(vs.concept)}</p>}

      <div style={{ position: "relative", paddingLeft: 22 }}>
        <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, width: 2, background: "linear-gradient(to bottom, #1A1A2E, rgba(26,26,46,0.1))", borderRadius: 1 }} />
        {vs.scenes.map((s, i) => (
          <div key={i} style={{ position: "relative", marginBottom: i < vs.scenes.length - 1 ? 16 : 0, paddingLeft: 18 }}>
            <div style={{ position: "absolute", left: -6, top: 12, width: 10, height: 10, borderRadius: "50%", background: i === 0 ? "#E1306C" : i === vs.scenes.length - 1 ? "#1A1A2E" : "#8B7355", border: "2px solid #F5F0E8" }} />
            <div style={{ background: "#FBF8F3", border: "1px solid rgba(26,26,46,0.08)", borderRadius: 16, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1A1A2E", fontFamily: "'JetBrains Mono', monospace" }}>SC.{String(s.scene_number).padStart(2, "0")}</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "rgba(26,26,46,0.06)", color: "#666", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{s.duration}</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "rgba(139,115,85,0.08)", color: "#8B7355", textTransform: "uppercase", fontWeight: 600 }}>{s.footage_type}</span>
                {s.transition && <span style={{ marginLeft: "auto", fontSize: 9, color: "#999", fontFamily: "'JetBrains Mono', monospace" }}>→ {s.transition}</span>}
              </div>

              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#3D3225", margin: "0 0 8px" }}>{ml(s.description)}</p>

              {ml(s.text_overlay) && (
                <div style={{ display: "inline-block", padding: "5px 12px", borderRadius: 9, background: "#1A1A2E", color: "#F0E8D8", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                  {ml(s.text_overlay)}
                </div>
              )}

              {s.search_query && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#1A1A2E", marginBottom: 5, opacity: 0.5 }}>
                    Footage: "{s.search_query}"
                  </div>
                  <SceneVideoPlayer query={s.search_query} sourceKey={videoSource} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {vs.audio_notes && (
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 14, background: "rgba(26,26,46,0.04)", border: "1px solid rgba(26,26,46,0.08)", fontSize: 12, color: "#3D3225", lineHeight: 1.55 }}>
          <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A1A2E", display: "block", marginBottom: 4 }}>🎵 Sound Design</span>
          {ml(vs.audio_notes)}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <CopyButton text={getCopyText()} label={`Copia Storyboard (${LANGS.find(l=>l.id===lang)?.flag})`} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// TAB: PIANO EDITORIALE
// ─────────────────────────────────────────────────
function EditorialTab({ data }) {
  const plan = data.editorial_plan;
  if (!plan?.days) return <p style={{ color: "#8B7355", fontSize: 13 }}>Nessuna pianificazione generata.</p>;

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 28, height: 28, borderRadius: 12, background: "linear-gradient(135deg, #8B7355, #6B5B45)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📅</span>
        <SectionLabel>Piano Editoriale Settimanale</SectionLabel>
      </div>

      <div style={{ background: "rgba(139,115,85,0.05)", borderRadius: 16, padding: "12px 16px", marginBottom: 18, borderLeft: "3px solid #8B7355" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8B7355", marginBottom: 4 }}>Focus Strategico</div>
            <div style={{ fontSize: 13.5, color: "#3D3225", fontWeight: 500 }}>{plan.weekly_focus}</div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, background: "rgba(139,115,85,0.1)", padding: "3px 8px", borderRadius: 6, color: "#8B7355" }}>
            DURATA: {plan.duration_context || "1 Settimana"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {plan.days.map((d, i) => (
          <div key={i} style={{ background: "#FBF8F3", border: "1px solid rgba(139,115,85,0.12)", borderRadius: 16, padding: "12px 14px", display: "flex", gap: 14 }}>
            <div style={{ width: 45, textAlign: "center", borderRight: "1px solid rgba(139,115,85,0.1)", paddingRight: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: "#8B7355", fontWeight: 700, textTransform: "uppercase" }}>{d.day?.includes("Settimana") ? "WP" : d.day?.substring(0, 3)}</div>
              <div style={{ fontSize: 16, fontWeight: 400, color: "#2C2418", fontFamily: "'Space Grotesk', sans-serif" }}>{i + 1}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: d.content_type?.toLowerCase().includes("reel") ? "rgba(225,48,108,0.1)" : "rgba(139,115,85,0.1)", color: d.content_type?.toLowerCase().includes("reel") ? "#E1306C" : "#8B7355", fontWeight: 700 }}>{d.content_type}</span>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: "rgba(60,100,180,0.1)", color: "#3C64B4", fontWeight: 700 }}>{d.best_time}</span>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: "rgba(180,60,60,0.1)", color: "#B43C3C", fontWeight: 700 }}>{d.goal}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#2C2418", marginBottom: 4 }}>{d.topic}</div>
              {d.story_reel_hint && (
                <div style={{ fontSize: 11, background: "rgba(0,0,0,0.03)", padding: "6px 10px", borderRadius: 12, margin: "6px 0", color: "#6B5B45", borderLeft: "2px solid #E1306C" }}>
                  <span style={{ fontWeight: 700, fontSize: 9, display: "block", marginBottom: 2 }}>⚡ SUGGERIMENTO ECOISTEMA (Reel/Story):</span>
                  {d.story_reel_hint}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#8B7355", fontStyle: "italic", borderTop: "1px solid rgba(139,115,85,0.05)", paddingTop: 6, marginTop: 4 }}>
                <span style={{ fontWeight: 700, marginRight: 4 }}>FB Tip:</span>{d.fb_cross_post_tip}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// STRATEGY MESSAGE (MAIN WRAPPER)
// ─────────────────────────────────────────────────
function StrategyMessage({ data, onUpdateData, originalBrief, brand }) {
  const [activeTab, setActiveTab] = useState("strategy");
  const [selectedSource, setSelectedSource] = useState("unsplash");
  const [imageCache, setImageCache] = useState({});
  const [regenLoading, setRegenLoading] = useState(null);
  const onImagesFetched = useCallback((key, imgs) => setImageCache(prev => ({ ...prev, [key]: imgs })), []);

  const handleRegenSlide = async (index, slide) => {
    setRegenLoading(index);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: "You are a creative marketing copywriter. Generate a single post_composer slide as a JSON object. Respond ONLY with the JSON object, no markdown fences.",
          messages: [{ role: "user", content: REGEN_SLIDE_PROMPT(slide, originalBrief || "") }],
        }),
      });
      const result = await res.json();
      const raw = result.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("");
      if (raw) {
        const newSlide = parseJsonResponse(raw);
        newSlide.slide_number = slide.slide_number;
        const updated = { ...data };
        updated.post_composer = [...data.post_composer];
        updated.post_composer[index] = newSlide;
        onUpdateData(updated);
      }
    } catch (err) {
      console.error("Regen failed:", err);
    } finally {
      setRegenLoading(null);
    }
  };

  const tabs = [
    { id: "strategy", label: "Strategia", icon: "◈" },
    { id: "piano", label: "Piano", icon: "📅", show: !!data.editorial_plan },
    { id: "posts", label: "Post", icon: "◻", show: data.post_composer?.length > 0 },
    { id: "video", label: "Video", icon: "▶", show: !!data.video_storytelling?.scenes },
  ].filter(t => t.show !== false);

  return (
    <div style={{ animation: "fadeSlideUp 0.5s ease-out" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 18, padding: 3, background: "rgba(139,115,85,0.06)", borderRadius: 16 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 13, border: "none", background: activeTab === tab.id ? "#FBF8F3" : "transparent", boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none", color: activeTab === tab.id ? "#2C2418" : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif" }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      { activeTab === "strategy" && <StrategyTab data={data} selectedSource={selectedSource} setSelectedSource={setSelectedSource} imageCache={imageCache} onImagesFetched={onImagesFetched} />}
      { activeTab === "piano" && <EditorialTab data={data} />}
      { activeTab === "posts" && <PostsTab data={data} onRegenSlide={handleRegenSlide} regenLoading={regenLoading} brand={brand} />}
      { activeTab === "video" && <VideoTab data={data} />}

      <details style={{ marginTop: 18 }}>
        <summary style={{ fontSize: 11, color: "#8B7355", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>{"{ }"} Mostra JSON per API</summary>
        <pre style={{ marginTop: 8, padding: 14, background: "#1E1B16", color: "#C4B99A", borderRadius: 14, fontSize: 10, lineHeight: 1.5, overflow: "auto", fontFamily: "'JetBrains Mono', monospace", maxHeight: 300 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────
// Salva ogni domanda/risposta AI nello storico persistente (Turso) e ne restituisce
// l'id, così il messaggio in chat può essere eliminato singolarmente in seguito.
async function saveToHistory({ project_id, type, prompt, result_json }) {
  try {
    const res = await fetch("/api/history?action=save_request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_request", project_id: project_id || null, type, prompt, result_json }),
    });
    return await res.json();
  } catch (err) {
    console.warn("[VisualMarketingScout] salvataggio storico fallito:", err.message);
    return null;
  }
}

export default function VisualMarketingScout({ brand, initialBrief, onConsumeInitialBrief }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [planConfig, setPlanConfig] = useState({ duration: "1 settimana", frequency: 3 });
  const [insights, setInsights] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const anyKey = Object.values(API_KEYS).some(k => k?.length > 5);

  const sendMessage = async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: getSystemPrompt(planConfig, brand, insights), messages: [{ role: "user", content: userMsg }] }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Il server non ha risposto correttamente (status ${res.status}). Riprova.`);
      }
      // Se Anthropic (o il proxy) risponde con un errore, "content" non esiste:
      // senza questo controllo si mostrava sempre lo stesso messaggio generico
      // "Non ho potuto elaborare la richiesta" senza mai dire perché.
      if (data.error) throw new Error(typeof data.error === "string" ? data.error : data.error.message || "Errore chiamata AI");
      const raw = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("");
      if (raw) {
        try {
          const parsed = parseJsonResponse(raw);
          const saved = await saveToHistory({ project_id: brand?.id, type: "strategy", prompt: userMsg, result_json: parsed });
          setMessages(prev => [...prev, { role: "assistant", content: parsed, type: "strategy", requestId: saved?.id ?? null }]);
        } catch { setMessages(prev => [...prev, { role: "assistant", content: raw, type: "text" }]); }
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: "Non ho potuto elaborare la richiesta. Riprova con più dettagli.", type: "text" }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Errore: ${err.message}`, type: "text" }]);
    } finally { setLoading(false); }
  };

  // Al montaggio (ogni volta che si entra nel tab, o si cambia progetto attivo)
  // recupera la cronologia salvata su DB per questo progetto e la mostra come
  // conversazione già presente in chat. Se arriva un brief da Analytics
  // (handoff "prossimo post"), lo invia solo DOPO che la cronologia è pronta,
  // altrimenti l'hydration sovrascriverebbe il messaggio appena inviato.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMessages([]);
      setInsights(null);
      if (brand?.id) {
        try {
          const [histRes, insightsRes] = await Promise.all([
            fetch(`/api/history?action=history&project_id=${encodeURIComponent(brand.id)}&type=strategy&limit=50`),
            fetch(`/api/history?action=get_insights&project_id=${encodeURIComponent(brand.id)}`),
          ]);
          const d = await histRes.json();
          const insightsData = await insightsRes.json();
          if (!cancelled && insightsData.ok) setInsights(insightsData.data);
          if (!cancelled && d.ok) {
            const rows = [...(d.data || [])].reverse();
            const hydrated = [];
            rows.forEach(row => {
              hydrated.push({ role: "user", content: row.prompt });
              try {
                hydrated.push({ role: "assistant", content: JSON.parse(row.result_json), type: "strategy", requestId: row.id });
              } catch {
                hydrated.push({ role: "assistant", content: "(risposta non disponibile)", type: "text" });
              }
            });
            setMessages(hydrated);
          }
        } catch (err) { console.warn("[VisualMarketingScout] recupero storico fallito:", err.message); }
      }
      if (!cancelled && initialBrief) {
        sendMessage(initialBrief);
        onConsumeInitialBrief?.();
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand?.id]);

  async function deleteExchange(assistantIndex) {
    const msg = messages[assistantIndex];
    if (!msg?.requestId) return;
    setMessages(prev => prev.filter((_, i) => i !== assistantIndex && i !== assistantIndex - 1));
    try {
      await fetch("/api/history?action=delete_request", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.requestId }),
      });
    } catch (err) {
      console.warn("[VisualMarketingScout] eliminazione fallita:", err.message);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D0D0D", fontFamily: "'Space Grotesk', Georgia, serif", position: "relative" }}>
      <style>{`        @keyframes typingBounce { 0%,80%,100% { transform:translateY(0);opacity:.4 } 40% { transform:translateY(-6px);opacity:1 } }
        @keyframes fadeSlideUp { from { opacity:0;transform:translateY(12px) } to { opacity:1;transform:translateY(0) } }
        .vms-input:focus { outline:none; box-shadow:0 0 0 2px rgba(139,115,85,.3) }
        .vms-input::placeholder { color:#B5A88A }
        * { box-sizing:border-box }
        ::-webkit-scrollbar { width:5px }
        ::-webkit-scrollbar-thumb { background:rgba(139,115,85,.2); border-radius:10px }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px", position: "relative", zIndex: 2, display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        <header style={{ paddingTop: 40, paddingBottom: messages.length ? 20 : 50, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "#8B7355", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>◈ Visual Marketing Scout</div>
            <button onClick={() => setShowApiSetup(!showApiSetup)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 9, border: "1px solid rgba(139,115,85,.3)", background: anyKey ? "rgba(90,186,90,.1)" : "rgba(139,115,85,.1)", color: anyKey ? "#5ABA5A" : "#B5A88A", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              {anyKey ? "● API" : "○ API Setup"}
            </button>
          </div>
          <h1 style={{ fontSize: messages.length ? 28 : 42, fontWeight: 400, color: "#F0EBE3", margin: 0, lineHeight: 1.15, transition: "font-size .4s ease" }}>
            Trova l'immagine giusta.<br /><em style={{ fontStyle: "italic", color: "#8B7355" }}>Quella vera.</em>
          </h1>
          {!messages.length && <p style={{ fontSize: 14, color: "#8B7355", marginTop: 16, fontFamily: "'Space Grotesk', sans-serif", maxWidth: 500, margin: "16px auto 0", lineHeight: 1.6 }}>
            Descrivi il tuo obiettivo di marketing. Riceverai strategia visiva, caption pronte per i post, storyboard video e query per Unsplash, Pexels e Pixabay.
          </p>}
        </header>

        {showApiSetup && (
          <div style={{ animation: "fadeSlideUp .3s ease-out", margin: "0 0 24px", padding: 18, background: "#FBF8F3", borderRadius: 18, border: "1px solid rgba(139,115,85,.15)", fontFamily: "'Space Grotesk', sans-serif" }}>
            <SectionLabel>🔑 API Keys — Anteprima Immagini</SectionLabel>
            <p style={{ fontSize: 12, color: "#6B5B45", marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
              Senza keys l'app funziona comunque — i link aprono le ricerche sui siti. Con le keys attivi le anteprime inline delle foto.
            </p>
            {[
              { key: "unsplash", label: "Unsplash Access Key", url: "https://unsplash.com/developers" },
              { key: "pexels", label: "Pexels API Key", url: "https://www.pexels.com/api/new/" },
              { key: "pixabay", label: "Pixabay API Key", url: "https://pixabay.com/api/docs/" },
            ].map(({ key, label, url }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#3D3225" }}>{label}</label>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#8B7355" }}>Ottieni key ↗</a>
                </div>
                <input type="password" placeholder={`Incolla ${label}...`} defaultValue={API_KEYS[key]}
                  onChange={e => { API_KEYS[key] = e.target.value; }}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 12, border: "1px solid rgba(139,115,85,.2)", background: "#F5F0E8", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#3D3225" }} />
              </div>
            ))}
            <div style={{ fontSize: 10, color: "#999", marginTop: 8, lineHeight: 1.4 }}>Le keys restano solo nel browser e non vengono salvate su nessun server.</div>
          </div>
        )}

        {!messages.length && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 32, animation: "fadeSlideUp .6s ease-out .2s both" }}>
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => sendMessage(ex)}
                style={{ padding: "8px 16px", borderRadius: 20, border: "1px solid rgba(139,115,85,.35)", background: "rgba(139,115,85,.14)", color: "#D9CCB8", fontSize: 12, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", textAlign: "left", maxWidth: 320 }}>
                {ex}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 20, animation: "fadeSlideUp .4s ease-out" }}>
              {msg.role === "user" ? (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ maxWidth: "85%", padding: "12px 18px", borderRadius: "18px 18px 4px 18px", background: "#3D3225", color: "#F0E8D8", fontSize: 14, lineHeight: 1.55, fontFamily: "'Space Grotesk', sans-serif" }}>{msg.content}</div>
                </div>
              ) : (
                <div style={{ maxWidth: "95%" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "#8B7355", fontFamily: "'JetBrains Mono', monospace" }}>◈ Scout</div>
                    {msg.requestId != null && (
                      <button onClick={() => deleteExchange(i)} title="Elimina questa domanda e risposta"
                        style={{ fontSize: 10, color: "#B45050", background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px", fontFamily: "'JetBrains Mono', monospace" }}>
                        🗑 Elimina
                      </button>
                    )}
                  </div>
                  <div style={{ padding: "18px 20px", borderRadius: "4px 18px 18px 18px", background: "#FFFCF5", border: "1px solid rgba(139,115,85,.12)", fontSize: 14, lineHeight: 1.6, fontFamily: "'Space Grotesk', sans-serif", boxShadow: "0 2px 12px rgba(44,36,24,.04)" }}>
                    {msg.type === "strategy" ? <StrategyMessage data={msg.content} originalBrief={messages[i-1]?.role === "user" ? messages[i-1].content : ""} onUpdateData={(updated) => { setMessages(prev => { const copy = [...prev]; copy[i] = { ...copy[i], content: updated }; return copy; }); }} brand={brand} /> : <p style={{ margin: 0, color: "#3D3225" }}>{msg.content}</p>}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ maxWidth: "95%", animation: "fadeSlideUp .3s ease-out" }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "#8B7355", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>◈ Scout</div>
              <div style={{ display: "inline-block", padding: "14px 20px", borderRadius: "4px 18px 18px 18px", background: "#FFFCF5", border: "1px solid rgba(139,115,85,.12)" }}>
                <TypingDots />
                <div style={{ fontSize: 11, color: "#8B7355", fontFamily: "'Space Grotesk', sans-serif", marginTop: 4 }}>Strategia, caption e storyboard in arrivo...</div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 20px 24px", background: "linear-gradient(to top, #0D0D0D 70%, transparent)", zIndex: 10 }}>
          <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea className="vms-input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Descrivi il tuo obiettivo di marketing..." rows={1} disabled={loading}
              style={{ flex: 1, padding: "14px 18px", borderRadius: 20, border: "1.5px solid rgba(139,115,85,.2)", background: "#FFFCF5", fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", color: "#2C2418", resize: "none", lineHeight: 1.5 }}
              onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }} />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ width: 48, height: 48, borderRadius: 18, border: "none", background: loading || !input.trim() ? "rgba(139,115,85,.15)" : "#3D3225", color: loading || !input.trim() ? "#B5A88A" : "#F0E8D8", fontSize: 20, cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
