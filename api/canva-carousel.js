// /api/canva-carousel.js — compone in UN solo design Canva un intero carosello
// a partire dall'output di Visual Scout (post_composer): carica su Canva tutte
// le immagini delle slide e compila un template con placeholder ripetuti
// Image_1..N / Testo_1..N, invece di dover creare/compilare un design per slide.

import { getDb } from "./db.js";
import { getCanvaToken } from "./canva-token.js";
import { runAutofill, trimTrailingPages, uploadUrlAsset } from "./canva-lib.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { slides, templateId, format = "post" } = req.body;
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

  try {
    const vertical = format === "story" || format === "reel";
    const usedSlides = slides.slice(0, MAX_SLIDES);

    // 1. Per ogni slide: usa l'immagine già trovata da Visual Scout (se passata)
    //    altrimenti cerca su Pexels con la stessa search_query della slide.
    const imageUrls = await Promise.all(
      usedSlides.map(s => s.image_url ? Promise.resolve(s.image_url) : fetchPexelsUrl(s.search_query, vertical))
    );

    // 2. Upload in parallelo di tutte le immagini trovate
    const assetIds = await Promise.all(
      imageUrls.map(async (url, i) =>
        url ? (await uploadUrlAsset({ token, url, name: `vmscout-slide-${i + 1}.jpg` })).assetId : null
      )
    );

    // 3. Un solo autofill con tutti i placeholder Image_N / Testo_N / Caption_N compilati
    const autofillData = {};
    usedSlides.forEach((slide, i) => {
      const n = i + 1;
      const caption = slide.caption || "";
      if (caption) {
        autofillData[`Testo_${n}`]   = { type: "text", text: caption };
        autofillData[`Caption_${n}`] = { type: "text", text: caption };
      }
      if (assetIds[i]) {
        autofillData[`Image_${n}`]      = { type: "image", asset_id: assetIds[i] };
        autofillData[`Immagine_${n}`]   = { type: "image", asset_id: assetIds[i] };
      }
    });

    const af = await runAutofill({ token, templateId, data: autofillData, title: `Carosello ${usedSlides.length} slide` });

    if (!af.ok) {
      if (af.status === 401) {
        return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: af.message });
      }
      return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
        error:   true,
        message: af.message,
        details: af.details,
      });
    }

    // Il template carosello ha un numero FISSO di pagine (Image_1..N/Testo_1..N).
    // Se questo carosello ha meno slide, elimina le pagine in coda così il
    // risultato è dinamico (4 slide → 4 pagine). Best-effort.
    let finalUrl = af.designUrl;
    if (af.designId) {
      const trim = await trimTrailingPages({ token, designId: af.designId, keep: usedSlides.length });
      if (trim.ok && trim.designUrl) finalUrl = trim.designUrl;
    }

    const missingImages = usedSlides.length - assetIds.filter(Boolean).length;
    return res.status(200).json({
      ok: true,
      url: finalUrl,
      slidesFilled: assetIds.filter(Boolean).length,
      totalSlides: usedSlides.length,
      imageUrls: imageUrls.filter(Boolean),
      imageWarning: missingImages > 0 ? `${missingImages} sfondo/i non caricato/i su Canva (immagine troppo grande o URL non pubblico).` : null,
    });

  } catch (err) {
    console.error("[canva-carousel]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
