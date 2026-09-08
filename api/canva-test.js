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

  // ?video=<brandTemplateId> — DIAGNOSTICA TEMPORANEA: carica un video Pexels
  // su Canva (url-asset-uploads) e prova l'autofill { type:"video" } nel campo
  // Immagine_Sfondo del template. Serve a capire se l'autofill video (preview
  // feature) funziona per l'account.
  if (req.query.video) {
    const TPL = String(req.query.video).split(/[/?#\s]/)[0];
    const VURL = "https://videos.pexels.com/video-files/3571264/3571264-hd_1080_1920_30fps.mp4"; // ~4MB, portrait
    const dbg = [];
    const g = async (path, init) => {
      const r = await fetch(`${CANVA_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, j };
    };
    // 1) url-asset-uploads del video
    const up = await g(`/url-asset-uploads`, { method: "POST", body: JSON.stringify({ name: "vmscout-test.mp4", url: VURL }) });
    dbg.push({ step: "create url-asset-upload", status: up.status, job: up.j?.job });
    let job = up.j?.job, assetId = job?.asset?.id;
    for (let i = 0; i < 20 && job && (job.status === "in_progress" || job.status === "pending"); i++) {
      await new Promise(r => setTimeout(r, 3000));
      const p = await g(`/url-asset-uploads/${job.id}`);
      job = p.j?.job ?? job;
      assetId = job?.asset?.id;
    }
    dbg.push({ step: "poll upload", finalStatus: job?.status, assetId, error: job?.error });
    if (!assetId) return res.status(200).json({ ok: false, step: "upload video", dbg });
    // 2) autofill { type: "video" }
    const af = await g(`/autofills`, {
      method: "POST",
      body: JSON.stringify({
        type: "create_from_brand_template", brand_template_id: TPL,
        data: {
          Immagine_Sfondo: { type: "video", asset_id: assetId },
          Testo_Post: { type: "text", text: "DBG video reel" },
        },
        title: "DBG video",
      }),
    });
    dbg.push({ step: "create autofill(video)", status: af.status, resp: af.j });
    let aj = af.j?.job ?? af.j;
    for (let i = 0; i < 25 && aj && (aj.status === "in_progress" || aj.status === "pending"); i++) {
      await new Promise(r => setTimeout(r, 3000));
      const p = await g(`/autofills/${aj.id}`);
      aj = p.j?.job ?? p.j ?? aj;
    }
    const design = aj?.result?.design ?? aj?.design ?? null;
    dbg.push({ step: "poll autofill", finalStatus: aj?.status, error: aj?.error, design });
    return res.status(200).json({
      ok: aj?.status === "success",
      designUrl: design?.url || (design?.id ? `https://www.canva.com/design/${design.id}/edit` : null),
      dbg,
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
