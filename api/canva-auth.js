import { getDb } from "./db.js";
import crypto from "crypto";

const clientId     = process.env.CANVA_CLIENT_ID     || process.env.VITE_CANVA_CLIENT_ID     || "";
const clientSecret = process.env.CANVA_CLIENT_SECRET || process.env.VITE_CANVA_CLIENT_SECRET || "";
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

  // ── Status check ────────────────────────────────
  if (action === "status") {
    try {
      const db = getDb();
      const r = await db.execute("SELECT created_at FROM luxy_canva_auth WHERE id=1");
      if (r.rows.length) return res.status(200).json({ connected: true, since: r.rows[0].created_at });
      return res.status(200).json({ connected: false });
    } catch {
      return res.status(200).json({ connected: false });
    }
  }

  // ── Logout ──────────────────────────────────────
  if (action === "logout") {
    try {
      const db = getDb();
      await db.execute("DELETE FROM luxy_canva_auth WHERE id=1");
    } catch {}
    res.setHeader("Set-Cookie", "canva_verifier=; HttpOnly; Max-Age=0; Path=/");
    return res.status(200).json({ ok: true });
  }

  // ── Step 1: redirect to Canva consent ───────────
  if (action === "login") {
    if (!clientId) return res.status(500).json({ error: "CANVA_CLIENT_ID non configurato" });

    const verifier   = genVerifier();
    const challenge  = genChallenge(verifier);

    res.setHeader(
      "Set-Cookie",
      `canva_verifier=${verifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`
    );

    const url = new URL("https://www.canva.com/api/oauth/authorize");
    url.searchParams.set("client_id",             clientId);
    url.searchParams.set("response_type",         "code");
    url.searchParams.set("redirect_uri",          redirectUri);
    url.searchParams.set("scope",                 "design:content:write asset:write design:meta:read");
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge",        challenge);

    return res.redirect(url.toString());
  }

  // ── Step 2: OAuth callback ───────────────────────
  if (code) {
    const cookies       = req.headers.cookie || "";
    const verifierMatch = cookies.match(/canva_verifier=([^;]+)/);

    if (!verifierMatch) {
      return res.status(400).send(errorPage("Sessione scaduta o cookie non trovato. Riprova il login."));
    }
    const verifier = verifierMatch[1];

    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    try {
      const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type":  "application/x-www-form-urlencoded",
          "Authorization": `Basic ${creds}`,
        },
        body: new URLSearchParams({
          grant_type:    "authorization_code",
          code,
          redirect_uri:  redirectUri,
          code_verifier: verifier,
        }),
      });

      const data = await tokenRes.json();

      if (data.access_token) {
        const db = getDb();
        await db.execute({
          sql: `INSERT INTO luxy_canva_auth (id, access_token, refresh_token, expires_in)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  access_token  = excluded.access_token,
                  refresh_token = excluded.refresh_token,
                  expires_in    = excluded.expires_in,
                  created_at    = datetime('now')`,
          args: [data.access_token, data.refresh_token || "", data.expires_in || 3600],
        });

        res.setHeader("Set-Cookie", "canva_verifier=; HttpOnly; Max-Age=0; Path=/");
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
