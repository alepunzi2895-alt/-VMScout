import { getDb } from "./db.js";
import { getCanvaToken, runAutofill, uploadUrlAsset, uploadVideoUrlAsset } from "./canva-lib.js";

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

// Un video Pexels per la query. Sceglie un file ~720-1400px: abbastanza nitido
// per un reel, sotto il limite 100MB di `url-asset-uploads` di Canva.
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

// Avvia (o riprende) l'autofill e finalizza la risposta. `assetKind` = "image" |
// "video" — Canva riempie lo stesso campo cornice con l'uno o l'altro.
async function runAutofillPhase({ res, token, templateId, caption, cta, assetId, assetKind = "image", resumeJobId, mediaUrl, mediaWarning, deadline }) {
  const autofillData = {};
  if (caption) {
    autofillData["Testo_Post"] = { type: "text", text: caption };
    autofillData["Caption"]    = { type: "text", text: caption };
  }
  if (cta) autofillData["CTA"] = { type: "text", text: cta };
  if (assetId) {
    autofillData["Immagine_Sfondo"] = { type: assetKind, asset_id: assetId };
    autofillData["Background"]      = { type: assetKind, asset_id: assetId };
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
      resume: { stage: "autofill", jobId: af.jobId, mediaUrl: mediaUrl || null, mediaWarning: mediaWarning || null },
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
  const what = assetKind === "video" ? "Il video" : "La foto";
  return res.status(200).json({
    ok: true,
    url: af.designUrl,
    imageUrl: mediaUrl || null,
    imageWarning: templateHint
      ? `${what} è stato caricato ma il template non lo mostra. ${templateHint}`
      : (mediaWarning || null),
  });
}

// ─── handler ────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const {
    caption, search_query, format = "post", cta,
    templateId, imageUrl: bodyImageUrl, videoUrl: bodyVideoUrl, mediaType, resume,
    assetId: bodyAssetId, // asset Canva già caricato dal client (es. clip video ritagliata)
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

  const deadline = Date.now() + 48_000;
  const vertical = format === "story" || format === "reel";
  // I Reel sono SEMPRE video; per gli altri formati serve mediaType/videoUrl.
  const wantVideo = format === "reel" || mediaType === "video" || !!bodyVideoUrl;

  try {
    // ── Resume: autofill già avviato ──────────────────────────────
    if (resume?.stage === "autofill" && resume.jobId) {
      return await runAutofillPhase({
        res, token, templateId, caption, cta,
        resumeJobId: resume.jobId,
        mediaUrl: resume.mediaUrl, mediaWarning: resume.mediaWarning,
        deadline,
      });
    }

    // ── Resume: upload media già avviato ──────────────────────────
    if (resume?.stage === "upload" && resume.jobId) {
      const isVid = resume.assetKind === "video";
      const up = isVid
        ? await uploadVideoUrlAsset({ token, resumeJobId: resume.jobId, deadline })
        : await uploadUrlAsset({ token, resumeJobId: resume.jobId, deadline });
      if (up.pending) {
        return res.status(202).json({
          pending: true, phase: "upload",
          resume: { stage: "upload", jobId: up.jobId, mediaUrl: resume.mediaUrl, assetKind: resume.assetKind },
        });
      }
      return await runAutofillPhase({
        res, token, templateId, caption, cta,
        assetId: up.assetId, assetKind: resume.assetKind || "image",
        mediaUrl: resume.mediaUrl,
        mediaWarning: up.assetId ? null : (up.error || `${isVid ? "Video" : "Immagine"} non caricato su Canva.`),
        deadline,
      });
    }

    // ── Fresh: asset già caricato dal client (clip ritagliata) ────
    if (bodyAssetId) {
      return await runAutofillPhase({
        res, token, templateId, caption, cta,
        assetId: bodyAssetId, assetKind: mediaType === "video" ? "video" : "image",
        deadline,
      });
    }

    // ── Fresh ─────────────────────────────────────────────────────
    if (wantVideo) {
      const videoUrl = bodyVideoUrl || (search_query ? await fetchPexelsVideo(search_query, vertical) : null);
      if (videoUrl) {
        const up = await uploadVideoUrlAsset({ token, url: videoUrl, name: "vmscout-bg.mp4", deadline });
        if (up.pending) {
          return res.status(202).json({
            pending: true, phase: "upload",
            resume: { stage: "upload", jobId: up.jobId, mediaUrl: videoUrl, assetKind: "video" },
          });
        }
        return await runAutofillPhase({
          res, token, templateId, caption, cta,
          assetId: up.assetId, assetKind: "video",
          mediaUrl: videoUrl,
          mediaWarning: up.assetId ? null : (up.error || "Video non caricato su Canva."),
          deadline,
        });
      }
      // nessun video trovato → per il reel ripiego sulla foto con avviso
      if (format !== "reel") {
        return await runAutofillPhase({ res, token, templateId, caption, cta, deadline });
      }
    }

    // Percorso immagine (post/story, o reel senza video disponibile)
    const imageUrl = bodyImageUrl || (search_query ? await fetchPexelsUrl(search_query, vertical) : null);
    if (!imageUrl) {
      return await runAutofillPhase({
        res, token, templateId, caption, cta, deadline,
        mediaWarning: wantVideo ? "Nessun video trovato per la query: apri il design e trascina un video." : null,
      });
    }
    const up = await uploadUrlAsset({ token, url: imageUrl, name: "vmscout-bg.jpg", deadline });
    if (up.pending) {
      return res.status(202).json({
        pending: true, phase: "upload",
        resume: { stage: "upload", jobId: up.jobId, mediaUrl: imageUrl, assetKind: "image" },
      });
    }
    return await runAutofillPhase({
      res, token, templateId, caption, cta,
      assetId: up.assetId, assetKind: "image",
      mediaUrl: imageUrl,
      mediaWarning: [
        up.assetId ? null : (up.error || "Immagine non caricata su Canva."),
        wantVideo ? "Nessun video trovato: usata una foto." : null,
      ].filter(Boolean).join(" ") || null,
      deadline,
    });

  } catch (err) {
    console.error("[canva-create]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
