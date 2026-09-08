// /api/canva-carousel.js — compone in UN solo design Canva un intero carosello
// a partire dall'output di Visual Scout (post_composer).
//
// COME funziona (dal 2026-09-09): il vecchio approccio "un template a N pagine
// con placeholder Image_1..N/Testo_1..N" non funzionava — i riquadri immagine
// del template carosello non erano taggati come campi di autofill e Canva non ci
// fa leggere il dataset del brand template (scope brandtemplate:* non abilitato)
// per accorgercene. Le foto venivano caricate ma il carosello restava con solo
// il testo su fondo nero.
//
// Ora ogni slide viene composta col template del POST SINGOLO (`Immagine_Sfondo`
// + `Testo_Post`/`Caption`), che è verificato funzionante con lo sfondo foto.
// Poi gli N design di una pagina vengono uniti con la Design Merge API in un
// unico carosello di N pagine.
//
// Lavora a CICLI (maxDuration:60 di Vercel): a fine ciclo, se Canva sta ancora
// lavorando, risponde { pending, resume } e il client lo richiama (cap 5 min).
//
// Fasi (campo `resume.stage`):
//   upload  → carica le N immagini su Canva            → slots[i].assetId
//   slides  → N job autofill (template post)           → slideJobs[i].designId
//   merge   → N-1 job merge (insert_pages)             → un unico design
//
import { getDb } from "./db.js";
import {
  getCanvaToken,
  startImageUpload, checkImageUpload,
  startAutofillJob, checkAutofillJob,
  startMergeInsert, checkMergeJob,
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
      const r = await startAutofillJob({ token, templateId: postTemplateId, data, title: `Slide ${i + 1}` });
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
        if (c.designId) jobs[i] = { designId: c.designId, designUrl: c.designUrl, hadImage: !!slots[i]?.assetId };
        else if (c.error) jobs[i] = { error: c.error };
      }
    }

    // ancora job da creare (429) o da finire → altro ciclo
    const unfinished = jobs.some(j => (!j.designId && !j.error));
    if (unfinished && Date.now() >= deadline) {
      return res.status(202).json({
        pending: true, phase: "slides",
        resume: { stage: "slides", slots, imageUrls, slideJobs: jobs },
      });
    }

    const good = jobs.map((j, i) => j.designId ? { designId: j.designId, designUrl: j.designUrl, hadImage: !!slots[i]?.assetId } : null).filter(Boolean);
    if (!good.length) {
      const firstErr = jobs.find(j => j.error)?.error;
      return res.status(502).json({ error: true, message: `Canva non è riuscita a comporre nessuna slide.${firstErr ? " " + firstErr : ""}` });
    }

    const slideErrors = jobs.map((j, i) => j.error ? `Slide ${i + 1}: ${j.error}` : null).filter(Boolean);

    if (good.length === 1) {
      // niente da unire
      return finalize({ designId: good[0].designId, designUrl: good[0].designUrl, good, slots, imageUrls, slideErrors, insertedCount: 0 });
    }

    return runMergePhase({
      slots, imageUrls, slideErrors,
      baseDesignId: good[0].designId,
      good,
      mergeSources: good.slice(1).map(g => g.designId),
      mergeIdx: 0,
      insertedCount: 0,
    });
  }

  // ── FASE merge: inserisce le pagine slide 2..N nel design della slide 1 ──
  async function runMergePhase(st) {
    let { baseDesignId, mergeSources, mergeIdx, insertedCount, mergeJobId, slots, imageUrls, slideErrors, good } = st;
    slideErrors = slideErrors || [];

    while (mergeIdx < mergeSources.length && Date.now() < deadline) {
      if (!mergeJobId) {
        const r = await startMergeInsert({
          token,
          baseDesignId,
          sourceDesignId: mergeSources[mergeIdx],
          pageNumbers: [1],
          afterPageNumber: 1 + insertedCount,
          title: `Carosello ${good.length} pagine`,
        });
        if (r.jobId) mergeJobId = r.jobId;
        else if (r.retry) break; // 429: altro ciclo
        else { slideErrors.push(`Unione pagina ${mergeIdx + 2}: ${r.error}`); mergeIdx++; continue; }
      }
      // polla il job merge corrente
      let done = false;
      while (mergeJobId && !done && Date.now() < deadline) {
        await sleep(POLL_INTERVAL);
        const c = await checkMergeJob({ token, jobId: mergeJobId });
        if (c.designId) {
          baseDesignId = c.designId;
          insertedCount++;
          mergeIdx++;
          mergeJobId = null;
          done = true;
        } else if (c.error) {
          slideErrors.push(`Unione pagina ${mergeIdx + 2}: ${c.error}`);
          mergeIdx++;
          mergeJobId = null;
          done = true;
        }
        // pending: continua a pollare
      }
    }

    if (mergeIdx < mergeSources.length) {
      return res.status(202).json({
        pending: true, phase: "merge",
        resume: {
          stage: "merge", baseDesignId, mergeSources, mergeIdx, insertedCount,
          mergeJobId: mergeJobId || null, slots, imageUrls, slideErrors, good,
        },
      });
    }

    return finalize({
      designId: baseDesignId,
      designUrl: `https://www.canva.com/design/${baseDesignId}/edit`,
      good, slots, imageUrls, slideErrors, insertedCount,
    });
  }

  // ── Risposta finale ────────────────────────────────────────────────
  function finalize({ designId, designUrl, good, slots, imageUrls, slideErrors, insertedCount }) {
    const pages = 1 + (insertedCount || 0);
    const withImage = (good || []).slice(0, pages).filter(g => g.hadImage).length;
    const errs = slideErrors || [];
    return res.status(200).json({
      ok: true,
      url: designUrl || `https://www.canva.com/design/${designId}/edit`,
      slidesFilled: withImage,
      totalSlides: usedSlides.length,
      pages,
      imageUrls: (imageUrls || []).filter(Boolean),
      slotErrors: errs,
      imageWarning: errs.length
        ? errs.join(" · ")
        : (withImage < pages ? `${pages - withImage} slide senza foto di sfondo.` : null),
    });
  }

  try {
    // ── Resume: merge in corso ──────────────────────────────────────
    if (resume?.stage === "merge") {
      return await runMergePhase(resume);
    }

    // ── Resume: autofill slide in corso ─────────────────────────────
    if (resume?.stage === "slides") {
      return await runSlidesPhase({
        slots: resume.slots || [], imageUrls: resume.imageUrls || [], slideJobs: resume.slideJobs,
      });
    }

    // ── Resume: upload immagini in corso ────────────────────────────
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

    // ── Fresh: risolvi immagini → avvia gli upload ──────────────────
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
