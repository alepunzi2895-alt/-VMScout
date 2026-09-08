// /api/instagram.js — Vercel Serverless Function
//
// Due usi in un solo file (limite di 12 Serverless Functions sul deploy):
//  1. Proxy generico Instagram/Facebook Graph API — POST { token, path, params }.
//     Il token viene dal client (IGAA… su graph.instagram.com, EAA… su
//     graph.facebook.com) e non è mai esposto a terzi.
//  2. Collegamento Facebook per la Marketing API (analisi sponsorizzate):
//     GET ?action=fb_login|fb_status|fb_logout + callback OAuth (rilevato dal
//     parametro `code`), e POST { fb_action: "adaccounts" | "ads" } che usa il
//     token FB salvato server-side in `fb_auth`.
//
// Meta espone due famiglie di token NON intercambiabili tra host:
// - "IGAA…" — Instagram API with Instagram Login → graph.instagram.com
// - "EAA…"  — token utente/Pagina (Facebook Login) → graph.facebook.com
function graphHostFor(token) {
  return /^IGAA/i.test(token) ? "https://graph.instagram.com/v20.0" : "https://graph.facebook.com/v20.0";
}

import { getDb, ensureFbAuthTable } from "./db.js";

const FB_GRAPH   = "https://graph.facebook.com/v20.0";
const fbAppId    = process.env.FB_APP_ID     || process.env.VITE_FB_APP_ID     || "";
const fbSecret   = process.env.FB_APP_SECRET || process.env.VITE_FB_APP_SECRET || "";
const fbRedirect = process.env.FB_REDIRECT_URI || "https://vmscout.vercel.app/api/instagram";
// Scope minimo per leggere account pubblicitari, campagne, adset (targeting) e
// insights. ads_read è sufficiente in sola lettura.
const FB_SCOPE = "ads_read";

const INVISIBLE = new RegExp("[\\u200B\\u200C\\u200D\\uFEFF\\u00A0\\s]", "g");

function sanitizeToken(raw) {
  return (raw || "").replace(INVISIBLE, "");
}

async function getFbToken(db) {
  await ensureFbAuthTable(db);
  const r = await db.execute("SELECT access_token, created_at, expires_in FROM fb_auth WHERE id=1");
  if (!r.rows.length) { const e = new Error("FB_NOT_CONNECTED"); e.code = "FB_NOT_CONNECTED"; throw e; }
  return r.rows[0].access_token;
}

// Chiamata alla Graph API di Facebook col token FB salvato. `path` senza slash
// iniziale; `params` come oggetto piatto.
async function fbGraph(token, path, params = {}) {
  const url = new URL(`${FB_GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString());
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function page(title, body, accent = "#C9A96E") {
  return `<!DOCTYPE html><html><head><title>${title}</title></head>
<body style="background:#141414;color:${accent};font-family:sans-serif;text-align:center;padding-top:18%">
  <h2>${title}</h2><p style="color:#8A8070">${body}</p>
  <script>window.opener?.postMessage('fb_connected','*');setTimeout(()=>window.close(),2200);</script>
</body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = req.query?.action;
  const code   = req.query?.code;

  // ─────────────────────────────────────────────────────────────
  // GET — collegamento Facebook (OAuth) + stato
  // ─────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (action === "fb_status") {
      try {
        const db = getDb();
        await ensureFbAuthTable(db);
        const r = await db.execute("SELECT created_at, expires_in FROM fb_auth WHERE id=1");
        if (!r.rows.length) return res.status(200).json({ connected: false });
        const ageDays = (Date.now() - new Date(r.rows[0].created_at + "Z").getTime()) / 86400000;
        const leftDays = Math.max(0, Math.round((r.rows[0].expires_in || 5184000) / 86400 - ageDays));
        return res.status(200).json({ connected: true, since: r.rows[0].created_at, expires_in_days: leftDays });
      } catch { return res.status(200).json({ connected: false }); }
    }

    if (action === "fb_logout") {
      try { const db = getDb(); await db.execute("DELETE FROM fb_auth WHERE id=1"); } catch {}
      res.setHeader("Set-Cookie", "fb_oauth_state=; HttpOnly; Max-Age=0; Path=/");
      return res.status(200).json({ ok: true });
    }

    if (action === "fb_login") {
      if (!fbAppId) return res.status(500).json({ error: "FB_APP_ID non configurato su Vercel" });
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      res.setHeader("Set-Cookie", `fb_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`);
      const url = new URL("https://www.facebook.com/v20.0/dialog/oauth");
      url.searchParams.set("client_id", fbAppId);
      url.searchParams.set("redirect_uri", fbRedirect);
      url.searchParams.set("scope", FB_SCOPE);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      return res.redirect(url.toString());
    }

    // Callback OAuth: Facebook rimanda a fbRedirect con ?code&state
    if (code) {
      const cookies = req.headers.cookie || "";
      const m = cookies.match(/fb_oauth_state=([^;]+)/);
      if (!m || m[1] !== req.query.state) {
        return res.status(400).send(page("Sessione scaduta", "Riprova il collegamento da VMScout.", "#E88"));
      }
      try {
        // 1. code → token breve
        const short = await fbGraph("", "oauth/access_token", {
          client_id: fbAppId, client_secret: fbSecret, redirect_uri: fbRedirect, code,
        });
        if (!short.data?.access_token) {
          return res.status(400).send(page("Errore", short.data?.error?.message || "Scambio token fallito.", "#E88"));
        }
        // 2. token breve → token long-lived (~60 giorni)
        const long = await fbGraph("", "oauth/access_token", {
          grant_type: "fb_exchange_token", client_id: fbAppId, client_secret: fbSecret,
          fb_exchange_token: short.data.access_token,
        });
        const finalToken = long.data?.access_token || short.data.access_token;
        const expires = long.data?.expires_in || 5184000;

        const db = getDb();
        await ensureFbAuthTable(db);
        await db.execute({
          sql: `INSERT INTO fb_auth (id, access_token, expires_in) VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, expires_in=excluded.expires_in, created_at=datetime('now')`,
          args: [finalToken, expires],
        });
        res.setHeader("Set-Cookie", "fb_oauth_state=; HttpOnly; Max-Age=0; Path=/");
        return res.status(200).send(page("✓ Facebook collegato", "Puoi chiudere questa finestra e tornare a VMScout."));
      } catch (e) {
        return res.status(500).send(page("Errore", e.message, "#E88"));
      }
    }

    return res.status(400).json({ error: "Azione GET non valida" });
  }

  // ─────────────────────────────────────────────────────────────
  // POST — dati sponsorizzate (fb_action) oppure proxy Graph generico
  // ─────────────────────────────────────────────────────────────
  const body = req.body || {};

  if (body.fb_action) {
    // Collegamento via token incollato (fallback all'OAuth): scambia per un
    // long-lived e lo salva come farebbe il callback.
    if (body.fb_action === "connect_token") {
      const pasted = (body.token || "").replace(INVISIBLE, "").replace(/^Bearer\s+/i, "");
      if (!pasted) return res.status(400).json({ error: "Token mancante" });
      try {
        let finalToken = pasted, expires = null;
        if (fbAppId && fbSecret) {
          const ex = await fbGraph(null, "oauth/access_token", {
            grant_type: "fb_exchange_token", client_id: fbAppId, client_secret: fbSecret, fb_exchange_token: pasted,
          });
          if (ex.data?.access_token) { finalToken = ex.data.access_token; expires = ex.data.expires_in || null; }
        }
        // Valida: deve poter leggere gli account pubblicitari.
        const check = await fbGraph(finalToken, "me/adaccounts", { fields: "id", limit: 1 });
        if (!check.ok) {
          return res.status(400).json({ error: check.data?.error?.message || "Token non valido o senza permesso ads_read." });
        }
        const db = getDb();
        await ensureFbAuthTable(db);
        await db.execute({
          sql: `INSERT INTO fb_auth (id, access_token, expires_in) VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, expires_in=excluded.expires_in, created_at=datetime('now')`,
          args: [finalToken, expires],
        });
        return res.status(200).json({ ok: true, long_lived: expires != null, expires_in: expires });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    let token;
    try { token = await getFbToken(getDb()); }
    catch (e) { return res.status(401).json({ error: e.code || "FB_NOT_CONNECTED", message: "Collega Facebook per le sponsorizzate." }); }

    try {
      if (body.fb_action === "adaccounts") {
        const r = await fbGraph(token, "me/adaccounts", { fields: "id,name,currency,account_status,timezone_name", limit: 50 });
        if (!r.ok) return res.status(r.status).json({ error: r.data?.error?.message || "Errore Meta", details: r.data });
        return res.status(200).json({ ok: true, accounts: r.data.data || [] });
      }

      if (body.fb_action === "ads") {
        const acct = String(body.ad_account_id || "").replace(/^act_/, "");
        if (!acct) return res.status(400).json({ error: "Manca ad_account_id" });
        const datePreset = body.date_preset || "last_90d";
        // Ads + adset (targeting) + creative + insights aggregati.
        const fields = [
          "name", "effective_status", "created_time",
          "adset{name,daily_budget,lifetime_budget,start_time,end_time,targeting}",
          "creative{name,title,body,object_type,instagram_permalink_url,thumbnail_url,image_url,effective_object_story_id,effective_instagram_media_id,object_story_spec}",
          `insights.date_preset(${datePreset}){spend,reach,impressions,clicks,ctr,cpc,frequency,actions,cost_per_action_type}`,
        ].join(",");
        const r = await fbGraph(token, `act_${acct}/ads`, { fields, limit: body.limit || 50 });
        if (!r.ok) return res.status(r.status).json({ error: r.data?.error?.message || "Errore Meta", details: r.data });
        return res.status(200).json({ ok: true, ads: r.data.data || [], paging: r.data.paging || null });
      }

      return res.status(400).json({ error: "fb_action sconosciuta" });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Proxy Graph generico (comportamento storico) ──
  const { token: rawToken, path, params = {} } = body;
  const token = sanitizeToken(rawToken);
  if (!token) return res.status(400).json({ error: "Token mancante" });
  if (!path) return res.status(400).json({ error: "Path mancante" });

  const url = new URL(`${graphHostFor(token)}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
