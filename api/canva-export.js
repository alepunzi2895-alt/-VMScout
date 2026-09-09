import { getDb, getSessionUser } from "./db.js";
import { getCanvaToken, runAutofill } from "./canva-lib.js";

async function uploadImageFromUrl(imageUrl, accessToken) {
  try {
    const imgRes = await fetch(imageUrl, { headers: { "User-Agent": "VMScout/1.0" } });
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer      = await imgRes.arrayBuffer();
    const blob        = new Blob([buffer], { type: contentType });

    const form = new FormData();
    form.append("asset", blob, "vmscout-content.jpg");

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
  const me = await getSessionUser(db, req);
  if (!me) return res.status(401).json({ error: "AUTH_REQUIRED", message: "Accedi a VMScout." });
  let accessToken;
  try {
    accessToken = await getCanvaToken(db, me.id);
  } catch (e) {
    return res.status(401).json({
      error: e.code || "CANVA_NOT_CONNECTED",
      message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva.",
    });
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

    const af = await runAutofill({ token: accessToken, templateId, data: autofillData, title: (caption || "VMScout").slice(0, 60) });

    if (!af.ok) {
      return res.status(af.status >= 400 && af.status < 600 ? af.status : 400).json({
        error:   true,
        message: af.message,
        details: af.details,
      });
    }

    return res.status(200).json({ ok: true, designId: af.designId, url: af.designUrl });

  } catch (err) {
    console.error("[canva-export]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
