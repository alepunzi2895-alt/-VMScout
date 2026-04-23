import { getDb } from "./db.js";

// Endpoint per esportare un design verso Canva tramite Autofill
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { caption, imageUrl, templateId } = req.body;
  if (!templateId) return res.status(400).json({ error: "Manca il Template ID di Canva" });

  const db = getDb();

  try {
    // 1. Check if we have Canva Auth tokens in DB
    let authRow = await db.execute("SELECT access_token, refresh_token FROM luxy_canva_auth WHERE id=1");
    if (!authRow.rows.length) {
      return res.status(401).json({ error: "CANVA_NOT_CONNECTED", message: "Canva non connesso. Effettua il login." });
    }
    
    // NOTA TECNICA: in produzione gestire il refresh del token usando il refresh_token 
    // se expires_in è superato.
    const accessToken = authRow.rows[0].access_token;

    let assetId = null;
    
    // 2. Upload asset se imageUrl è presente
    // Per procedere a questo check, l'account Canva Dev del client deve avere 'asset:write'
    if (imageUrl) {
      /*
      // Implementation draft:
      const imgRes = await fetch(imageUrl);
      const imgBlob = await imgRes.blob();
      
      const form = new FormData();
      form.append('file', imgBlob, 'pexels-asset.jpg');
      
      const uploadRes = await fetch("https://api.canva.com/rest/v1/asset/uploads", {
        method: "POST",
        headers: { "Authorization": \`Bearer \${accessToken}\` },
        body: form
      });
      const uploadData = await uploadRes.json();
      assetId = uploadData.asset.id;
      */
      
      // Placeholder mocking ID in attesa dell'app Canva Dev
      assetId = "placeholder_asset_from_pexels";
    }

    // 3. Call Canva Autofill API
    const autofillPayload = {
      data: {
        // Questi campi devono corrispondere ESATTAMENTE ai nomi field taggati nel template Canva
        "Testo_Post": {
          "type": "text",
          "text": caption || "..."
        }
      }
    };
    
    if (assetId) {
      autofillPayload.data["Immagine_Sfondo"] = {
        "type": "image",
        "asset_id": assetId
      };
    }

    const response = await fetch(`https://api.canva.com/rest/v1/designs/templates/${templateId}/autofill`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(autofillPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: true, message: data.message || "Errore da Canva Autofill" });
    }

    return res.status(200).json({
      ok: true,
      designId: data.design.id,
      url: data.design.url || `https://www.canva.com/design/${data.design.id}/edit`
    });

  } catch (err) {
    console.error("[canva-export]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
