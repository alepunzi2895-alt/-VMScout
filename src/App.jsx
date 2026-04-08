import { useState, useRef, useEffect, useCallback } from "react";

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
// SYSTEM PROMPT — Il cervello strategico dell'app
// ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Visual Marketing Scout — a Senior Marketing Strategist, Visual Director & Content Architect. You analyze business/campaign objectives and return complete visual strategies with search queries, ready-to-post social captions, and video storytelling storyboards.

GOLDEN RULE: "Anti-AI Aesthetic" — Only recommend authentic, real, imperfect visuals. No plastic stock photos or corporate B-roll. Think Pinterest aesthetic: lifestyle, documentary, POV, natural light, film grain, candid moments.

When the user provides a marketing objective, respond ONLY with valid JSON (no markdown fences, no preamble) in this exact structure:

{
  "strategy": {
    "emotion": "Primary emotion to evoke",
    "palette": ["color1", "color2", "color3", "color4"],
    "palette_hex": ["#hex1", "#hex2", "#hex3", "#hex4"],
    "narrative": "2-3 sentence strategic rationale in Italian. Bold, opinionated, direct."
  },
  "direction": {
    "style": "Photography/videography style",
    "composition": "Brief composition guidance",
    "lighting": "Lighting direction"
  },
  "queries": {
    "primary": ["query1", "query2", "query3"],
    "secondary": ["query4", "query5"],
    "avoid": ["bad_query1", "bad_query2"]
  },
  "video_queries": {
    "primary": ["video_query1", "video_query2", "video_query3"],
    "secondary": ["video_query4", "video_query5"],
    "style_notes": "Brief Italian note on editing style"
  },
  "post_composer": [
    {
      "slide_number": 1,
      "visual_description": "Italian description of the ideal image for this slide/post. Be very specific: subject, framing, mood, light, details.",
      "search_query": "English search query to find this exact image",
      "caption": "Ready-to-post Italian caption. Natural, authentic tone. Use actual newline characters for line breaks.",
      "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"],
      "cta": "Call-to-action in Italian",
      "platform_tip": "Brief Italian tip on optimal posting"
    }
  ],
  "video_storytelling": {
    "concept": "Italian creative concept — the narrative arc in 1-2 sentences",
    "duration": "Recommended total duration (e.g. 15s Reel, 30s Story, 60s TikTok)",
    "aspect_ratio": "9:16 | 16:9 | 1:1 | 4:5",
    "music_mood": "Music style suggestion in Italian",
    "scenes": [
      {
        "scene_number": 1,
        "duration": "3s",
        "footage_type": "establishing | detail | action | reaction | transition | closing",
        "description": "Italian description of what we see",
        "search_query": "English query to find this footage",
        "text_overlay": "Short overlay text or null",
        "transition": "cut | fade | swipe | zoom | dissolve"
      }
    ],
    "audio_notes": "Italian notes on sound design"
  },
  "orientation": "portrait | landscape | square",
  "mood_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}

PHOTO QUERY RULES:
- All queries in ENGLISH
- Use aesthetic keywords: "authentic", "candid", "film grain", "natural light", "raw", "documentary"
- NEVER generic stock: "happy business people", "looking at camera", "thumbs up"
- 3 primary + 2 secondary + 2 avoid

VIDEO QUERY RULES:
- English. Use: "slow motion", "handheld", "aerial", "POV", "timelapse", "cinematic"
- NEVER: "corporate video", "business meeting footage"
- 3 primary + 2 secondary

POST COMPOSER RULES:
- Generate 3-5 posts forming a coherent mini-campaign or carousel
- Each post has a distinct visual and caption — they tell a story together
- Captions in ITALIAN, authentic tone, no corporate speak
- 5 hashtags per post (mix niche + broad)
- Vary CTAs (save, share, comment, link, tag)
- Platform tips should be specific

VIDEO STORYTELLING RULES:
- 5-8 scenes forming a complete narrative arc
- Think like a film director: opening hook (first 2s), development, emotional peak, CTA
- Each scene has a specific footage type and search query
- Text overlays punchy, max 6 words
- Include music and sound design guidance
- Duration matches platform (Reels: 15-30s, TikTok: 15-60s, Stories: 15s)

Respond ONLY with the JSON object. No other text.`;

// ─────────────────────────────────────────────────
// PHOTO & VIDEO SOURCES
// ─────────────────────────────────────────────────
const PHOTO_SOURCES = {
  unsplash: {
    name: "Unsplash", icon: "U", color: "#111",
    webUrl: (q, o) => `https://unsplash.com/s/photos/${encodeURIComponent(q)}${o ? `?orientation=${o}` : ""}`,
    apiUrl: (q, o) => `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=6${o ? `&orientation=${o}` : ""}`,
    headers: () => ({ Authorization: `Client-ID ${API_KEYS.unsplash}` }),
    parse: (d) => (d.results || []).map(r => ({ id: r.id, thumb: r.urls?.small, full: r.urls?.regular, alt: r.alt_description, author: r.user?.name, link: r.links?.html })),
  },
  pexels: {
    name: "Pexels", icon: "P", color: "#05A081",
    webUrl: (q) => `https://www.pexels.com/search/${encodeURIComponent(q)}/`,
    apiUrl: (q, o) => `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=6${o === "portrait" ? "&orientation=portrait" : o === "landscape" ? "&orientation=landscape" : ""}`,
    headers: () => ({ Authorization: API_KEYS.pexels }),
    parse: (d) => (d.photos || []).map(p => ({ id: p.id, thumb: p.src?.medium, full: p.src?.large, alt: p.alt, author: p.photographer, link: p.url })),
  },
  pixabay: {
    name: "Pixabay", icon: "X", color: "#00AB6C",
    webUrl: (q) => `https://pixabay.com/images/search/${encodeURIComponent(q)}/`,
    apiUrl: (q, o) => `https://pixabay.com/api/?key=${API_KEYS.pixabay}&q=${encodeURIComponent(q)}&per_page=6${o === "portrait" ? "&orientation=vertical" : o === "landscape" ? "&orientation=horizontal" : ""}`,
    headers: () => ({}),
    parse: (d) => (d.hits || []).map(h => ({ id: h.id, thumb: h.webformatURL, full: h.largeImageURL, alt: h.tags, author: h.user, link: h.pageURL })),
  },
};

const VIDEO_SOURCES = {
  pexels_video: {
    name: "Pexels Video", icon: "▶", color: "#05A081",
    webUrl: (q) => `https://www.pexels.com/search/videos/${encodeURIComponent(q)}/`,
  },
  coverr: {
    name: "Coverr", icon: "C", color: "#1A1A2E",
    webUrl: (q) => `https://coverr.co/s?q=${encodeURIComponent(q)}`,
  },
  pixabay_video: {
    name: "Pixabay Video", icon: "X", color: "#00AB6C",
    webUrl: (q) => `https://pixabay.com/videos/search/${encodeURIComponent(q)}/`,
  },
};

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
async function fetchImages(query, orientation, sourceKey) {
  const src = PHOTO_SOURCES[sourceKey];
  if (!src?.apiUrl || !API_KEYS[sourceKey]) return null;
  try {
    const res = await fetch(src.apiUrl(query, orientation), { headers: src.headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return src.parse(data);
  } catch { return null; }
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
          <div style={{ width: 44, height: 44, borderRadius: 10, background: c, border: "2px solid rgba(0,0,0,0.08)", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }} />
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
        <a key={i} href={img.link} target="_blank" rel="noopener noreferrer" style={{ display: "block", borderRadius: 8, overflow: "hidden", aspectRatio: "1", position: "relative" }}>
          <img src={img.thumb} alt={img.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 6px 4px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", fontSize: 8, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>
            {img.author}
          </div>
        </a>
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
      style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid rgba(139,115,85,0.15)", background: copied ? "rgba(139,115,85,0.1)" : "transparent", color: "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif" }}>
      {copied ? "✓ Copiato!" : label}
    </button>
  );
}

function QueryCard({ query, orientation, sourceKey, onImagesFetched, images }) {
  const src = PHOTO_SOURCES[sourceKey];
  const url = src.webUrl(query, orientation);
  const canFetch = src.apiUrl && API_KEYS[sourceKey];
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleFetch = async (e) => {
    e.preventDefault();
    if (images) { setExpanded(!expanded); return; }
    setLoading(true);
    const results = await fetchImages(query, orientation, sourceKey);
    if (results) onImagesFetched(query, results);
    setExpanded(true);
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(139,115,85,0.06)", borderRadius: 10, textDecoration: "none", color: "#3D3225", border: "1px solid rgba(139,115,85,0.12)", fontSize: 13 }}>
          <span style={{ width: 24, height: 24, borderRadius: 6, background: src.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{src.icon}</span>
          <span style={{ fontStyle: "italic", opacity: 0.85 }}>"{query}"</span>
          <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.4 }}>↗</span>
        </a>
        {canFetch && (
          <button onClick={handleFetch}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(139,115,85,0.2)", background: expanded ? "rgba(139,115,85,0.1)" : "transparent", color: "#8B7355", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>
            {loading ? "..." : images ? (expanded ? "Nascondi" : "Mostra") : "Anteprima"}
          </button>
        )}
      </div>
      {expanded && images && <ImageGrid images={images} />}
    </div>
  );
}

function VideoQueryCard({ query, sourceKey }) {
  const src = VIDEO_SOURCES[sourceKey];
  return (
    <a href={src.webUrl(query)} target="_blank" rel="noopener noreferrer"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(26,26,46,0.05)", borderRadius: 10, textDecoration: "none", color: "#3D3225", border: "1px solid rgba(26,26,46,0.1)", fontSize: 13 }}>
      <span style={{ width: 24, height: 24, borderRadius: 6, background: src.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{src.icon}</span>
      <span style={{ fontStyle: "italic", opacity: 0.85 }}>"{query}"</span>
      <span style={{ marginLeft: "auto", fontSize: 14, opacity: 0.4 }}>▶</span>
    </a>
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
      <div style={{ display: "inline-block", padding: "5px 14px", borderRadius: 20, background: "linear-gradient(135deg, #8B7355, #A69070)", color: "#FFF", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
        ◈ {strategy.emotion}
      </div>

      <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#3D3225", margin: "0 0 16px" }}>{strategy.narrative}</p>

      <div style={{ marginBottom: 16 }}>
        <SectionLabel>Palette Cromatica</SectionLabel>
        <PaletteStrip hex={strategy.palette_hex} names={strategy.palette} />
      </div>

      <div style={{ background: "rgba(139,115,85,0.05)", borderRadius: 12, padding: "14px 16px", marginBottom: 18, borderLeft: "3px solid #8B7355" }}>
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
            style={{ padding: "6px 16px", borderRadius: 8, border: selectedSource === key ? "2px solid #8B7355" : "2px solid rgba(139,115,85,0.15)", background: selectedSource === key ? "rgba(139,115,85,0.12)" : "transparent", color: selectedSource === key ? "#3D3225" : "#8B7355", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
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

      <div style={{ padding: "10px 14px", background: "rgba(180,60,60,0.06)", borderRadius: 10, border: "1px solid rgba(180,60,60,0.12)", marginBottom: 18 }}>
        <SectionLabel color="#B43C3C">✕ Evita queste query</SectionLabel>
        {queries.avoid.map((q, i) => <div key={i} style={{ fontSize: 12, color: "#8B5A5A", fontStyle: "italic", padding: "2px 0" }}>"{q}"</div>)}
      </div>

      {video_queries?.primary && (
        <div style={{ padding: "18px", background: "linear-gradient(135deg, rgba(26,26,46,0.04), rgba(26,26,46,0.08))", borderRadius: 14, border: "1px solid rgba(26,26,46,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #1A1A2E, #2D2D4A)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>▶</span>
            <SectionLabel color="#1A1A2E">Video & Footage</SectionLabel>
          </div>
          {video_queries.style_notes && <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#3D3225", margin: "0 0 14px", fontStyle: "italic", padding: "8px 12px", background: "rgba(255,255,255,0.5)", borderRadius: 8, borderLeft: "3px solid #1A1A2E" }}>{video_queries.style_notes}</p>}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {Object.entries(VIDEO_SOURCES).map(([key, src]) => (
              <button key={key} onClick={() => setSelectedVideoSource(key)}
                style={{ padding: "5px 14px", borderRadius: 8, border: selectedVideoSource === key ? "2px solid #1A1A2E" : "2px solid rgba(26,26,46,0.12)", background: selectedVideoSource === key ? "rgba(26,26,46,0.1)" : "transparent", color: selectedVideoSource === key ? "#1A1A2E" : "#666", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
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
function PostsTab({ data }) {
  const { post_composer, orientation } = data;
  if (!post_composer?.length) return <p style={{ color: "#8B7355", fontSize: 13 }}>Nessun post generato.</p>;

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #E1306C, #F77737)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>◻</span>
        <SectionLabel>Post Composer — {post_composer.length} Slide</SectionLabel>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {post_composer.map((post, i) => (
          <div key={i} style={{ background: "#FFFCF5", border: "1px solid rgba(139,115,85,0.12)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(139,115,85,0.08)", background: "rgba(139,115,85,0.03)" }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #8B7355, #A69070)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{post.slide_number}</span>
              <span style={{ fontSize: 10, color: "#8B7355", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Slide {post.slide_number}</span>
              {post.search_query && (
                <a href={PHOTO_SOURCES.unsplash.webUrl(post.search_query, orientation)} target="_blank" rel="noopener noreferrer"
                  style={{ marginLeft: "auto", fontSize: 10, color: "#8B7355", textDecoration: "none", padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(139,115,85,0.2)", fontFamily: "'JetBrains Mono', monospace" }}>
                  Cerca foto ↗
                </a>
              )}
            </div>
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#6B5B45", fontStyle: "italic", marginBottom: 12, padding: "8px 12px", background: "rgba(139,115,85,0.04)", borderRadius: 8, borderLeft: "3px solid rgba(139,115,85,0.2)", lineHeight: 1.55 }}>
                📷 {post.visual_description}
              </div>
              <div style={{ fontSize: 13.5, color: "#2C2418", lineHeight: 1.65, marginBottom: 12, whiteSpace: "pre-line" }}>{post.caption}</div>
              {post.hashtags && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                  {post.hashtags.map((h, j) => <span key={j} style={{ fontSize: 11, color: "#4A7C9B", fontWeight: 500 }}>#{h}</span>)}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {post.cta && <span style={{ fontSize: 11, fontWeight: 600, color: "#8B7355", padding: "4px 10px", borderRadius: 6, background: "rgba(139,115,85,0.08)" }}>CTA: {post.cta}</span>}
                {post.platform_tip && <span style={{ fontSize: 10, color: "#999", fontStyle: "italic", maxWidth: 220 }}>💡 {post.platform_tip}</span>}
              </div>
            </div>
            <div style={{ padding: "8px 16px", borderTop: "1px solid rgba(139,115,85,0.08)", background: "rgba(139,115,85,0.02)" }}>
              <CopyButton text={`${post.caption}\n\n${(post.hashtags || []).map(h => `#${h}`).join(" ")}`} label="Copia Caption + Hashtag" />
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <CopyButton text={post_composer.map(p => `--- SLIDE ${p.slide_number} ---\n${p.caption}\n\n${(p.hashtags || []).map(h => `#${h}`).join(" ")}\n\nCTA: ${p.cta || ""}`).join("\n\n")} label="Copia Tutte le Caption" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// TAB: VIDEO STORYTELLING
// ─────────────────────────────────────────────────
function VideoTab({ data }) {
  const vs = data.video_storytelling;
  if (!vs?.scenes) return <p style={{ color: "#8B7355", fontSize: 13 }}>Nessuno storyboard generato.</p>;

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #1A1A2E, #4A1942)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🎬</span>
        <SectionLabel color="#1A1A2E">Video Storytelling</SectionLabel>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {[{ l: "Durata", v: vs.duration }, { l: "Aspect", v: vs.aspect_ratio }, { l: "Musica", v: vs.music_mood }].filter(m => m.v).map((m, i) => (
          <div key={i} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(26,26,46,0.06)", border: "1px solid rgba(26,26,46,0.08)", fontSize: 11, color: "#3D3225" }}>
            <span style={{ fontWeight: 700, opacity: 0.5, marginRight: 4 }}>{m.l}:</span>{m.v}
          </div>
        ))}
      </div>

      {vs.concept && <p style={{ fontSize: 13, lineHeight: 1.6, color: "#3D3225", margin: "0 0 18px", padding: "10px 14px", background: "rgba(26,26,46,0.04)", borderRadius: 10, borderLeft: "3px solid #1A1A2E", fontStyle: "italic" }}>{vs.concept}</p>}

      <div style={{ position: "relative", paddingLeft: 22 }}>
        <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, width: 2, background: "linear-gradient(to bottom, #1A1A2E, rgba(26,26,46,0.1))", borderRadius: 1 }} />
        {vs.scenes.map((s, i) => (
          <div key={i} style={{ position: "relative", marginBottom: i < vs.scenes.length - 1 ? 16 : 0, paddingLeft: 18 }}>
            <div style={{ position: "absolute", left: -6, top: 12, width: 10, height: 10, borderRadius: "50%", background: i === 0 ? "#E1306C" : i === vs.scenes.length - 1 ? "#1A1A2E" : "#8B7355", border: "2px solid #F5F0E8" }} />
            <div style={{ background: "#FFFCF5", border: "1px solid rgba(26,26,46,0.08)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1A1A2E", fontFamily: "'JetBrains Mono', monospace" }}>SC.{String(s.scene_number).padStart(2, "0")}</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "rgba(26,26,46,0.06)", color: "#666", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{s.duration}</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "rgba(139,115,85,0.08)", color: "#8B7355", textTransform: "uppercase", fontWeight: 600 }}>{s.footage_type}</span>
                {s.transition && <span style={{ marginLeft: "auto", fontSize: 9, color: "#999", fontFamily: "'JetBrains Mono', monospace" }}>→ {s.transition}</span>}
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#3D3225", margin: "0 0 8px" }}>{s.description}</p>
              {s.text_overlay && <div style={{ display: "inline-block", padding: "5px 12px", borderRadius: 6, background: "#1A1A2E", color: "#F0E8D8", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{s.text_overlay}</div>}
              {s.search_query && (
                <a href={VIDEO_SOURCES.pexels_video.webUrl(s.search_query)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#8B7355", textDecoration: "none", fontFamily: "'JetBrains Mono', monospace", opacity: 0.7 }}>
                  🔍 "{s.search_query}" ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {vs.audio_notes && (
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: "rgba(26,26,46,0.04)", border: "1px solid rgba(26,26,46,0.08)", fontSize: 12, color: "#3D3225", lineHeight: 1.55 }}>
          <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A1A2E", display: "block", marginBottom: 4 }}>🎵 Sound Design</span>
          {vs.audio_notes}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <CopyButton text={`VIDEO STORYBOARD\n${vs.concept}\nDurata: ${vs.duration} | Aspect: ${vs.aspect_ratio}\nMusica: ${vs.music_mood}\n\n${vs.scenes.map(s => `SC.${String(s.scene_number).padStart(2, "0")} [${s.duration}] ${s.footage_type}\n${s.description}${s.text_overlay ? `\nOverlay: "${s.text_overlay}"` : ""}\nFootage: "${s.search_query}"\n→ ${s.transition}`).join("\n\n")}\n\n🎵 ${vs.audio_notes}`} label="Copia Storyboard Completo" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// STRATEGY MESSAGE (MAIN WRAPPER)
// ─────────────────────────────────────────────────
function StrategyMessage({ data }) {
  const [activeTab, setActiveTab] = useState("strategy");
  const [selectedSource, setSelectedSource] = useState("unsplash");
  const [imageCache, setImageCache] = useState({});
  const onImagesFetched = useCallback((key, imgs) => setImageCache(prev => ({ ...prev, [key]: imgs })), []);

  const tabs = [
    { id: "strategy", label: "Strategia", icon: "◈" },
    { id: "posts", label: "Post", icon: "◻", show: data.post_composer?.length > 0 },
    { id: "video", label: "Video", icon: "▶", show: !!data.video_storytelling?.scenes },
  ].filter(t => t.show !== false);

  return (
    <div style={{ animation: "fadeSlideUp 0.5s ease-out" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 18, padding: 3, background: "rgba(139,115,85,0.06)", borderRadius: 12 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 9, border: "none", background: activeTab === tab.id ? "#FFFCF5" : "transparent", boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none", color: activeTab === tab.id ? "#2C2418" : "#8B7355", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif" }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "strategy" && <StrategyTab data={data} selectedSource={selectedSource} setSelectedSource={setSelectedSource} imageCache={imageCache} onImagesFetched={onImagesFetched} />}
      {activeTab === "posts" && <PostsTab data={data} />}
      {activeTab === "video" && <VideoTab data={data} />}

      <details style={{ marginTop: 18 }}>
        <summary style={{ fontSize: 11, color: "#8B7355", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>{"{ }"} Mostra JSON per API</summary>
        <pre style={{ marginTop: 8, padding: 14, background: "#1E1B16", color: "#C4B99A", borderRadius: 10, fontSize: 10, lineHeight: 1.5, overflow: "auto", fontFamily: "'JetBrains Mono', monospace", maxHeight: 300 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────
export default function VisualMarketingScout() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [keysState, setKeysState] = useState({ ...API_KEYS });
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
        body: JSON.stringify({ system: SYSTEM_PROMPT, messages: [{ role: "user", content: userMsg }] }),
      });
      const data = await res.json();
      const raw = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("");
      if (raw) {
        try {
          const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
          setMessages(prev => [...prev, { role: "assistant", content: parsed, type: "strategy" }]);
        } catch { setMessages(prev => [...prev, { role: "assistant", content: raw, type: "text" }]); }
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: "Non ho potuto elaborare la richiesta. Riprova con più dettagli.", type: "text" }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Errore: ${err.message}`, type: "text" }]);
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E8", fontFamily: "'Instrument Serif', Georgia, serif", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap');
        @keyframes typingBounce { 0%,80%,100% { transform:translateY(0);opacity:.4 } 40% { transform:translateY(-6px);opacity:1 } }
        @keyframes fadeSlideUp { from { opacity:0;transform:translateY(12px) } to { opacity:1;transform:translateY(0) } }
        .vms-input:focus { outline:none; box-shadow:0 0 0 2px rgba(139,115,85,.3) }
        .vms-input::placeholder { color:#B5A88A }
        * { box-sizing:border-box }
        ::-webkit-scrollbar { width:5px }
        ::-webkit-scrollbar-thumb { background:rgba(139,115,85,.2); border-radius:10px }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px", position: "relative", zIndex: 2, display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* Header */}
        <header style={{ paddingTop: 40, paddingBottom: messages.length ? 20 : 50, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "#8B7355", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>◈ Visual Marketing Scout</div>
            <button onClick={() => setShowApiSetup(!showApiSetup)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(139,115,85,.2)", background: anyKey ? "rgba(0,150,0,.08)" : "rgba(139,115,85,.06)", color: anyKey ? "#2a7a2a" : "#8B7355", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              {anyKey ? "● API" : "○ API Setup"}
            </button>
          </div>
          <h1 style={{ fontSize: messages.length ? 28 : 42, fontWeight: 400, color: "#2C2418", margin: 0, lineHeight: 1.15, transition: "font-size .4s ease" }}>
            Trova l'immagine giusta.<br /><em style={{ fontStyle: "italic", color: "#8B7355" }}>Quella vera.</em>
          </h1>
          {!messages.length && <p style={{ fontSize: 14, color: "#8B7355", marginTop: 16, fontFamily: "'DM Sans', sans-serif", maxWidth: 500, margin: "16px auto 0", lineHeight: 1.6 }}>
            Descrivi il tuo obiettivo di marketing. Riceverai strategia visiva, caption pronte per i post, storyboard video e query per Unsplash, Pexels e Pixabay.
          </p>}
        </header>

        {/* API Setup */}
        {showApiSetup && (
          <div style={{ animation: "fadeSlideUp .3s ease-out", margin: "0 0 24px", padding: 18, background: "#FFFCF5", borderRadius: 14, border: "1px solid rgba(139,115,85,.15)", fontFamily: "'DM Sans', sans-serif" }}>
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
                  onChange={e => { API_KEYS[key] = e.target.value; setKeysState({ ...API_KEYS }); }}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(139,115,85,.2)", background: "#F5F0E8", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#3D3225" }} />
              </div>
            ))}
            <div style={{ fontSize: 10, color: "#999", marginTop: 8, lineHeight: 1.4 }}>Le keys restano solo nel browser e non vengono salvate su nessun server.</div>
          </div>
        )}

        {/* Examples */}
        {!messages.length && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 32, animation: "fadeSlideUp .6s ease-out .2s both" }}>
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => sendMessage(ex)}
                style={{ padding: "8px 16px", borderRadius: 20, border: "1px solid rgba(139,115,85,.2)", background: "rgba(139,115,85,.06)", color: "#5C4E3C", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textAlign: "left", maxWidth: 320 }}>
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* Chat */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 20, animation: "fadeSlideUp .4s ease-out" }}>
              {msg.role === "user" ? (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ maxWidth: "85%", padding: "12px 18px", borderRadius: "18px 18px 4px 18px", background: "#3D3225", color: "#F0E8D8", fontSize: 14, lineHeight: 1.55, fontFamily: "'DM Sans', sans-serif" }}>{msg.content}</div>
                </div>
              ) : (
                <div style={{ maxWidth: "95%" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "#8B7355", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>◈ Scout</div>
                  <div style={{ padding: "18px 20px", borderRadius: "4px 18px 18px 18px", background: "#FFFCF5", border: "1px solid rgba(139,115,85,.12)", fontSize: 14, lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif", boxShadow: "0 2px 12px rgba(44,36,24,.04)" }}>
                    {msg.type === "strategy" ? <StrategyMessage data={msg.content} /> : <p style={{ margin: 0, color: "#3D3225" }}>{msg.content}</p>}
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
                <div style={{ fontSize: 11, color: "#8B7355", fontFamily: "'DM Sans', sans-serif", marginTop: 4 }}>Strategia, caption e storyboard in arrivo...</div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 20px 24px", background: "linear-gradient(to top, #F5F0E8 70%, transparent)", zIndex: 10 }}>
          <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea className="vms-input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Descrivi il tuo obiettivo di marketing..." rows={1} disabled={loading}
              style={{ flex: 1, padding: "14px 18px", borderRadius: 16, border: "1.5px solid rgba(139,115,85,.2)", background: "#FFFCF5", fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: "#2C2418", resize: "none", lineHeight: 1.5 }}
              onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }} />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ width: 48, height: 48, borderRadius: 14, border: "none", background: loading || !input.trim() ? "rgba(139,115,85,.15)" : "#3D3225", color: loading || !input.trim() ? "#B5A88A" : "#F0E8D8", fontSize: 20, cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
