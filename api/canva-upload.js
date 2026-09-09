import { Readable } from "node:stream";
import { getDb } from "./db.js";
import { getCanvaToken, bustedUrl, startBytesUpload, checkImageUpload } from "./canva-lib.js";

const CANVA_API_BASE = "https://api.canva.com/rest/v1";

async function createUploadJob(token, assetName, url) {
  const r = await fetch(`${CANVA_API_BASE}/url-asset-uploads`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: assetName, url }),
  });
  const d = await r.json().catch(() => ({}));
  return { r, d };
}

function nameWithExt(name, url) {
  const p = (url || "").split("?")[0].toLowerCase();
  if (p.endsWith(".mp4") || p.endsWith(".mov") || p.includes("video-files")) return name + ".mp4";
  if (p.endsWith(".png"))  return name + ".png";
  if (p.endsWith(".webp")) return name + ".webp";
  return name + ".jpg";
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export default async function handler(req, res) {
  // ── GET ?src=<url> → proxy STREAMING di un video (Pexels blocca l'hotlink
  //    dal browser). Inoltra il Range e fa da passthrough dello stream, così
  //    <video> può fare seeking senza bufferare tutto. ──
  if (req.method === "GET") {
    const src = req.query.src;
    if (!src || !/^https?:\/\//i.test(src)) return res.status(400).json({ error: "src mancante o non valido" });
    try {
      const host = new URL(src).hostname;
      const ref = host.includes("pexels") ? "https://www.pexels.com/"
        : host.includes("pixabay") ? "https://pixabay.com/"
        : undefined;
      const h = { "User-Agent": BROWSER_UA, "Accept": "video/mp4,video/*,*/*;q=0.8", ...(ref ? { Referer: ref } : {}) };
      if (req.headers.range) h.Range = req.headers.range;
      const up = await fetch(src, { headers: h });
      if (!up.ok && up.status !== 206) return res.status(502).json({ error: `sorgente ${up.status}` });
      res.status(up.status);
      for (const k of ["content-type", "content-length", "content-range", "last-modified", "etag"]) {
        const v = up.headers.get(k);
        if (v) res.setHeader(k, v);
      }
      // il browser abilita il seeking del <video> solo se vede Accept-Ranges;
      // Pexels non sempre lo manda ma onora comunque il Range (risponde 206).
      res.setHeader("Accept-Ranges", up.headers.get("accept-ranges") || "bytes");
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (!up.body) return res.end(Buffer.from(await up.arrayBuffer()));
      Readable.fromWeb(up.body).pipe(res);
      return;
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { url, b64, name = "vmscout-media" } = req.body || {};
  if (!url && !b64) return res.status(400).json({ error: "Manca url o b64" });

  const db = getDb();
  let token;
  try {
    token = await getCanvaToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso o sessione scaduta. Disconnetti e riconnetti Canva." });
  }

  try {
    // ── A) Byte in base64 (es. clip video ritagliata nel browser) ──
    if (b64) {
      let bytes;
      try {
        bytes = Buffer.from(String(b64).replace(/^data:[^,]+,/, ""), "base64");
      } catch { return res.status(400).json({ error: true, message: "b64 non valido" }); }
      const start = await startBytesUpload({ token, bytes, name: String(name).endsWith(".mp4") ? name : name + ".mp4" });
      if (start.assetId) return res.status(200).json({ ok: true, assetId: start.assetId });
      if (start.error) return res.status(start.stop ? 401 : 500).json({ error: true, message: start.error });
      // poll del job binario
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2500));
        const c = await checkImageUpload({ token, jobId: start.jobId });
        if (c.assetId) return res.status(200).json({ ok: true, assetId: c.assetId });
        if (c.error) return res.status(500).json({ error: true, message: c.error });
      }
      return res.status(202).json({ pending: true, jobId: start.jobId });
    }

    // ── B) Import da URL (comportamento storico) ──────────────────
    const assetName = nameWithExt(name, url);
    let { r, d } = await createUploadJob(token, assetName, url);

    if (!r.ok && /already exist|duplicate/.test(`${d?.code || ""} ${d?.message || ""}`.toLowerCase())) {
      const busted = bustedUrl(url);
      if (busted) ({ r, d } = await createUploadJob(token, assetName, busted));
    }
    if (!r.ok) {
      return res.status(r.status).json({ error: true, message: d.message || d.code || JSON.stringify(d).slice(0, 300) });
    }

    const jobId = d.job?.id;
    if (!jobId) return res.status(500).json({ error: true, message: "No jobId returned by Canva" });

    const deadline = Date.now() + 20_000;
    let job = d.job;
    while (job.status === "in_progress" && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      const poll = await fetch(`${CANVA_API_BASE}/url-asset-uploads/${jobId}`, { headers: { "Authorization": `Bearer ${token}` } });
      const pd = await poll.json();
      job = pd.job ?? job;
    }
    if (job.status === "failed") {
      return res.status(500).json({ error: true, message: job.error?.message || job.error?.code || "Import failed" });
    }
    const assetId = job.asset?.id;
    if (assetId) {
      try {
        await fetch(`${CANVA_API_BASE}/folders/move`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ to_folder_id: "uploads", item_id: assetId }),
        });
      } catch { /* non-fatal */ }
    }
    return res.status(200).json({ ok: true, jobId, status: job.status, assetId });

  } catch (err) {
    console.error("[canva-upload] exception", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
