import { getDb } from "./db.js";

const CANVA_API = "https://api.canva.com/rest/v1";

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

// Canva accepts only clean MIME types without parameters.
// Pexels/CDNs sometimes return "application/octet-stream" or "image/jpeg; charset=utf-8".
function normalizeContentType(raw, url = "") {
  const base = (raw || "").split(";")[0].trim().toLowerCase();
  if (base === "image/jpeg" || base === "image/jpg") return "image/jpeg";
  if (base === "image/png")     return "image/png";
  if (base === "image/webp")    return "image/webp";
  if (base === "image/gif")     return "image/gif";
  if (base === "video/mp4" || base === "video/mpeg" || base === "video/quicktime") return "video/mp4";
  // Fallback: infer from URL path
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".mp4") || u.includes("/videos/")) return "video/mp4";
  if (u.endsWith(".png"))  return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif"))  return "image/gif";
  return "image/jpeg"; // safe default for Pexels photos
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { url, name = "luxy-media" } = req.body;
  if (!url) return res.status(400).json({ error: "Manca url" });

  const db = getDb();
  let token;
  try {
    token = await getToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso." });
  }

  try {
    const mediaRes = await fetch(url, {
      headers: { "User-Agent": "VMScout/1.0" },
    });
    if (!mediaRes.ok) throw new Error(`Download media fallito: ${mediaRes.status}`);

    const rawType    = mediaRes.headers.get("content-type") || "";
    const mimeType   = normalizeContentType(rawType, url);
    const isVideo    = mimeType.startsWith("video/");
    const ext        = isVideo ? ".mp4" : mimeType === "image/png" ? ".png" : ".jpg";

    // Asset-Upload-Metadata: base64-encoded JSON with base64-encoded filename
    const nameMeta = Buffer.from(
      JSON.stringify({ name_base64: Buffer.from(name + ext).toString("base64") })
    ).toString("base64");

    const buf = await mediaRes.arrayBuffer();

    const r = await fetch(`${CANVA_API}/asset-uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType,
        "Asset-Upload-Metadata": nameMeta,
      },
      body: buf,
    });

    const d = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        error: true,
        message: d.message || d.code || JSON.stringify(d),
      });
    }

    return res.status(200).json({ ok: true, jobId: d.job?.id });
  } catch (err) {
    console.error("[canva-upload]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
