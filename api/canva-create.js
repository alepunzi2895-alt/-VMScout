import { getDb } from "./db.js";

const CANVA_API  = "https://api.canva.com/rest/v1";
const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";

// Your saved template design IDs — update these after styling in Canva
const TEMPLATE_IDS = {
  post:  "DAHJFvIQ56k",   // 1080 × 1350
  story: "DAHJFudau5o",   // 1080 × 1920
  reel:  "DAHJFnY488g",   // 1080 × 1920
};

// ─── helpers ────────────────────────────────────────────

async function getToken(db) {
  const r = await db.execute(
    "SELECT access_token, refresh_token, expires_in, created_at FROM luxy_canva_auth WHERE id=1"
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
        sql: "UPDATE luxy_canva_auth SET access_token=?, expires_in=?, created_at=datetime('now') WHERE id=1",
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

// Upload image to Canva assets via the async job endpoint
async function uploadToCanva(imageUrl, token) {
  try {
    const img = await fetch(imageUrl, { headers: { "User-Agent": "VMScout/1.0" } });
    if (!img.ok) return null;
    const buf         = await img.arrayBuffer();
    const contentType = img.headers.get("content-type") || "image/jpeg";
    const nameMeta    = JSON.stringify({ name_base64: Buffer.from("luxy-bg.jpg").toString("base64") });

    const r = await fetch(`${CANVA_API}/asset-uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        "Asset-Upload-Metadata": nameMeta,
      },
      body: buf,
    });
    const d = await r.json();
    return d.job?.id || null;
  } catch { return null; }
}

// ─── handler ────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { caption, search_query, format = "post" } = req.body;
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

    // 1. Fetch matching Pexels photo
    const imageUrl = search_query ? await fetchPexelsUrl(search_query, vertical) : null;

    // 2. Upload image to the user's Canva asset library (async job — appears in Assets panel)
    if (imageUrl) uploadToCanva(imageUrl, token); // fire-and-forget; don't block response

    // 3. Return template edit link so user can open and place the image
    const designId = TEMPLATE_IDS[format] || TEMPLATE_IDS.post;
    const editUrl  = `https://www.canva.com/design/${designId}/edit`;

    return res.status(200).json({ ok: true, url: editUrl, imageUrl });

  } catch (err) {
    console.error("[canva-create]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
