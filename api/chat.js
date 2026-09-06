// /api/chat.js — Vercel Serverless Function
// Proxy sicuro per l'API Anthropic: la key resta server-side

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // limite Anthropic per immagine
const IMAGE_FETCH_TIMEOUT_MS = 12000;
const ANTHROPIC_TIMEOUT_MS = 45000; // margine sotto maxDuration:60 di vercel.json

// Le foto Instagram reali (media_url) sono spesso piene risoluzioni da centinaia
// di KB a qualche MB — su 4-5 immagini + inflazione ~33% del base64 diventa un
// payload multi-MB che rallenta sia l'upload sia l'elaborazione visiva di Claude
// (causa più probabile dei timeout). wsrv.nl è un proxy di resize pubblico e
// gratuito (nessuna dipendenza npm, nessuna chiave): richiediamo un JPEG più
// piccolo invece di scaricare l'originale. Se il proxy fallisce, fallback
// sull'URL originale così l'analisi non si rompe del tutto.
function resizedUrl(url) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=900&output=jpg&q=75`;
}

// Scarica ed encoda in base64 le immagini lato server (niente CORS, a differenza
// di un fetch dal browser verso CDN come *.cdninstagram.com) così Claude può
// analizzarle visivamente (stile, storytelling) insieme al testo della richiesta.
// Timeout per immagine: una CDN lenta non deve far scadere l'intera richiesta —
// le immagini vengono comunque scaricate in parallelo (Promise.all), quindi il
// tempo totale della fase resta ~12s anche nel caso peggiore, non 12s × N.
async function fetchImageBlock(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    let imgRes = await fetch(resizedUrl(url), { signal: controller.signal }).catch(() => null);
    if (!imgRes?.ok) imgRes = await fetch(url, { signal: controller.signal });
    if (!imgRes.ok) return null;
    const contentType = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    return { type: "image", source: { type: "base64", media_type: contentType, data: buf.toString("base64") } };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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

  const t0 = Date.now();
  try {
    const { system, messages, images } = req.body;

    let finalMessages = messages;
    if (Array.isArray(images) && images.length && messages?.[0]) {
      const blocks = (await Promise.all(images.slice(0, MAX_IMAGES).map(fetchImageBlock))).filter(Boolean);
      console.log(`[chat] immagini: ${blocks.length}/${images.length} incluse in ${Date.now() - t0}ms`);
      if (blocks.length) {
        const [firstMsg, ...rest] = messages;
        const textContent = typeof firstMsg.content === "string" ? firstMsg.content : "";
        finalMessages = [{ role: firstMsg.role, content: [...blocks, { type: "text", text: textContent }] }, ...rest];
      }
    }

    // Timeout esplicito sulla chiamata Anthropic: se il gateway Vercel taglia la
    // funzione a maxDuration (504, body vuoto/illeggibile) il client non capisce
    // cos'è successo. Abortendo prima (con margine) restituiamo invece un JSON
    // pulito con un messaggio comprensibile.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
    const tAnthropicStart = Date.now();
    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
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
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        console.error(`[chat] timeout Anthropic dopo ${Date.now() - tAnthropicStart}ms (totale ${Date.now() - t0}ms)`);
        return res.status(504).json({ error: "Claude sta impiegando troppo tempo a rispondere. Riprova (con meno immagini se il problema persiste)." });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    console.log(`[chat] risposta Anthropic in ${Date.now() - tAnthropicStart}ms (totale ${Date.now() - t0}ms), status ${response.status}`);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error(`[chat] errore dopo ${Date.now() - t0}ms:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
