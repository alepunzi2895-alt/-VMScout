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

// ─── handler ────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { caption, search_query, format = "post", cta, templateId: bodyTemplateId, imageUrl: bodyImageUrl } = req.body;
  if (!caption) return res.status(400).json({ error: "Manca caption" });

  const db = getDb();
  let token;
  try {
    token = await getCanvaToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva." });
  }

  try {
    // Budget totale sotto il maxDuration:60 di vercel.json (5s di margine per
    // rete/serializzazione). Upload immagine e autofill condividono la stessa
    // deadline assoluta: l'upload cede il tempo residuo all'autofill.
    const startedAt = Date.now();
    const hardDeadline   = startedAt + 55_000;
    const uploadDeadline = Math.min(hardDeadline, startedAt + 40_000);

    const vertical = format === "story" || format === "reel";
    const templateId = bodyTemplateId;

    if (!templateId) {
      return res.status(400).json({
        error:   "TEMPLATE_NOT_SET",
        message: `Template Canva per "${format}" non configurato. Impostalo in Canva Studio.`,
      });
    }

    // 1. Immagine: se il client ne passa una esplicita (foto suggerita scelta
    //    dall'utente in Visual Scout), usiamo quella; altrimenti fallback sulla
    //    ricerca Pexels dalla search_query.
    const imageUrl = bodyImageUrl || (search_query ? await fetchPexelsUrl(search_query, vertical) : null);

    // 2. Upload image to Canva and wait for asset_id
    const up = imageUrl ? await uploadUrlAsset({ token, url: imageUrl, name: "vmscout-bg.jpg", deadline: uploadDeadline }) : { assetId: null };
    const assetId = up.assetId;

    // 3. Autofill template with text + image
    const autofillData = {};
    if (caption) {
      autofillData["Testo_Post"] = { type: "text", text: caption };
      autofillData["Caption"]    = { type: "text", text: caption };
    }
    if (cta) {
      autofillData["CTA"] = { type: "text", text: cta };
    }
    if (assetId) {
      autofillData["Immagine_Sfondo"] = { type: "image", asset_id: assetId };
      autofillData["Background"]      = { type: "image", asset_id: assetId };
    }

    const af = await runAutofill({ token, templateId, data: autofillData, title: (caption || "VMScout").slice(0, 60), deadline: hardDeadline });
    if (!af.ok) {
      // 401 da Canva = token non più valido: fai riconnettere (il frontend
      // riapre la finestra di login su questo codice d'errore).
      if (af.status === 401) {
        return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: af.message });
      }
      return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
        error:   true,
        message: af.message,
        details: af.details,
      });
    }

    return res.status(200).json({
      ok: true,
      url: af.designUrl,
      imageUrl: imageUrl || null,
      imageWarning: imageUrl && !assetId ? (up.error || "Immagine non caricata su Canva.") : null,
    });

  } catch (err) {
    console.error("[canva-create]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
