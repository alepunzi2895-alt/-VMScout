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

  // ?debug=merge — DIAGNOSTICA TEMPORANEA: crea 3 design 1-pagina col template
  // post e li unisce a catena con la Merge API, loggando id e page_count a ogni
  // passo. Serve a capire se modify_existing_design muta in place o crea un
  // nuovo design, e cosa torna in result.design.id.
  if (req.query.debug === "merge") {
    const TPL = String(req.query.tpl || "EAHUiCrR7F8");
    const dbg = [];
    const g = async (path, init) => {
      const r = await fetch(`${CANVA_API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, j };
    };
    const pollJob = async (kind, id) => {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const { j } = await g(`/${kind}/${id}`);
        const job = j.job ?? j;
        if (job.status === "success" || job.status === "failed") return job;
      }
      return { status: "timeout" };
    };
    const pageCount = async (id) => {
      const { j } = await g(`/designs/${id}`);
      return j?.design?.page_count ?? j?.page_count ?? null;
    };

    // 1) crea 3 autofill
    const designIds = [];
    for (let n = 1; n <= 3; n++) {
      const { j: cj } = await g(`/autofills`, {
        method: "POST",
        body: JSON.stringify({
          type: "create_from_brand_template", brand_template_id: TPL,
          data: { Testo_Post: { type: "text", text: `DBG slide ${n}` }, Caption: { type: "text", text: `DBG slide ${n}` } },
          title: `DBG ${n}`,
        }),
      });
      const job = await pollJob("autofills", (cj.job ?? cj).id);
      const id = job.result?.design?.id;
      designIds.push(id);
      dbg.push({ step: `autofill ${n}`, jobStatus: job.status, designId: id, pages: await pageCount(id) });
    }

    // 2) merge a catena: base = designIds[0], append designIds[1], poi [2]
    let base = designIds[0];
    for (let k = 1; k < designIds.length; k++) {
      const { status, j: mj } = await g(`/merges`, {
        method: "POST",
        body: JSON.stringify({
          type: "modify_existing_design", design_id: base,
          operations: [{ type: "insert_pages", source: { type: "design", design_id: designIds[k], page_numbers: [1] } }],
        }),
      });
      const job = await pollJob("merges", (mj.job ?? mj).id);
      const resultId = job.result?.design?.id;
      dbg.push({
        step: `merge append ${k}`, httpStatus: status, jobStatus: job.status,
        jobError: job.error || null,
        baseSent: base, resultDesignId: resultId,
        resultPages: resultId ? await pageCount(resultId) : null,
        basePagesAfter: await pageCount(base),
      });
      if (resultId) base = resultId;
    }
    return res.status(200).json({ ok: true, finalDesign: base, finalUrl: `https://www.canva.com/design/${base}/edit`, designIds, dbg });
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
