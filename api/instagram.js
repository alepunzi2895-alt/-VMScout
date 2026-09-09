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

import { getDb, ensureAuthTables, getSessionUser, getAppConfig, signValue, verifySignedValue, parseCookies } from "./db.js";

const FB_GRAPH   = "https://graph.facebook.com/v20.0";
// App ID / Secret sono PER-UTENTE (Impostazioni → Facebook), risolti da
// getAppConfig() con fallback alle variabili d'ambiente. redirect unico.
const fbRedirect = process.env.FB_REDIRECT_URI || "https://vmscout.vercel.app/api/instagram";
// Scope minimo per leggere account pubblicitari, campagne, adset (targeting) e
// insights. ads_read è sufficiente in sola lettura.
const FB_SCOPE = "ads_read";

const INVISIBLE = new RegExp("[\\u200B\\u200C\\u200D\\uFEFF\\u00A0\\s]", "g");

function sanitizeToken(raw) {
  return (raw || "").replace(INVISIBLE, "");
}

async function getFbToken(db, userId) {
  await ensureAuthTables(db);
  if (!userId) { const e = new Error("AUTH_REQUIRED"); e.code = "AUTH_REQUIRED"; throw e; }
  const r = await db.execute({ sql: "SELECT access_token, created_at, expires_in FROM fb_auth_u WHERE user_id=?", args: [userId] });
  if (!r.rows.length) { const e = new Error("FB_NOT_CONNECTED"); e.code = "FB_NOT_CONNECTED"; throw e; }
  return r.rows[0].access_token;
}

// Chiamata alla Graph API di Facebook col token FB salvato. `path` senza slash
// iniziale; `params` come oggetto piatto.
async function fbGraph(token, path, params = {}) {
  try {
    const url = new URL(`${FB_GRAPH}/${path}`);
    if (token) url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString());
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: {}, netError: e.message };
  }
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
        const me = await getSessionUser(db, req);
        if (!me) return res.status(200).json({ connected: false });
        const r = await db.execute({ sql: "SELECT created_at, expires_in FROM fb_auth_u WHERE user_id=?", args: [me.id] });
        if (!r.rows.length) return res.status(200).json({ connected: false });
        const ageDays = (Date.now() - new Date(r.rows[0].created_at + "Z").getTime()) / 86400000;
        const leftDays = Math.max(0, Math.round((r.rows[0].expires_in || 5184000) / 86400 - ageDays));
        return res.status(200).json({ connected: true, since: r.rows[0].created_at, expires_in_days: leftDays });
      } catch { return res.status(200).json({ connected: false }); }
    }

    if (action === "fb_logout") {
      try {
        const db = getDb();
        const me = await getSessionUser(db, req);
        if (me) await db.execute({ sql: "DELETE FROM fb_auth_u WHERE user_id=?", args: [me.id] });
      } catch { /* ignore */ }
      res.setHeader("Set-Cookie", "fb_oauth_state=; HttpOnly; Max-Age=0; Path=/");
      return res.status(200).json({ ok: true });
    }

    if (action === "fb_login") {
      const me = await getSessionUser(getDb(), req);
      if (!me) return res.status(401).send(page("Accedi a VMScout", "Effettua il login prima di collegare Facebook.", "#E88"));
      const { fbAppId } = await getAppConfig(getDb(), me.id);
      if (!fbAppId) return res.status(500).send(page("App ID mancante", "Vai in Impostazioni → Facebook e incolla App ID e App Secret della tua app Meta.", "#E88"));
      const state = signValue(`${me.id}:${Math.random().toString(36).slice(2)}`);
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
      const cookies = parseCookies(req);
      if (!cookies.fb_oauth_state || cookies.fb_oauth_state !== req.query.state) {
        return res.status(400).send(page("Sessione scaduta", "Riprova il collegamento da VMScout.", "#E88"));
      }
      let userId = null;
      const v = verifySignedValue(req.query.state);
      if (v) userId = v.split(":")[0];
      if (!userId) { const me = await getSessionUser(getDb(), req); userId = me?.id || null; }
      if (!userId) return res.status(400).send(page("Sessione VMScout scaduta", "Riprova dall'app.", "#E88"));
      const { fbAppId, fbAppSecret: fbSecret } = await getAppConfig(getDb(), userId);
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
        await ensureAuthTables(db);
        await db.execute({
          sql: `INSERT INTO fb_auth_u (user_id, access_token, expires_in) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token, expires_in=excluded.expires_in, created_at=datetime('now')`,
          args: [userId, finalToken, expires],
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
    const me = await getSessionUser(getDb(), req);
    if (!me) return res.status(401).json({ error: "AUTH_REQUIRED", message: "Accedi a VMScout." });

    // Collegamento via token incollato (fallback all'OAuth): scambia per un
    // long-lived e lo salva come farebbe il callback.
    if (body.fb_action === "connect_token") {
      const pasted = (body.token || "").replace(INVISIBLE, "").replace(/^Bearer\s+/i, "");
      if (!pasted) return res.status(400).json({ error: "Token mancante" });
      try {
        const { fbAppId, fbAppSecret: fbSecret } = await getAppConfig(getDb(), me.id);
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
        await ensureAuthTables(db);
        await db.execute({
          sql: `INSERT INTO fb_auth_u (user_id, access_token, expires_in) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token, expires_in=excluded.expires_in, created_at=datetime('now')`,
          args: [me.id, finalToken, expires],
        });
        return res.status(200).json({ ok: true, long_lived: expires != null, expires_in: expires });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    let token;
    try { token = await getFbToken(getDb(), me.id); }
    catch (e) { return res.status(401).json({ error: e.code || "FB_NOT_CONNECTED", message: "Collega Facebook per le sponsorizzate." }); }

    try {
      if (body.fb_action === "adaccounts") {
        const fields = "id,name,currency,account_status";
        // Le promozioni fatte dall'app Instagram girano su un ad account di un
        // Business, spesso NON in me/adaccounts. Raccogliamo da: me/adaccounts +
        // ogni Business dell'utente (<uid>/businesses, non me/businesses che è
        // buggato) → owned_ad_accounts + client_ad_accounts.
        const meR = await fbGraph(token, "me", { fields: "id" });
        const uid = meR.data?.id;
        const [mine, ubiz] = await Promise.all([
          fbGraph(token, "me/adaccounts", { fields, limit: 200 }),
          uid ? fbGraph(token, `${uid}/businesses`, { fields: "id,name", limit: 50 }) : Promise.resolve({ data: {} }),
        ]);
        const byId = new Map();
        const add = a => a?.id && byId.set(a.id, a);
        (mine.data?.data || []).forEach(add);
        const bizIds = (ubiz.data?.data || []).map(b => b.id);
        await Promise.all(bizIds.map(async bid => {
          const [own, cli] = await Promise.all([
            fbGraph(token, `${bid}/owned_ad_accounts`, { fields, limit: 100 }),
            fbGraph(token, `${bid}/client_ad_accounts`, { fields, limit: 100 }),
          ]);
          (own.data?.data || []).forEach(add);
          (cli.data?.data || []).forEach(add);
        }));
        if (!byId.size && !mine.ok) {
          return res.status(mine.status || 400).json({ error: mine.data?.error?.message || "Errore Meta", details: mine.data });
        }
        return res.status(200).json({ ok: true, accounts: [...byId.values()] });
      }

      // Diagnostica: cosa raggiunge questo token FB (per capire se un dato
      // account IG / ad account è visibile).
      if (body.fb_action === "diagnose") {
        const meR = await fbGraph(token, "me", { fields: "id,name" });
        const uid = meR.data?.id;
        const [perms, pages, adAcc] = await Promise.all([
          fbGraph(token, "me/permissions", {}),
          fbGraph(token, "me/accounts", { fields: "id,name,instagram_business_account{username,id},connected_instagram_account{username,id},business", limit: 100 }),
          fbGraph(token, "me/adaccounts", { fields: "name,account_status", limit: 200 }),
        ]);

        const userBizList = uid ? await fbGraph(token, `${uid}/businesses`, { fields: "id,name", limit: 50 }) : { data: {} };

        // Ogni business (dalle Pagine E da <uid>/businesses) interrogato
        // DIRETTAMENTE per i suoi ad account e account IG.
        const bizIds = [...new Set([
          ...(pages.data?.data || []).map(p => p.business?.id),
          ...(userBizList.data?.data || []).map(b => b.id),
        ].filter(Boolean))];
        const bizDetail = await Promise.all(bizIds.map(async bid => {
          const [own, cli, assigned] = await Promise.all([
            fbGraph(token, `${bid}/owned_ad_accounts`, { fields: "name,id,account_status", limit: 50 }),
            fbGraph(token, `${bid}/client_ad_accounts`, { fields: "name,id,account_status", limit: 50 }),
            fbGraph(token, `${bid}/assigned_ad_accounts`, { fields: "name,id,account_status", limit: 50 }),
          ]);
          return {
            id: bid,
            owned_ad_accounts: (own.data?.data || []).map(a => ({ name: a.name, id: a.id })),
            owned_err: own.ok ? null : own.data?.error?.message,
            client_ad_accounts: (cli.data?.data || []).map(a => ({ name: a.name, id: a.id })),
            client_err: cli.ok ? null : cli.data?.error?.message,
            assigned_ad_accounts: (assigned.data?.data || []).map(a => ({ name: a.name, id: a.id })),
            assigned_err: assigned.ok ? null : assigned.data?.error?.message,
          };
        }));
        const personalAct = (adAcc.data?.data || [])[0]?.id;
        const [personalAds, personalActIg, pageIgId] = await Promise.all([
          personalAct ? fbGraph(token, `act_${String(personalAct).replace(/^act_/, "")}/ads`, { fields: "name,effective_status,creative{instagram_permalink_url,object_story_spec{instagram_actor_id},effective_object_story_id}", filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DELETED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS"] }]), limit: 400 }) : Promise.resolve({ data: {} }),
          personalAct ? fbGraph(token, `act_${String(personalAct).replace(/^act_/, "")}/instagram_accounts`, { fields: "username" }) : Promise.resolve({ data: {} }),
          fbGraph(token, `${(pages.data?.data || [])[0]?.instagram_business_account?.id || (pages.data?.data || [])[0]?.id || "0"}`, { fields: "username,id" }),
        ]);
        const personalAdsIgUsers = [...new Set((personalAds.data?.data || []).map(a => {
          const s = String(a.creative?.effective_object_story_id || "").split("_");
          return s[0] || a.creative?.object_story_spec?.instagram_actor_id || null;
        }).filter(Boolean))];

        return res.status(200).json({
          ok: true,
          me: meR.data,
          scopes: (perms.data?.data || []).filter(p => p.status === "granted").map(p => p.permission),
          pages: (pages.data?.data || []).map(p => ({
            page: p.name, page_id: p.id,
            ig: p.instagram_business_account?.username || p.connected_instagram_account?.username || null,
            business: p.business ? { id: p.business.id, name: p.business.name } : null,
          })),
          pages_error: pages.ok ? null : pages.data?.error?.message,
          business_detail: bizDetail,
          user_businesses: (userBizList.data?.data || []),
          user_businesses_error: userBizList.ok ? null : userBizList.data?.error?.message,
          personal_ad_account: personalAct,
          personal_ads_count: (personalAds.data?.data || []).length,
          personal_ads_distinct_page_or_actor_ids: personalAdsIgUsers,
          personal_ads_err: personalAds.ok ? null : personalAds.data?.error?.message,
          personal_act_instagram_accounts: (personalActIg.data?.data || []).map(x => x.username),
          personal_act_ig_err: personalActIg.ok ? null : personalActIg.data?.error?.message,
          ad_accounts: (adAcc.data?.data || []).map(a => ({ name: a.name, id: a.id })),
        });
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
        // IMPORTANTE: act/ads di default ESCLUDE le inserzioni archiviate (le
        // promozioni finiscono archiviate poco dopo la fine). `filtering` con
        // tutti gli stati le riporta dentro.
        const allStatuses = JSON.stringify([{
          field: "ad.effective_status",
          operator: "IN",
          value: ["ACTIVE", "PAUSED", "DELETED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED",
            "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ARCHIVED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"],
        }]);
        const r = await fbGraph(token, `act_${acct}/ads`, { fields, filtering: allStatuses, limit: body.limit || 400 });
        if (!r.ok) return res.status(r.status).json({ error: r.data?.error?.message || "Errore Meta", details: r.data });
        const ads = r.data.data || [];

        // Risolvi a quale account Instagram appartiene ogni ad (per il filtro
        // "solo la pagina del progetto"). Fonti, in ordine: instagram_actor_id
        // del creative → la Pagina FB in effective_object_story_id → il media IG.
        // Deduplicato: di solito è 1-2 Pagine per account pubblicitario.
        const pageIds = [...new Set(ads.map(a => {
          const s = String(a.creative?.effective_object_story_id || "").split("_");
          return s.length === 2 ? s[0] : null;
        }).filter(Boolean))];
        const actorIds = [...new Set(ads.map(a => a.creative?.object_story_spec?.instagram_actor_id || a.creative?.object_story_spec?.instagram_user_id).filter(Boolean))];
        const mediaIds = [...new Set(ads.map(a => a.creative?.effective_instagram_media_id).filter(Boolean))].slice(0, 12);

        const igByPage = {}, igByActor = {}, igByMedia = {};
        await Promise.all([
          ...pageIds.map(async pid => {
            const p = await fbGraph(token, pid, { fields: "name,instagram_business_account{id,username},connected_instagram_account{id,username}" });
            const ig = p.data?.instagram_business_account || p.data?.connected_instagram_account;
            if (ig?.id) igByPage[pid] = { id: ig.id, username: ig.username || null };
          }),
          ...actorIds.map(async aid => {
            const u = await fbGraph(token, aid, { fields: "username" });
            if (u.ok && u.data?.username) igByActor[aid] = { id: aid, username: u.data.username };
          }),
          ...mediaIds.map(async mid => {
            const m = await fbGraph(token, mid, { fields: "username,owner" });
            if (m.ok && m.data?.username) igByMedia[mid] = { id: m.data.owner?.id || mid, username: m.data.username };
          }),
        ]);

        for (const a of ads) {
          const s = String(a.creative?.effective_object_story_id || "").split("_");
          const pid = s.length === 2 ? s[0] : null;
          const aid = a.creative?.object_story_spec?.instagram_actor_id || a.creative?.object_story_spec?.instagram_user_id;
          const mid = a.creative?.effective_instagram_media_id;
          a._ig = (aid && igByActor[aid]) || (pid && igByPage[pid]) || (mid && igByMedia[mid]) || (aid ? { id: aid, username: null } : null);
        }

        return res.status(200).json({ ok: true, ads, paging: r.data.paging || null });
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
