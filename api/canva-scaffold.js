// /api/canva-scaffold.js — crea una bozza di design VUOTA nell'account Canva
// collegato, alla dimensione giusta per il formato scelto. Serve solo a far
// risparmiare il passaggio "Nuovo design → imposta dimensioni": l'utente apre
// il link, aggiunge foto/testo e li collega ai campi Autofill (quel passaggio
// è editor-only, l'API di Canva non lo espone).

import { getDb } from "./db.js";
import { getCanvaToken } from "./canva-token.js";

const CANVA_API = "https://api.canva.com/rest/v1";

const DIMENSIONS = {
  post: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  reel: { width: 1080, height: 1920 },
  carousel: { width: 1080, height: 1080 },
};

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const db = getDb();
  let token;
  try {
    token = await getCanvaToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva." });
  }

  const format = (req.query.format || "post").toLowerCase();
  const dims = DIMENSIONS[format] || DIMENSIONS.post;

  try {
    const r = await fetch(`${CANVA_API}/designs`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ design_type: { type: "custom", width: dims.width, height: dims.height } }),
    });
    const d = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: true, message: d.message || "Errore Canva Create Design API", details: d });
    }

    const editUrl = d.design?.urls?.edit_url || (d.design?.id ? `https://www.canva.com/design/${d.design.id}/edit` : null);
    return res.status(200).json({ ok: true, designId: d.design?.id, editUrl });
  } catch (err) {
    console.error("[canva-scaffold]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
