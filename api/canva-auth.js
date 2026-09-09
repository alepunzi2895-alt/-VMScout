import { getDb, ensureAuthTables, getSessionUser, getAppConfig, signValue, verifySignedValue, parseCookies, serializeCookie } from "./db.js";
import crypto from "crypto";

// clientId / clientSecret sono PER-UTENTE (Impostazioni → Canva), con fallback
// alle variabili d'ambiente via getAppConfig(). redirectUri resta unico.
const redirectUri  = process.env.CANVA_REDIRECT_URI  || process.env.VITE_CANVA_REDIRECT_URI  ||
  "https://vmscout.vercel.app/api/canva-auth";

function genVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}
function genChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export default async function handler(req, res) {
  const { action, code } = req.query;
  const db = getDb();

  // ── Status check (per-utente) ────────────────────
  if (action === "status") {
    try {
      const me = await getSessionUser(db, req);
      if (!me) return res.status(200).json({ connected: false });
      const r = await db.execute({ sql: "SELECT created_at FROM canva_auth_u WHERE user_id=?", args: [me.id] });
      if (r.rows.length) return res.status(200).json({ connected: true, since: r.rows[0].created_at });
      return res.status(200).json({ connected: false });
    } catch {
      return res.status(200).json({ connected: false });
    }
  }

  // ── Logout ──────────────────────────────────────
  if (action === "logout") {
    try {
      const me = await getSessionUser(db, req);
      if (me) await db.execute({ sql: "DELETE FROM canva_auth_u WHERE user_id=?", args: [me.id] });
    } catch { /* ignore */ }
    res.setHeader("Set-Cookie", "canva_verifier=; HttpOnly; Max-Age=0; Path=/");
    return res.status(200).json({ ok: true });
  }

  // ── Step 1: redirect to Canva consent ───────────
  if (action === "login") {
    const me = await getSessionUser(db, req);
    if (!me) return res.status(401).send(errorPage("Accedi a VMScout prima di collegare Canva."));
    const { canvaClientId: clientId } = await getAppConfig(db, me.id);
    if (!clientId) return res.status(500).send(errorPage("Client ID Canva non configurato. Vai in Impostazioni → Canva e incolla Client ID e Client Secret della tua app Canva."));

    const verifier  = genVerifier();
    const challenge = genChallenge(verifier);
    const state     = signValue(`${me.id}:${crypto.randomBytes(8).toString("hex")}`);

    res.setHeader("Set-Cookie", [
      serializeCookie("canva_verifier", verifier, { httpOnly: true, secure: true, sameSite: "Lax", maxAge: 600, path: "/" }),
      serializeCookie("canva_state", state, { httpOnly: true, secure: true, sameSite: "Lax", maxAge: 600, path: "/" }),
    ]);

    const url = new URL("https://www.canva.com/api/oauth/authorize");
    url.searchParams.set("client_id",             clientId);
    url.searchParams.set("response_type",         "code");
    url.searchParams.set("redirect_uri",          redirectUri);
    url.searchParams.set("scope",                 "design:content:write design:meta:read asset:read asset:write");
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge",        challenge);
    url.searchParams.set("state",                 state);

    return res.redirect(url.toString());
  }

  // ── Step 2: OAuth callback ───────────────────────
  if (code) {
    const cookies  = parseCookies(req);
    const verifier = cookies.canva_verifier;
    if (!verifier) {
      return res.status(400).send(errorPage("Sessione scaduta o cookie non trovato. Riprova il login."));
    }

    // Quale utente ha avviato il flusso? state firmato (primario) → sessione (fallback).
    let userId = null;
    const stateParam = req.query.state;
    if (stateParam && stateParam === cookies.canva_state) {
      const v = verifySignedValue(stateParam);
      if (v) userId = v.split(":")[0];
    }
    if (!userId) {
      const me = await getSessionUser(db, req);
      userId = me?.id || null;
    }
    if (!userId) {
      return res.status(400).send(errorPage("Sessione VMScout scaduta durante il collegamento. Riprova dall'app."));
    }

    const { canvaClientId: clientId, canvaClientSecret: clientSecret } = await getAppConfig(db, userId);
    if (!clientId || !clientSecret) {
      return res.status(500).send(errorPage("Credenziali Canva mancanti. Vai in Impostazioni → Canva."));
    }
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    try {
      const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${creds}` },
        body: new URLSearchParams({
          grant_type:    "authorization_code",
          code,
          redirect_uri:  redirectUri,
          code_verifier: verifier,
        }),
      });
      const data = await tokenRes.json();

      if (data.access_token) {
        await ensureAuthTables(db);
        await db.execute({
          sql: `INSERT INTO canva_auth_u (user_id, access_token, refresh_token, expires_in)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  access_token  = excluded.access_token,
                  refresh_token = excluded.refresh_token,
                  expires_in    = excluded.expires_in,
                  created_at    = datetime('now')`,
          args: [userId, data.access_token, data.refresh_token || "", data.expires_in || 3600],
        });
        res.setHeader("Set-Cookie", [
          "canva_verifier=; HttpOnly; Max-Age=0; Path=/",
          "canva_state=; HttpOnly; Max-Age=0; Path=/",
        ]);
        return res.status(200).send(successPage());
      }
      return res.status(400).send(errorPage(data.message || "Token exchange fallito. Riprova."));
    } catch (e) {
      return res.status(500).send(errorPage(e.message));
    }
  }

  return res.status(400).json({ error: "Richiesta non valida. Manca action o code." });
}

function successPage() {
  return `<!DOCTYPE html><html><head><title>Canva — OK</title></head>
<body style="background:#141414;color:#C9A96E;font-family:sans-serif;text-align:center;padding-top:20%">
  <h2>✓ Canva collegato!</h2>
  <p style="color:#8A8070">Puoi chiudere questa finestra e tornare a VMScout.</p>
  <script>window.opener?.postMessage('canva_connected','*');setTimeout(()=>window.close(),2000);</script>
</body></html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><title>Canva — Errore</title></head>
<body style="background:#141414;color:#E88;font-family:sans-serif;text-align:center;padding-top:20%">
  <h2>⚠ Errore connessione Canva</h2>
  <p style="color:#8A8070">${msg}</p>
  <p><a href="javascript:window.close()" style="color:#C9A96E">Chiudi</a></p>
</body></html>`;
}
