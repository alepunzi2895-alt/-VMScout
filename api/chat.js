// /api/chat.js — Vercel Serverless Function
// Proxy sicuro per l'API Anthropic: la key resta server-side

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // limite Anthropic per immagine

// Scarica ed encoda in base64 le immagini lato server (niente CORS, a differenza
// di un fetch dal browser verso CDN come *.cdninstagram.com) così Claude può
// analizzarle visivamente (stile, storytelling) insieme al testo della richiesta.
async function fetchImageBlock(url) {
  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) return null;
    const contentType = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    return { type: "image", source: { type: "base64", media_type: contentType, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  try {
    const { system, messages, images } = req.body;

    let finalMessages = messages;
    if (Array.isArray(images) && images.length && messages?.[0]) {
      const blocks = (await Promise.all(images.slice(0, MAX_IMAGES).map(fetchImageBlock))).filter(Boolean);
      if (blocks.length) {
        const [firstMsg, ...rest] = messages;
        const textContent = typeof firstMsg.content === "string" ? firstMsg.content : "";
        finalMessages = [{ role: firstMsg.role, content: [...blocks, { type: "text", text: textContent }] }, ...rest];
      }
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system,
        messages: finalMessages,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
