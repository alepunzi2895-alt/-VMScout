// /api/canva-carousel.js — compone in UN SOLO design Canva un intero carosello
// (di FOTO o di VIDEO) a partire da Visual Scout.
//
// COME funziona (dal 2026-09-09):
// Il Brand Template carosello `EAHUiOe8TUA` ha 6 pagine con, per pagina, una
// cornice full-bleed `Immagine_N` + il testo `Testo_N`. La cornice accetta sia
// immagini sia video (autofill `{ type:"image"|"video", asset_id }`). Quindi:
// carichiamo gli N media delle slide come asset, UN solo job autofill riempie
// `Testo_1..N` / `Immagine_1..N` e infine `trimTrailingPages` elimina le pagine
// oltre N. Risultato = un unico design a N pagine con lo sfondo su ogni pagina.
//
// Lavora a CICLI (maxDuration:60 di Vercel). Fasi (`resume.stage`):
//   upload   → carica gli N media (foto: binario; video: url-asset-uploads)
//   autofill → un job autofill sul template
//
import { getDb } from "./db.js";
import {
  getCanvaToken, runAutofill, trimTrailingPages,
  startImageUpload, checkImageUpload, uploadVideoUrlAsset,
} from "./canva-lib.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const POLL_INTERVAL = 3500;

const PEXELS_KEY  = process.env.VITE_PEXELS_KEY  || "";
const PIXABAY_KEY = process.env.VITE_PIXABAY_KEY || "";
const MAX_SLIDES = 6; // il template ha 6 pagine

async function fetchPexelsUrl(query, vertical) {
  if (!PEXELS_KEY || !query) return null;
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${vertical ? "portrait" : "landscape"}`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const d = await r.json();
    return d.photos?.[0]?.src?.large2x || d.photos?.[0]?.src?.large || null;
  } catch { return null; }
}

async function fetchPexelsVideo(query, vertical) {
  if (!PEXELS_KEY || !query) return null;
  try {
    const r = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${vertical ? "portrait" : "landscape"}`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const d = await r.json();
    const files = (d.videos?.[0]?.video_files || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    const pick = files.find(f => (f.width || 0) >= 720 && (f.width || 0) <= 1400) || files[files.length - 1] || files[0];
    return pick?.link || null;
  } catch { return null; }
}

async function fetchPixabayVideo(query) {
  if (!PIXABAY_KEY || !query) return null;
  try {
    const r = await fetch(`https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=5`);
    const d = await r.json();
    const v = d.hits?.[0]?.videos || {};
    return v.large?.url || v.medium?.url || v.small?.url || v.tiny?.url || null;
  } catch { return null; }
}

// URL video per la slide in base alla fonte scelta (`video_source`).
async function resolveVideoUrl(slide, vertical) {
  if (slide.video_url) return slide.video_url;
  const q = slide.search_query;
  if (!q) return null;
  const src = slide.video_source || "pexels_video";
  if (src === "pixabay_video") return (await fetchPixabayVideo(q)) || (await fetchPexelsVideo(q, vertical));
  // pinterest/coverr/instagram: nessuna API → serve un URL incollato (già gestito sopra)
  return fetchPexelsVideo(q, vertical);
}

// slot per slide: { assetId, kind } pronto | { jobId, kind } in corso | { error }
function toSlot(r, kind) {
  if (r.assetId) return { assetId: r.assetId, kind };
  if (r.jobId)   return { jobId: r.jobId, kind };
  if (r.pending) return { jobId: r.jobId || null, kind };
  return { error: r.error || "Media non caricato su Canva.", kind };
}

// Poll SEQUENZIALE degli slot ancora in upload — endpoint diverso per foto
// (`/asset-uploads`) e video (`/url-asset-uploads`).
async function pollSlots({ token, slots, stopAt }) {
  const out = [...slots];
  while (out.some(s => s?.jobId) && Date.now() < stopAt) {
    await sleep(POLL_INTERVAL);
    for (let i = 0; i < out.length; i++) {
      if (!out[i]?.jobId || Date.now() >= stopAt) continue;
      const kind = out[i].kind;
      if (kind === "video") {
        const c = await uploadVideoUrlAsset({ token, resumeJobId: out[i].jobId, deadline: Math.min(stopAt, Date.now() + POLL_INTERVAL + 1500) });
        if (c.assetId) out[i] = { assetId: c.assetId, kind };
        else if (c.error) out[i] = { error: c.error, kind };
        // c.pending: lascia com'è
      } else {
        const c = await checkImageUpload({ token, jobId: out[i].jobId });
        if (c.assetId) out[i] = { assetId: c.assetId, kind };
        else if (c.error) out[i] = { error: c.error, kind };
      }
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { slides, templateId, carouselTemplateId, format = "post", media, resume } = req.body || {};
  const tplId = carouselTemplateId || templateId;
  if (!Array.isArray(slides) || !slides.length) {
    return res.status(400).json({ error: "Mancano le slide" });
  }
  if (!tplId) {
    return res.status(400).json({
      error: "TEMPLATE_NOT_SET",
      message: 'Template Carosello non configurato in Canva Studio (Brand Template a 6 pagine con campi "Immagine_1"/"Testo_1" … "Immagine_6"/"Testo_6").',
    });
  }

  const db = getDb();
  let token;
  try {
    token = await getCanvaToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva." });
  }

  const usedSlides = slides.slice(0, MAX_SLIDES);
  const captions   = usedSlides.map(s => (s.caption || "").trim());
  const deadline   = Date.now() + 48_000;
  const wantVideoCarousel = media === "video";

  // ── FASE autofill ──────────────────────────────────────────────────
  async function runAutofillPhase({ slots, mediaUrls, resumeJobId }) {
    let af;
    if (resumeJobId) {
      af = await runAutofill({ token, resumeJobId, deadline });
    } else {
      const data = {};
      usedSlides.forEach((_, i) => {
        const n = i + 1;
        if (captions[i]) {
          data[`Testo_${n}`]   = { type: "text", text: captions[i] };
          data[`Caption_${n}`] = { type: "text", text: captions[i] };
        }
        if (slots[i]?.assetId) {
          const t = slots[i].kind === "video" ? "video" : "image";
          data[`Immagine_${n}`] = { type: t, asset_id: slots[i].assetId };
          data[`Image_${n}`]    = { type: t, asset_id: slots[i].assetId };
          data[`Sfondo_${n}`]   = { type: t, asset_id: slots[i].assetId };
        }
      });
      af = await runAutofill({
        token, templateId: tplId, data,
        title: `Carosello ${usedSlides.length} ${wantVideoCarousel ? "video" : "slide"}`, deadline,
      });
    }

    if (af.pending) {
      return res.status(202).json({
        pending: true, phase: "autofill",
        resume: { stage: "autofill", jobId: af.jobId, slots, mediaUrls },
      });
    }
    if (!af.ok) {
      if (af.status === 401) return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: af.message });
      return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
        error: true, message: af.message, details: af.details,
      });
    }

    let finalUrl = af.designUrl;
    let finalId  = af.designId;
    if (af.designId && usedSlides.length < MAX_SLIDES) {
      const trim = await trimTrailingPages({
        token, designId: af.designId, keep: usedSlides.length,
        deadline: Math.min(deadline, Date.now() + 14_000),
      });
      if (trim.ok && trim.designUrl) { finalUrl = trim.designUrl; finalId = trim.designId || finalId; }
    }

    const filled  = slots.filter(s => s?.assetId).length;
    const missing = usedSlides.length - filled;
    const slotErrors = slots.map((s, i) => s?.error ? `Slide ${i + 1}: ${s.error}` : null).filter(Boolean);
    const templateHint = af.imageFieldsMissing && typeof af.imageFieldsMissing === "string" ? af.imageFieldsMissing : null;
    const what = wantVideoCarousel ? "I video sono stati caricati" : "Le foto sono state caricate";

    return res.status(200).json({
      ok: true,
      url: finalUrl || (finalId ? `https://www.canva.com/design/${finalId}/edit` : null),
      slidesFilled: templateHint ? 0 : filled,
      totalSlides: usedSlides.length,
      imageUrls: (mediaUrls || []).filter(Boolean),
      slotErrors,
      imageWarning: templateHint
        ? `${what} ma il template carosello non li mostra. ${templateHint}`
        : missing > 0
          ? (slotErrors.length ? slotErrors.join(" · ") : `${missing} sfondo/i non caricato/i su Canva.`)
          : null,
    });
  }

  async function afterUploads({ slots, mediaUrls }) {
    if (slots.some(s => s?.jobId)) {
      return res.status(202).json({
        pending: true, phase: "upload",
        resume: { stage: "upload", slots, mediaUrls },
      });
    }
    return runAutofillPhase({ slots, mediaUrls });
  }

  try {
    if (resume?.stage === "autofill" && resume.jobId) {
      return await runAutofillPhase({ slots: resume.slots || [], mediaUrls: resume.mediaUrls || resume.imageUrls || [], resumeJobId: resume.jobId });
    }

    if (resume?.stage === "upload" && Array.isArray(resume.slots)) {
      const slots = await pollSlots({ token, slots: resume.slots, stopAt: deadline });
      return await afterUploads({ slots, mediaUrls: resume.mediaUrls || resume.imageUrls || [] });
    }

    // ── Fresh ──────────────────────────────────────────────────────
    const vertical = wantVideoCarousel || format === "story" || format === "reel";

    const mediaUrls = await Promise.all(usedSlides.map(async s => {
      if (s.asset_id) return null; // già caricato dal client
      if (wantVideoCarousel) return resolveVideoUrl(s, vertical);
      return s.image_url || (s.search_query ? await fetchPexelsUrl(s.search_query, vertical) : null);
    }));

    let slots = await Promise.all(mediaUrls.map(async (url, i) => {
      const kind = wantVideoCarousel ? "video" : "image";
      // asset già caricato dal client (es. clip video ritagliata) → usalo diretto
      if (usedSlides[i]?.asset_id) return { assetId: usedSlides[i].asset_id, kind };
      if (!url) return { error: null, kind };
      if (wantVideoCarousel) {
        const r = await uploadVideoUrlAsset({ token, url, name: `vmscout-slide-${i + 1}.mp4`, deadline: Math.min(deadline, Date.now() + 12_000) });
        const sl = toSlot(r, "video");
        if (sl.error) { try { sl.error += ` [${new URL(url).host}]`; } catch { /* */ } }
        return sl;
      }
      const r = await startImageUpload({ token, url, name: `vmscout-slide-${i + 1}.jpg` });
      const sl = toSlot(r, "image");
      if (sl.error) { try { sl.error += ` [${new URL(url).host}]`; } catch { /* */ } }
      return sl;
    }));

    slots = await pollSlots({ token, slots, stopAt: deadline });
    return await afterUploads({ slots, mediaUrls });

  } catch (err) {
    console.error("[canva-carousel]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
