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

  // ?dataset=<brandTemplateId> → restituisce i nomi dei campi di autofill del
  // Brand Template (per capire come si chiamano i placeholder immagine).
  if (req.query.dataset) {
    const id = String(req.query.dataset).split(/[/?#\s]/)[0];
    const r = await fetch(`${CANVA_API}/brand-templates/${id}/dataset`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    const ds = j?.dataset || {};
    return res.status(200).json({
      ok: r.ok, httpStatus: r.status,
      fields: Object.entries(ds).map(([name, def]) => ({ name, type: def?.type })),
      raw: j,
    });
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

  // 3. poll (ogni 3s, ~45s totali) — mostra ogni stato grezzo
  let job = createBody.job;
  for (let i = 0; i < 15 && (job?.status === "in_progress" || job?.status === "pending"); i++) {
    await new Promise(r => setTimeout(r, 3000));
    const r = await fetch(`${CANVA_API}/asset-uploads/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
    const raw = await r.text();
    let b = {};
    try { b = JSON.parse(raw); } catch { /* non-JSON */ }
    job = b?.job ?? job;
    mark(`poll #${i + 1}`, {
      httpStatus: r.status,
      status: job?.status,
      assetId: job?.asset?.id,
      error: job?.error,
      retryAfter: r.headers.get("retry-after"),
      rawSnippet: r.ok ? undefined : raw.slice(0, 200),
    });
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
