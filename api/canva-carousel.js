// /api/canva-carousel.js — compone in UN SOLO design Canva un intero carosello
// a partire dall'output di Visual Scout (post_composer).
//
// COME funziona (dal 2026-09-09):
// Il Brand Template carosello `EAHUiOe8TUA` ora ha 6 pagine con, per pagina,
// una cornice full-bleed `Immagine_N` (image) + il testo `Testo_N` (text) —
// aggiunte a mano in Canva (Elementi → Cornici + pannello "Crea in blocco" →
// "Associa i campi automaticamente" → ripubblica). Quindi: carichiamo le N
// immagini delle slide come asset, poi UN solo job autofill riempie
// `Testo_1..N` / `Immagine_1..N` e infine eliminiamo le pagine in eccesso
// (`trimTrailingPages`). Risultato = un unico design a N pagine con lo sfondo
// foto su ogni pagina.
//
// (Storia: prima si mandava l'immagine sotto tanti nomi candidati perché i
// campi non esistevano; la Merge API per unire N design è preview e non
// funzionante per l'account — vedi memory project-canva-upload-saga.)
//
// Lavora a CICLI (maxDuration:60 di Vercel). Fasi (`resume.stage`):
//   upload   → carica le N immagini            → slots[i].assetId
//   autofill → un job autofill sul template    → design a 6 pagine
//   trim     → elimina le pagine oltre N       → design finale
//
import { getDb } from "./db.js";
import { getCanvaToken, runAutofill, trimTrailingPages, startImageUpload, checkImageUpload } from "./canva-lib.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const POLL_INTERVAL = 3500;

const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";
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

function toSlot(r) {
  if (r.assetId) return { assetId: r.assetId };
  if (r.jobId) return { jobId: r.jobId };
  if (r.pending) return { jobId: r.jobId || null };
  return { error: r.error || "Immagine non caricata su Canva." };
}

async function pollSlots({ token, slots, stopAt }) {
  const out = [...slots];
  while (out.some(s => s?.jobId) && Date.now() < stopAt) {
    await sleep(POLL_INTERVAL);
    for (let i = 0; i < out.length; i++) {
      if (!out[i]?.jobId || Date.now() >= stopAt) continue;
      const c = await checkImageUpload({ token, jobId: out[i].jobId });
      if (c.assetId) out[i] = { assetId: c.assetId };
      else if (c.error) out[i] = { error: c.error };
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { slides, templateId, carouselTemplateId, format = "post", resume } = req.body || {};
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

  // ── FASE autofill: un job che riempie Testo_N + Immagine_N ──────────
  async function runAutofillPhase({ slots, imageUrls, resumeJobId }) {
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
          data[`Immagine_${n}`] = { type: "image", asset_id: slots[i].assetId };
          data[`Image_${n}`]    = { type: "image", asset_id: slots[i].assetId };
          data[`Sfondo_${n}`]   = { type: "image", asset_id: slots[i].assetId };
        }
      });
      af = await runAutofill({
        token, templateId: tplId, data,
        title: `Carosello ${usedSlides.length} slide`, deadline,
      });
    }

    if (af.pending) {
      return res.status(202).json({
        pending: true, phase: "autofill",
        resume: { stage: "autofill", jobId: af.jobId, slots, imageUrls },
      });
    }
    if (!af.ok) {
      if (af.status === 401) return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: af.message });
      return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
        error: true, message: af.message, details: af.details,
      });
    }

    // Elimina le pagine oltre il numero di slide (template a 6 pagine fisse).
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

    return res.status(200).json({
      ok: true,
      url: finalUrl || (finalId ? `https://www.canva.com/design/${finalId}/edit` : null),
      slidesFilled: templateHint ? 0 : filled,
      totalSlides: usedSlides.length,
      imageUrls: (imageUrls || []).filter(Boolean),
      slotErrors,
      imageWarning: templateHint
        ? `Le foto sono state caricate ma il template carosello non le mostra. ${templateHint}`
        : missing > 0
          ? (slotErrors.length ? slotErrors.join(" · ") : `${missing} sfondo/i non caricato/i su Canva.`)
          : null,
    });
  }

  async function afterUploads({ slots, imageUrls }) {
    if (slots.some(s => s?.jobId)) {
      return res.status(202).json({
        pending: true, phase: "upload",
        resume: { stage: "upload", slots, imageUrls },
      });
    }
    return runAutofillPhase({ slots, imageUrls });
  }

  try {
    if (resume?.stage === "autofill" && resume.jobId) {
      return await runAutofillPhase({ slots: resume.slots || [], imageUrls: resume.imageUrls || [], resumeJobId: resume.jobId });
    }

    if (resume?.stage === "upload" && Array.isArray(resume.slots)) {
      const slots = await pollSlots({ token, slots: resume.slots, stopAt: deadline });
      return await afterUploads({ slots, imageUrls: resume.imageUrls || [] });
    }

    // ── Fresh ──────────────────────────────────────────────────────
    const vertical = format === "story" || format === "reel";
    const imageUrls = await Promise.all(
      usedSlides.map(s => s.image_url ? Promise.resolve(s.image_url) : fetchPexelsUrl(s.search_query, vertical))
    );
    let slots = await Promise.all(imageUrls.map((url, i) =>
      url
        ? startImageUpload({ token, url, name: `vmscout-slide-${i + 1}.jpg` }).then(r => {
            const s = toSlot(r);
            if (s.error) { try { s.error += ` [${new URL(url).host}]`; } catch { /* */ } }
            return s;
          })
        : Promise.resolve({ error: null })
    ));
    slots = await pollSlots({ token, slots, stopAt: deadline });
    return await afterUploads({ slots, imageUrls });

  } catch (err) {
    console.error("[canva-carousel]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
