import { getDb, ensureCanvaAuthTable } from "./db.js";
import { runAutofill } from "./canva-lib.js";

const CANVA_API  = "https://api.canva.com/rest/v1";
const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";

// ─── helpers ────────────────────────────────────────────

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

// Upload via URL-based job (same approach as canva-upload.js)
async function uploadImageUrl(imageUrl, token) {
  try {
    const r = await fetch(`${CANVA_API}/url-asset-uploads`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "vmscout-bg.jpg", url: imageUrl }),
    });
    const d = await r.json();
    if (!r.ok || !d.job?.id) return null;

    const jobId   = d.job.id;
    const deadline = Date.now() + 20_000;
    let job = d.job;
    while (job.status === "in_progress" && Date.now() < deadline) {
      await new Promise(res => setTimeout(res, 1500));
      const poll = await fetch(`${CANVA_API}/url-asset-uploads/${jobId}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const pd = await poll.json();
      job = pd.job ?? job;
    }

    return job.status === "success" ? (job.asset?.id || null) : null;
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
    token = await getToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso. Clicca 'Connetti Canva'." });
  }

  try {
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
    const assetId = imageUrl ? await uploadImageUrl(imageUrl, token) : null;

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

    const af = await runAutofill({ token, templateId, data: autofillData, title: (caption || "VMScout").slice(0, 60) });
    if (!af.ok) {
      return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
        error:   true,
        message: af.message,
        details: af.details,
      });
    }

    return res.status(200).json({ ok: true, url: af.designUrl, imageUrl: imageUrl || null });

  } catch (err) {
    console.error("[canva-create]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
