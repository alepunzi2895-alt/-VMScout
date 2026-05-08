import { getDb } from "./db.js";

const clientId     = process.env.CANVA_CLIENT_ID     || process.env.VITE_CANVA_CLIENT_ID     || "";
const clientSecret = process.env.CANVA_CLIENT_SECRET || process.env.VITE_CANVA_CLIENT_SECRET || "";

async function refreshAccessToken(db, refreshToken) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${creds}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.message || "Token refresh fallito");

  await db.execute({
    sql: `UPDATE luxy_canva_auth
          SET access_token=?, expires_in=?, created_at=datetime('now')
          WHERE id=1`,
    args: [data.access_token, data.expires_in || 3600],
  });
  return data.access_token;
}

async function uploadImageFromUrl(imageUrl, accessToken) {
  try {
    const imgRes = await fetch(imageUrl, { headers: { "User-Agent": "VMScout/1.0" } });
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer      = await imgRes.arrayBuffer();
    const blob        = new Blob([buffer], { type: contentType });

    const form = new FormData();
    form.append("asset", blob, "luxy-content.jpg");

    const uploadRes = await fetch("https://api.canva.com/rest/v1/asset/uploads", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${accessToken}` },
      body:    form,
    });
    if (!uploadRes.ok) return null;

    const uploadData = await uploadRes.json();
    return uploadData.asset?.id || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { caption, imageUrl, templateId, hashtags, cta } = req.body;

  if (!templateId || templateId.startsWith("INSERISCI") || templateId.startsWith("METTI")) {
    return res.status(400).json({
      error: "TEMPLATE_NOT_SET",
      message: "Configura il Template ID Canva nella sezione Brand Memory → Canva.",
    });
  }

  const db = getDb();
  let authRow;

  try {
    authRow = await db.execute(
      "SELECT access_token, refresh_token, expires_in, created_at FROM luxy_canva_auth WHERE id=1"
    );
  } catch {
    return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: "Canva non connesso." });
  }

  if (!authRow.rows.length) {
    return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: "Canva non connesso. Clicca 'Connetti Canva' nell'header." });
  }

  let { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, created_at: createdAt } = authRow.rows[0];

  // Auto-refresh if token is close to expiry
  const ageSeconds = (Date.now() - new Date(createdAt + "Z").getTime()) / 1000;
  if (ageSeconds > (expiresIn || 3600) - 120 && refreshToken) {
    try {
      accessToken = await refreshAccessToken(db, refreshToken);
    } catch {
      return res.status(401).json({ error: "CANVA_TOKEN_EXPIRED", message: "Token Canva scaduto. Rieffettua il login." });
    }
  }

  try {
    const autofillData = {};

    // Text fields
    if (caption) {
      autofillData["Testo_Post"]    = { type: "text", text: caption };
      autofillData["Caption"]       = { type: "text", text: caption };
    }
    if (hashtags) {
      autofillData["Hashtags"]      = { type: "text", text: hashtags };
    }
    if (cta) {
      autofillData["CTA"]           = { type: "text", text: cta };
    }

    // Image upload (only if a real HTTP URL, not a search query)
    if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      const assetId = await uploadImageFromUrl(imageUrl, accessToken);
      if (assetId) {
        autofillData["Immagine_Sfondo"] = { type: "image", asset_id: assetId };
        autofillData["Background"]      = { type: "image", asset_id: assetId };
      }
    }

    const response = await fetch(
      `https://api.canva.com/rest/v1/designs/templates/${templateId}/autofill`,
      {
        method:  "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ data: autofillData }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({
        error:   true,
        message: data.message || "Errore da Canva Autofill API",
        details: data,
      });
    }

    const designId  = data.design?.id;
    const designUrl = data.design?.url || (designId ? `https://www.canva.com/design/${designId}/edit` : null);

    return res.status(200).json({ ok: true, designId, url: designUrl });

  } catch (err) {
    console.error("[canva-export]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
