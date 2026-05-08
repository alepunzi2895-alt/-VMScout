import { getDb } from "./db.js";
import https from "https";
import fs from "fs";
import os from "os";
import path from "path";

const CANVA_API_HOST = "api.canva.com";
const CANVA_API_PATH = "/rest/v1/asset-uploads";

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
    const tr = await fetch(`https://${CANVA_API_HOST}/rest/v1/oauth/token`, {
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

// Primary: derive MIME from URL path (more reliable for Pexels CDN)
function mimeFromUrl(url) {
  const p = (url || "").split("?")[0].toLowerCase();
  if (p.endsWith(".mp4") || p.endsWith(".mov") || p.includes("video-files")) return "video/mp4";
  if (p.endsWith(".png"))  return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif"))  return "image/gif";
  return "image/jpeg";
}

// Fallback: parse Content-Type response header
function mimeFromHeader(ct) {
  if (!ct) return null;
  const base = ct.split(";")[0].trim().toLowerCase();
  const known = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/quicktime"];
  return known.includes(base) ? base : null;
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

  const tmpFile = path.join(os.tmpdir(), `luxy-${Date.now()}.tmp`);

  try {
    // ── 1. Download media from Pexels/CDN ─────────────────────
    const mediaRes = await fetch(url, { headers: { "User-Agent": "VMScout/1.0" } });
    if (!mediaRes.ok) throw new Error(`Download fallito: ${mediaRes.status}`);

    // ── 2. Determine MIME type ─────────────────────────────────
    const respCT   = mediaRes.headers.get("content-type");
    const mimeType = mimeFromHeader(respCT) || mimeFromUrl(url);
    const isVideo  = mimeType.startsWith("video/");
    const ext      = isVideo ? ".mp4" : mimeType === "image/png" ? ".png" : ".jpg";

    // ── 3. Write to /tmp ───────────────────────────────────────
    const buf = Buffer.from(await mediaRes.arrayBuffer());
    fs.writeFileSync(tmpFile, buf);
    const fileSize = fs.statSync(tmpFile).size;

    // ── 4. Build Asset-Upload-Metadata header ──────────────────
    // Canva spec: name_base64 = regular base64 (with padding);
    //             outer header = base64url of the JSON object
    const nameB64  = Buffer.from(name + ext).toString("base64");
    const nameMeta = Buffer.from(JSON.stringify({ name_base64: nameB64 })).toString("base64url");

    console.log("[canva-upload] uploading", { mimeType, fileSize, ext });

    // ── 5. Upload via native https.request (no fetch/undici) ───
    const canvaResult = await new Promise((resolve, reject) => {
      const canvaReq = https.request(
        {
          hostname: CANVA_API_HOST,
          path:     CANVA_API_PATH,
          method:   "POST",
          headers: {
            "Authorization":         `Bearer ${token}`,
            "Content-Type":          mimeType,
            "Content-Length":        fileSize,
            "Asset-Upload-Metadata": nameMeta,
          },
        },
        (canvaRes) => {
          let body = "";
          canvaRes.on("data", chunk => { body += chunk; });
          canvaRes.on("end", () => resolve({ status: canvaRes.statusCode, body }));
        }
      );
      canvaReq.on("error", reject);
      fs.createReadStream(tmpFile).pipe(canvaReq);
    });

    // ── 6. Cleanup temp file ───────────────────────────────────
    try { fs.unlinkSync(tmpFile); } catch {}

    let d = {};
    try { d = JSON.parse(canvaResult.body); } catch { d = { raw: canvaResult.body }; }

    if (canvaResult.status >= 400) {
      console.error("[canva-upload] Canva error", canvaResult.status, canvaResult.body.slice(0, 400));
      return res.status(canvaResult.status).json({
        error: true,
        message: d.message || d.code || canvaResult.body.slice(0, 300),
        _debug: { mimeType, fileSize, respCT },
      });
    }

    return res.status(200).json({ ok: true, jobId: d.job?.id });

  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch {}
    console.error("[canva-upload] exception", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
