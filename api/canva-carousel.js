// /api/canva-carousel.js — compone le slide di un carosello su Canva a partire
// dall'output di Visual Scout (post_composer).
//
// COME funziona (dal 2026-09-09):
//
// Il vecchio approccio ("un unico template a N pagine con placeholder
// Image_1..N/Testo_1..N") non funzionava: i riquadri immagine del template
// carosello non erano taggati come campi di autofill e Canva non ci fa leggere
// il dataset del brand template per accorgercene → le foto venivano caricate ma
// il carosello restava con solo testo su fondo nero.
//
// Anche la Design Merge API (unire N design da una pagina in un carosello) è
// stata scartata: è in "preview", per il nostro account l'operazione
// `insert_pages` risponde success ma NON aggiunge davvero le pagine.
//
// Quindi: ogni slide è un design a sé, composto con il template del POST
// SINGOLO (`Immagine_Sfondo` + `Testo_Post`/`Caption`) — verificato funzionante
// con lo sfondo foto. La risposta è la LISTA degli N design: l'utente li apre,
// esporta le immagini e le carica su Instagram come carosello (è comunque il
// flusso IG: un carosello sono singole immagini).
//
// Lavora a CICLI (maxDuration:60 di Vercel): a fine ciclo, se Canva sta ancora
// lavorando, risponde { pending, resume } e il client lo richiama (cap 5 min).
//
// Fasi (campo `resume.stage`):
//   upload  → carica le N immagini su Canva     → slots[i].assetId
//   slides  → N job autofill (template post)    → slideJobs[i].designId
//
import { getDb } from "./db.js";
import {
  getCanvaToken,
  startImageUpload, checkImageUpload,
  startAutofillJob, checkAutofillJob,
} from "./canva-lib.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const POLL_INTERVAL = 3500;

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

// "slot" per slide: { assetId } pronto | { jobId } in corso | { error } fallito
// ({ error:null } = slide senza immagine, non è un problema).
function toSlot(r) {
  if (r.assetId) return { assetId: r.assetId };
  if (r.jobId) return { jobId: r.jobId };
  if (r.pending) return { jobId: r.jobId || null };
  return { error: r.error || "Immagine non caricata su Canva." };
}

// Poll SEQUENZIALE degli slot ancora in upload (mai in parallelo: Canva limita a
// ~30 req/min/utente). Un giro ogni POLL_INTERVAL finché tutti risolti o stopAt.
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

  const { slides, postTemplateId, format = "post", resume } = req.body || {};
  if (!Array.isArray(slides) || !slides.length) {
    return res.status(400).json({ error: "Mancano le slide" });
  }
  if (!postTemplateId) {
    return res.status(400).json({
      error: "TEMPLATE_NOT_SET",
      message: 'Configura il "Template Post" in Canva Studio: il carosello compone ogni pagina con quello (deve avere lo sfondo foto "Immagine_Sfondo" e il testo "Testo_Post"/"Caption").',
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
  const deadline   = Date.now() + 48_000; // budget di UN ciclo (maxDuration:60, margine 12s)

  // ── FASE slides: crea/polla i job autofill (uno per slide) ──────────
  async function runSlidesPhase({ slots, imageUrls, slideJobs }) {
    const jobs = slideJobs || usedSlides.map(() => ({}));

    // 1) crea i job mancanti
    for (let i = 0; i < jobs.length && Date.now() < deadline; i++) {
      if (jobs[i].jobId || jobs[i].designId || jobs[i].error) continue;
      const data = {};
      if (captions[i]) {
        data["Testo_Post"] = { type: "text", text: captions[i] };
        data["Caption"]    = { type: "text", text: captions[i] };
      }
      if (slots[i]?.assetId) {
        data["Immagine_Sfondo"] = { type: "image", asset_id: slots[i].assetId };
        data["Background"]      = { type: "image", asset_id: slots[i].assetId };
      }
      const r = await startAutofillJob({ token, templateId: postTemplateId, data, title: captions[i] ? captions[i].slice(0, 40) : `Slide ${i + 1}` });
      if (r.jobId) jobs[i] = { jobId: r.jobId };
      else if (r.retry) { /* 429: riprova al ciclo dopo */ }
      else jobs[i] = { error: r.error || "Autofill slide non riuscito." };
    }

    // 2) polla i job in corso
    while (jobs.some(j => j.jobId && !j.designId && !j.error) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL);
      for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i].jobId || jobs[i].designId || jobs[i].error || Date.now() >= deadline) continue;
        const c = await checkAutofillJob({ token, jobId: jobs[i].jobId });
        if (c.designId) jobs[i] = { designId: c.designId, designUrl: c.designUrl };
        else if (c.error) jobs[i] = { error: c.error };
      }
    }

    // ancora job da creare (429) o da finire → altro ciclo
    if (jobs.some(j => !j.designId && !j.error) && Date.now() >= deadline) {
      return res.status(202).json({
        pending: true, phase: "slides",
        resume: { stage: "slides", slots, imageUrls, slideJobs: jobs },
      });
    }

    const designs = jobs.map((j, i) => j.designId ? {
      url: j.designUrl || `https://www.canva.com/design/${j.designId}/edit`,
      caption: captions[i],
      hasImage: !!slots[i]?.assetId,
    } : null).filter(Boolean);

    if (!designs.length) {
      const firstErr = jobs.find(j => j.error)?.error;
      return res.status(502).json({ error: true, message: `Canva non è riuscita a comporre nessuna slide.${firstErr ? " " + firstErr : ""}` });
    }

    const slideErrors = jobs.map((j, i) => j.error ? `Slide ${i + 1}: ${j.error}` : null).filter(Boolean);
    const withImage = designs.filter(d => d.hasImage).length;
    const noImage   = designs.length - withImage;

    return res.status(200).json({
      ok: true,
      designs,
      url: designs[0].url,                 // retrocompat
      slidesFilled: withImage,
      totalSlides: usedSlides.length,
      madeSlides: designs.length,
      imageUrls: (imageUrls || []).filter(Boolean),
      slotErrors: slideErrors,
      imageWarning: [
        slideErrors.length ? slideErrors.join(" · ") : null,
        noImage > 0 ? `${noImage} slide senza foto di sfondo.` : null,
      ].filter(Boolean).join(" · ") || null,
    });
  }

  try {
    // ── Resume: autofill slide in corso ────────────────────────────
    if (resume?.stage === "slides") {
      return await runSlidesPhase({
        slots: resume.slots || [], imageUrls: resume.imageUrls || [], slideJobs: resume.slideJobs,
      });
    }

    // ── Resume: upload immagini in corso ───────────────────────────
    if (resume?.stage === "upload" && Array.isArray(resume.slots)) {
      const slots = await pollSlots({ token, slots: resume.slots, stopAt: deadline });
      if (slots.some(s => s?.jobId)) {
        return res.status(202).json({
          pending: true, phase: "upload",
          resume: { stage: "upload", slots, imageUrls: resume.imageUrls || [] },
        });
      }
      return await runSlidesPhase({ slots, imageUrls: resume.imageUrls || [] });
    }

    // ── Fresh: risolvi immagini → avvia gli upload ─────────────────
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

    if (slots.some(s => s?.jobId)) {
      return res.status(202).json({
        pending: true, phase: "upload",
        resume: { stage: "upload", slots, imageUrls },
      });
    }
    return await runSlidesPhase({ slots, imageUrls });

  } catch (err) {
    console.error("[canva-carousel]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
