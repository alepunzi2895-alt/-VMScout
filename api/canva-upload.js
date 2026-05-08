import { getDb } from "./db.js";

const CANVA_API_BASE = "https://api.canva.com/rest/v1";

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
    const tr = await fetch(`${CANVA_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${creds}`,
      },
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

function nameWithExt(name, url) {
  const p = (url || "").split("?")[0].toLowerCase();
  if (p.endsWith(".mp4") || p.endsWith(".mov") || p.includes("video-files")) return name + ".mp4";
  if (p.endsWith(".png"))  return name + ".png";
  if (p.endsWith(".webp")) return name + ".webp";
  return name + ".jpg";
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
    const assetName = nameWithExt(name, url);
    console.log("[canva-upload] url-import", { assetName, url: url.slice(0, 80) });

    const r = await fetch(`${CANVA_API_BASE}/url-asset-uploads`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ name: assetName, url }),
    });

    const d = await r.json();

    if (!r.ok) {
      console.error("[canva-upload] error", r.status, JSON.stringify(d).slice(0, 300));
      return res.status(r.status).json({
        error:   true,
        message: d.message || d.code || JSON.stringify(d).slice(0, 300),
      });
    }

    return res.status(200).json({ ok: true, jobId: d.job?.id, status: d.job?.status });

  } catch (err) {
    console.error("[canva-upload] exception", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
