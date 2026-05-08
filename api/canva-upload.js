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

// Derive MIME type from the URL path — more reliable than response headers
// because Pexels/CDNs can return "application/octet-stream" or add params.
function mimeFromUrl(url) {
  const path = (url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".mp4") || path.endsWith(".mov") || path.includes("video-files"))
    return "video/mp4";
  if (path.endsWith(".png"))  return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif"))  return "image/gif";
  return "image/jpeg"; // Pexels photo default
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
    const mediaRes = await fetch(url, { headers: { "User-Agent": "VMScout/1.0" } });
    if (!mediaRes.ok) throw new Error(`Download media fallito: ${mediaRes.status}`);

    const mimeType = mimeFromUrl(url);
    const isVideo  = mimeType.startsWith("video/");
    const ext      = isVideo ? ".mp4" : mimeType === "image/png" ? ".png" : ".jpg";

    // Canva Connect API spec:
    // - name_base64 : regular base64 (with + / = padding), NOT base64url
    // - Asset-Upload-Metadata header: base64url of the full JSON object
    const nameB64  = Buffer.from(name + ext).toString("base64");
    const nameMeta = Buffer.from(JSON.stringify({ name_base64: nameB64 })).toString("base64url");

    const bodyBuf = Buffer.from(await mediaRes.arrayBuffer());

    const r = await fetch(`${CANVA_API}/asset-uploads`, {
      method: "POST",
      headers: {
        "Authorization":         `Bearer ${token}`,
        "Content-Type":          mimeType,
        "Content-Length":        String(bodyBuf.length),
        "Asset-Upload-Metadata": nameMeta,
      },
      body: bodyBuf,
    });

    const text = await r.text();
    let d = {};
    try { d = JSON.parse(text); } catch { d = { raw: text }; }

    if (!r.ok) {
      console.error("[canva-upload] error", r.status, "mime:", mimeType, "len:", bodyBuf.length, "body:", text.slice(0, 400));
      return res.status(r.status).json({
        error: true,
        message: d.message || d.code || text.slice(0, 300),
        _debug: { mimeType, contentLength: bodyBuf.length },
      });
    }

    return res.status(200).json({ ok: true, jobId: d.job?.id });
  } catch (err) {
    console.error("[canva-upload]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
