// GET /api/canva-test — diagnostica upload immagini su Canva.
// Testa l'upload BINARIO (POST /v1/asset-uploads) end-to-end con una foto di
// prova piccola e riporta ogni risposta grezza di Canva + i tempi, così si vede
// esattamente dove si blocca ("Il design compare senza sfondo" ecc.).

import { getDb } from "./db.js";
import { getCanvaToken } from "./canva-lib.js";

const CANVA_API = "https://api.canva.com/rest/v1";
const TEST_URL = "https://images.pexels.com/photos/3155666/pexels-photo-3155666.jpeg?auto=compress&cs=tinysrgb&w=1280";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  const t0 = Date.now();
  const log = [];
  const mark = (label, extra = {}) => log.push({ label, t_ms: Date.now() - t0, ...extra });

  let token;
  try {
    token = await getCanvaToken(getDb());
    mark("token ok", { preview: token.slice(0, 12) + "…" });
  } catch (e) {
    return res.status(200).json({ ok: false, step: "token", error: e.code || e.message, log });
  }

  // 1. scarica i byte della foto di prova
  let bytes;
  try {
    const imgRes = await fetch(TEST_URL, { headers: { "User-Agent": "VMScout/1.0" } });
    bytes = Buffer.from(await imgRes.arrayBuffer());
    mark("download foto", { httpStatus: imgRes.status, bytes: bytes.length });
  } catch (e) {
    return res.status(200).json({ ok: false, step: "download", error: e.message, log });
  }

  // 2. POST /v1/asset-uploads (binario)
  let jobId, createBody;
  try {
    const r = await fetch(`${CANVA_API}/asset-uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from("vmscout-test", "utf8").toString("base64") }),
      },
      body: bytes,
    });
    createBody = await r.json().catch(() => ({}));
    jobId = createBody?.job?.id;
    mark("create asset-upload", { httpStatus: r.status, ok: r.ok, job: createBody?.job, rateLimit: r.headers.get("retry-after") });
  } catch (e) {
    return res.status(200).json({ ok: false, step: "create", error: e.message, log });
  }
  if (!jobId) {
    return res.status(200).json({ ok: false, step: "create", error: "nessun job.id", createBody, log });
  }

  // 3. poll (max ~40s, ogni 3.5s) — mostra ogni stato
  let job = createBody.job;
  for (let i = 0; i < 12 && (job?.status === "in_progress" || job?.status === "pending"); i++) {
    await new Promise(r => setTimeout(r, 3500));
    const r = await fetch(`${CANVA_API}/asset-uploads/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
    const b = await r.json().catch(() => ({}));
    job = b?.job ?? job;
    mark(`poll #${i + 1}`, { httpStatus: r.status, status: job?.status, assetId: job?.asset?.id, error: job?.error, retryAfter: r.headers.get("retry-after") });
  }

  return res.status(200).json({
    ok: job?.status === "success" && !!job?.asset?.id,
    finalStatus: job?.status,
    assetId: job?.asset?.id || null,
    jobError: job?.error || null,
    total_ms: Date.now() - t0,
    log,
  });
}
