// /api/canva-carousel.js — compone in UN solo design Canva un intero carosello
// a partire dall'output di Visual Scout (post_composer): carica su Canva tutte
// le immagini delle slide e compila un template con placeholder ripetuti
// Image_1..N / Testo_1..N, invece di dover creare/compilare un design per slide.
//
// Lavora a CICLI: se Canva è ancora al lavoro (upload immagini o autofill) alla
// fine del ciclo risponde { pending, resume } e il client lo richiama finché
// non è pronto — così non si sbatte contro il maxDuration:60 di Vercel.

import { getDb } from "./db.js";
import { getCanvaToken, runAutofill, trimTrailingPages, uploadUrlAsset } from "./canva-lib.js";

const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";
const MAX_SLIDES = 10;

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

// Risultato di un upload → "slot": { assetId } pronto | { jobId } in corso |
// { error } fallito (error:null = slide senza immagine, non è un problema).
function toSlot(up) {
  if (up.assetId) return { assetId: up.assetId };
  if (up.pending) return { jobId: up.jobId };
  return { error: up.error || "Immagine non caricata su Canva." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { slides, templateId, format = "post", resume } = req.body || {};
  if (!templateId) {
    return res.status(400).json({
      error:   "TEMPLATE_NOT_SET",
      message: 'Template Carosello non configurato. Impostalo in Canva Studio (deve avere placeholder "Image_1"/"Testo_1", "Image_2"/"Testo_2", ecc.).',
    });
  }
  if (!Array.isArray(slides) || !slides.length) return res.status(400).json({ error: "Mancano le slide" });

  const db = getDb();
  let token;
  try {
    token = await getCanvaToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva." });
  }

  const usedSlides = slides.slice(0, MAX_SLIDES);
  const deadline = Date.now() + 48_000; // budget di UN ciclo (maxDuration:60, margine 12s)

  // Autofill + trim + risposta finale. `slots`/`imageUrls` servono a comporre
  // i campi e il warning; `resumeJobId` salta la creazione del job autofill.
  async function finishAutofill({ slots, imageUrls, resumeJobId }) {
    let af;
    if (resumeJobId) {
      af = await runAutofill({ token, resumeJobId, deadline });
    } else {
      const autofillData = {};
      usedSlides.forEach((slide, i) => {
        const n = i + 1;
        if (slide.caption) {
          autofillData[`Testo_${n}`]   = { type: "text", text: slide.caption };
          autofillData[`Caption_${n}`] = { type: "text", text: slide.caption };
        }
        if (slots[i]?.assetId) {
          autofillData[`Image_${n}`]    = { type: "image", asset_id: slots[i].assetId };
          autofillData[`Immagine_${n}`] = { type: "image", asset_id: slots[i].assetId };
        }
      });
      af = await runAutofill({ token, templateId, data: autofillData, title: `Carosello ${usedSlides.length} slide`, deadline });
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

    // Elimina le pagine in coda (template a N pagine fisse). Best-effort: se non
    // fa in tempo il carosello resta valido con qualche pagina vuota in fondo.
    let finalUrl = af.designUrl;
    if (af.designId) {
      const trim = await trimTrailingPages({
        token, designId: af.designId, keep: usedSlides.length,
        deadline: Math.min(deadline, Date.now() + 12_000),
      });
      if (trim.ok && trim.designUrl) finalUrl = trim.designUrl;
    }

    const filled = slots.filter(s => s?.assetId).length;
    const missing = usedSlides.length - filled;
    return res.status(200).json({
      ok: true,
      url: finalUrl,
      slidesFilled: filled,
      totalSlides: usedSlides.length,
      imageUrls: (imageUrls || []).filter(Boolean),
      imageWarning: missing > 0 ? `${missing} sfondo/i non caricato/i su Canva (immagine troppo grande o URL non pubblico).` : null,
    });
  }

  // Se qualche slot è ancora in upload → 202; altrimenti procedi all'autofill.
  async function afterUploads({ slots, imageUrls }) {
    if (slots.some(s => s?.jobId)) {
      return res.status(202).json({
        pending: true, phase: "upload",
        resume: { stage: "upload", slots, imageUrls },
      });
    }
    return finishAutofill({ slots, imageUrls });
  }

  try {
    // ── Resume: autofill già avviato ─────────────────────────────
    if (resume?.stage === "autofill" && resume.jobId) {
      return await finishAutofill({ slots: resume.slots || [], imageUrls: resume.imageUrls || [], resumeJobId: resume.jobId });
    }

    // ── Resume: upload immagini in corso ─────────────────────────
    if (resume?.stage === "upload" && Array.isArray(resume.slots)) {
      const slots = await Promise.all(resume.slots.map(s =>
        s?.jobId ? uploadUrlAsset({ token, resumeJobId: s.jobId, deadline }).then(toSlot) : Promise.resolve(s)
      ));
      return await afterUploads({ slots, imageUrls: resume.imageUrls || [] });
    }

    // ── Fresh: risolvi immagini → avvia upload ───────────────────
    const vertical = format === "story" || format === "reel";
    const imageUrls = await Promise.all(
      usedSlides.map(s => s.image_url ? Promise.resolve(s.image_url) : fetchPexelsUrl(s.search_query, vertical))
    );
    const slots = await Promise.all(imageUrls.map((url, i) =>
      url
        ? uploadUrlAsset({ token, url, name: `vmscout-slide-${i + 1}.jpg`, deadline }).then(toSlot)
        : Promise.resolve({ error: null })
    ));
    return await afterUploads({ slots, imageUrls });

  } catch (err) {
    console.error("[canva-carousel]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
