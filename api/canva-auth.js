import { getDb } from "./db.js";

const clientId = process.env.VITE_CANVA_CLIENT_ID || "";
const clientSecret = process.env.VITE_CANVA_CLIENT_SECRET || "";
// The redirect URI configured in Canva Dev Portal must match exactly
const redirectUri = process.env.VITE_CANVA_REDIRECT_URI || "https://vmscout.vercel.app/api/canva-auth";

export default async function handler(req, res) {
  const { action, code } = req.query;

  // 1. Redirect to Canva Consent Screen
  if (action === "login") {
    // In production you MUST generate and store a PKCE code_verifier.
    // For this boilerplate, we use a placeholder "code_challenge" which requires server-side state logic.
    // To implement fully: generate 43-char random string (code_verifier), compute SHA256 base64url (code_challenge).
    // Here we put a placeholder to guide the user:
    const authUrl = `https://www.canva.com/api/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=design:content:write asset:write&code_challenge_method=S256&code_challenge=PLACEHOLDER`; 
    return res.redirect(authUrl);
  }

  // 2. Handle Callback (Receiving "code")
  if (code) {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    try {
      const response = await fetch("https://api.canva.com/rest/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${creds}`
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: "PLACEHOLDER" // Must match the one generated in "login" step
        })
      });
      const data = await response.json();
      
      if (data.access_token) {
        // Save to Turso DB
        const db = getDb();
        await db.execute({
          sql: `INSERT INTO luxy_canva_auth (id, access_token, refresh_token, expires_in) 
                VALUES (1, ?, ?, ?) 
                ON CONFLICT(id) DO UPDATE SET 
                  access_token=excluded.access_token, 
                  refresh_token=excluded.refresh_token, 
                  expires_in=excluded.expires_in, 
                  created_at=datetime('now')`,
          args: [data.access_token, data.refresh_token, data.expires_in]
        });
        return res.status(200).send("<html><body style='background:#141414;color:#C9A96E;font-family:sans-serif;text-align:center;padding-top:20%;'><h2>Canva collegato correttamente!</h2><p>Puoi chiudere questa finestra e tornare a VMScout.</p></body></html>");
      }
      return res.status(400).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Richiesta non valida. Manca action o code." });
}
