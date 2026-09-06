// /api/canva-scaffold.js — crea una bozza di design VUOTA nell'account Canva
// collegato, alla dimensione giusta per il formato scelto. Serve solo a far
// risparmiare il passaggio "Nuovo design → imposta dimensioni": l'utente apre
// il link, aggiunge foto/testo e li collega ai campi Autofill (quel passaggio
// è editor-only, l'API di Canva non lo espone).

import { getDb, ensureCanvaAuthTable } from "./db.js";

const CANVA_API = "https://api.canva.com/rest/v1";

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
    token = await getToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso. Clicca 'Connetti Canva'." });
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
