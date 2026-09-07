// /api/canva-carousel.js — compone in UN solo design Canva un intero carosello
// a partire dall'output di Visual Scout (post_composer): carica su Canva tutte
// le immagini delle slide e compila un template con placeholder ripetuti
// Image_1..N / Testo_1..N, invece di dover creare/compilare un design per slide.

import { getDb, ensureCanvaAuthTable } from "./db.js";
import { runAutofill, trimTrailingPages, uploadUrlAsset } from "./canva-lib.js";

const CANVA_API  = "https://api.canva.com/rest/v1";
const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";
const MAX_SLIDES = 10;

async function getToken(db) {
  await ensureCanvaAuthTable(db);
  const r = await db.execute(
    "SELECT access_token, refresh_token, expires_in, created_at FROM canva_auth WHERE id=1"
  );
  if (!r.rows.length) {
    const e = new Error("CANVA_NOT_CONNECTED"); e.code = "CANVA_NOT_CONNECTED"; throw e;
  }
  const row    = r.rows[0];
  const ageS   = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  const expiry = row.expires_in || 3600;

  if (ageS > expiry - 120 && row.refresh_token) {
    const creds = Buffer.from(
      `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`
    ).toString("base64");
    const tr = await fetch(`${CANVA_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${creds}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
    });
    const td = await tr.json();
    if (td.access_token) {
      await db.execute({
        sql: "UPDATE canva_auth SET access_token=?, expires_in=?, created_at=datetime('now') WHERE id=1",
        args: [td.access_token, td.expires_in || 3600],
      });
      return td.access_token;
    }
  }
  return row.access_token;
}

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
    token = await getToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso. Clicca 'Connetti Canva'." });
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
