// /api/canva-token.js — punto UNICO di lettura/rinnovo del token OAuth Canva.
//
// Perché esiste: Canva RUOTA il refresh_token a ogni chiamata /oauth/token.
// La risposta del refresh contiene un NUOVO refresh_token e quello usato viene
// invalidato subito. Se un endpoint rinnova l'access_token ma NON ripersiste il
// nuovo refresh_token (com'era in canva-create / canva-carousel / canva-scaffold
// / canva-export), il refresh successivo fallisce → si ricade sull'access_token
// scaduto → Canva risponde "Access token is invalid".
//
// Tutti gli endpoint Canva devono importare getCanvaToken da qui.

import { ensureCanvaAuthTable } from "./db.js";

const CANVA_API = "https://api.canva.com/rest/v1";

function notConnected(msg = "CANVA_NOT_CONNECTED") {
  const e = new Error(msg);
  e.code = "CANVA_NOT_CONNECTED";
  return e;
}

export async function getCanvaToken(db) {
  await ensureCanvaAuthTable(db);
  const r = await db.execute(
    "SELECT access_token, refresh_token, expires_in, created_at FROM canva_auth WHERE id=1"
  );
  if (!r.rows.length) throw notConnected();

  const row    = r.rows[0];
  const ageS   = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  const expiry = row.expires_in || 3600;

  // Ancora valido (con margine di 120s): usa l'access_token corrente.
  if (ageS <= expiry - 120 || !row.refresh_token) return row.access_token;

  // Vicino alla scadenza → refresh + rotazione refresh_token.
  const clientId     = process.env.CANVA_CLIENT_ID     || process.env.VITE_CANVA_CLIENT_ID     || "";
  const clientSecret = process.env.CANVA_CLIENT_SECRET || process.env.VITE_CANVA_CLIENT_SECRET || "";
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let td = {};
  try {
    const tr = await fetch(`${CANVA_API}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${creds}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
    });
    td = await tr.json().catch(() => ({}));
  } catch (e) {
    // Errore di rete: prova comunque con l'access_token esistente.
    return row.access_token;
  }

  if (!td.access_token) {
    // Il refresh_token è morto (già ruotato altrove, revocato o scaduto):
    // niente da fare se non riconnettere Canva.
    throw notConnected("CANVA_TOKEN_EXPIRED");
  }

  await db.execute({
    sql: "UPDATE canva_auth SET access_token=?, refresh_token=?, expires_in=?, created_at=datetime('now') WHERE id=1",
    args: [td.access_token, td.refresh_token || row.refresh_token, td.expires_in || 3600],
  });
  return td.access_token;
}
