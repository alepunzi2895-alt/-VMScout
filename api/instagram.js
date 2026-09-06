// /api/instagram.js — Vercel Serverless Function
// Proxy per Instagram Graph API: il token viene dal client ma non è mai esposto a terzi
//
// Meta espone due famiglie di token che NON sono intercambiabili tra host:
// - "IGAA…" — Instagram API with Instagram Login (token diretto, no Facebook Page):
//   va usato su graph.instagram.com. Usarlo su graph.facebook.com produce
//   esattamente l'errore "Invalid OAuth access token - Cannot parse access token"
//   perché quell'host non sa nemmeno interpretare il formato del token.
// - "EAA…" — token utente/Pagina da Graph API Explorer (flusso legacy Facebook
//   Login + Page collegata): va usato su graph.facebook.com.
function graphHostFor(token) {
  return /^IGAA/i.test(token) ? "https://graph.instagram.com/v20.0" : "https://graph.facebook.com/v20.0";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token: rawToken, path, params = {} } = req.body || {};

  // Difesa in profondità: rimuove spazi/newline/caratteri invisibili nel caso
  // il client non li abbia già ripuliti. Facebook risponde "Cannot parse access
  // token" se anche un solo carattere estraneo finisce nella stringa del token.
  const token = (rawToken || "").replace(/[\u200B\u200C\u200D\uFEFF\u00A0\s]/g, "");

  if (!token) return res.status(400).json({ error: "Token mancante" });
  if (!path) return res.status(400).json({ error: "Path mancante" });

  const url = new URL(`${graphHostFor(token)}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
