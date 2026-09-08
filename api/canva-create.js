import { getDb } from "./db.js";
import { getCanvaToken, runAutofill, uploadUrlAsset } from "./canva-lib.js";

const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";

// ─── helpers ────────────────────────────────────────────

async function fetchPexelsUrl(query, vertical) {
  if (!PEXELS_KEY) return null;
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${vertical ? "portrait" : "landscape"}`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const d = await r.json();
    return d.photos?.[0]?.src?.large2x || d.photos?.[0]?.src?.large || null;
  } catch { return null; }
}

// Avvia (o riprende) l'autofill e finalizza la risposta. Se il job Canva è
// ancora in corso allo scadere del ciclo, risponde 202 con un `resume` che il
// client rimanda finché non è pronto (nessun limite di tempo lato client).
async function runAutofillPhase({ res, token, templateId, caption, cta, assetId, resumeJobId, imageUrl, imageWarning, deadline }) {
  const autofillData = {};
  if (caption) {
    autofillData["Testo_Post"] = { type: "text", text: caption };
    autofillData["Caption"]    = { type: "text", text: caption };
  }
  if (cta) autofillData["CTA"] = { type: "text", text: cta };
  if (assetId) {
    autofillData["Immagine_Sfondo"] = { type: "image", asset_id: assetId };
    autofillData["Background"]      = { type: "image", asset_id: assetId };
  }

  const af = await runAutofill({
    token, templateId, data: autofillData,
    title: (caption || "VMScout").slice(0, 60),
    deadline, resumeJobId,
  });

  if (af.pending) {
    return res.status(202).json({
      pending: true,
      phase: "autofill",
      resume: { stage: "autofill", jobId: af.jobId, imageUrl: imageUrl || null, imageWarning: imageWarning || null },
    });
  }
  if (!af.ok) {
    if (af.status === 401) {
      return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: af.message });
    }
    return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
      error: true, message: af.message, details: af.details,
    });
  }
  const templateHint = af.imageFieldsMissing && typeof af.imageFieldsMissing === "string" ? af.imageFieldsMissing : null;
  return res.status(200).json({
    ok: true,
    url: af.designUrl,
    imageUrl: imageUrl || null,
    imageWarning: templateHint
      ? `La foto è stata caricata ma il template non la mostra. ${templateHint}`
      : (imageWarning || null),
  });
}

// ─── handler ────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const {
    caption, search_query, format = "post", cta,
    templateId, imageUrl: bodyImageUrl, resume,
  } = req.body || {};
  if (!caption) return res.status(400).json({ error: "Manca caption" });
  if (!templateId) {
    return res.status(400).json({
      error: "TEMPLATE_NOT_SET",
      message: `Template Canva per "${format}" non configurato. Impostalo in Canva Studio.`,
    });
  }

  const db = getDb();
  let token;
  try {
    token = await getCanvaToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva." });
  }

  // Budget di UN ciclo: sotto il maxDuration:60 (12s di margine per rete/JSON).
  const deadline = Date.now() + 48_000;

  try {
    // ── Resume: autofill già avviato ──────────────────────────────
    if (resume?.stage === "autofill" && resume.jobId) {
      return await runAutofillPhase({
        res, token, templateId, caption, cta,
        resumeJobId: resume.jobId,
        imageUrl: resume.imageUrl, imageWarning: resume.imageWarning,
        deadline,
      });
    }

    // ── Resume: upload immagine già avviato ───────────────────────
    if (resume?.stage === "upload" && resume.jobId) {
      const up = await uploadUrlAsset({ token, resumeJobId: resume.jobId, deadline });
      if (up.pending) {
        return res.status(202).json({
          pending: true, phase: "upload",
          resume: { stage: "upload", jobId: up.jobId, imageUrl: resume.imageUrl },
        });
      }
      return await runAutofillPhase({
        res, token, templateId, caption, cta,
        assetId: up.assetId,
        imageUrl: resume.imageUrl,
        imageWarning: up.assetId ? null : (up.error || "Immagine non caricata su Canva."),
        deadline,
      });
    }

    // ── Fresh: risolvi immagine → upload → autofill ───────────────
    const vertical = format === "story" || format === "reel";
    const imageUrl = bodyImageUrl || (search_query ? await fetchPexelsUrl(search_query, vertical) : null);

    if (!imageUrl) {
      return await runAutofillPhase({ res, token, templateId, caption, cta, deadline });
    }

    const up = await uploadUrlAsset({ token, url: imageUrl, name: "vmscout-bg.jpg", deadline });
    if (up.pending) {
      return res.status(202).json({
        pending: true, phase: "upload",
        resume: { stage: "upload", jobId: up.jobId, imageUrl },
      });
    }
    return await runAutofillPhase({
      res, token, templateId, caption, cta,
      assetId: up.assetId,
      imageUrl,
      imageWarning: up.assetId ? null : (up.error || "Immagine non caricata su Canva."),
      deadline,
    });

  } catch (err) {
    console.error("[canva-create]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
