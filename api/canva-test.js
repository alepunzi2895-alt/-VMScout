// GET /api/canva-test
// Canva vuole application/octet-stream (confermato). Testa varianti metadata + TUS.

import { getDb } from "./db.js";
import https from "https";

const CANVA_HOST = "api.canva.com";
const CANVA_PATH = "/rest/v1/asset-uploads";

// 1×1 white PNG — garantito valido
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
  "AABjkB6QAAAABJRU5ErkJggg==",
  "base64"
);

async function getToken() {
  const db = getDb();
  const r  = await db.execute("SELECT access_token, expires_in, created_at FROM luxy_canva_auth WHERE id=1");
  if (!r.rows.length) throw new Error("NOT_CONNECTED");
  const row  = r.rows[0];
  const ageS = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  return { token: row.access_token, ageSeconds: Math.round(ageS), expiresIn: row.expires_in || 3600 };
}

// Tutte le varianti di encoding per il metadata header
function metas(filename) {
  const b64    = Buffer.from(filename).toString("base64");       // "dGVzdC5qcGc="
  const b64url = Buffer.from(filename).toString("base64url");    // "dGVzdC5qcGc"
  return {
    v1: Buffer.from(JSON.stringify({ name_base64: b64    })).toString("base64url"), // standard
    v2: Buffer.from(JSON.stringify({ name_base64: b64url })).toString("base64url"), // inner senza padding
    v3: b64,         // plain base64 (niente JSON)
    v4: b64url,      // plain base64url (niente JSON)
    v5: Buffer.from(JSON.stringify({ name_base64: b64    })).toString("base64"),    // outer base64 (non url)
  };
}

async function post(token, body, headers) {
  try {
    const r = await fetch(`https://${CANVA_HOST}${CANVA_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 250), ok: r.status < 300 };
  } catch (e) {
    return { status: "ERR", body: e.message, ok: false };
  }
}

function httpsPost(token, buf, headers) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: CANVA_HOST, path: CANVA_PATH, method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...headers } },
      (res) => { let b=""; res.on("data",d=>b+=d); res.on("end",()=>resolve({status:res.statusCode,body:b.slice(0,250),ok:res.statusCode<300})); }
    );
    req.on("error", e => resolve({ status:"ERR", body:e.message, ok:false }));
    req.write(buf); req.end();
  });
}

async function run(label, fn) {
  const r = await fn().catch(e => ({ status:"EXC", body:e.message, ok:false }));
  return { label, ...r };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  let tokenInfo;
  try { tokenInfo = await getToken(); }
  catch { return res.status(200).json({ error: "Canva non connesso." }); }

  const { token } = tokenInfo;
  const m = metas("test.png");
  const results = [];

  // ── GRUPPO A: application/octet-stream + varianti metadata ──────────────
  // Canva ha confermato che vuole octet-stream. Proviamo i metadata diversi.

  results.push(await run("A1: octet-stream | metadata V1 json+base64url outer, base64 inner", () =>
    post(token, VALID_PNG, { "Content-Type":"application/octet-stream", "Content-Length":String(VALID_PNG.length), "Asset-Upload-Metadata":m.v1 })
  ));

  results.push(await run("A2: octet-stream | metadata V2 json+base64url outer, base64url inner (no padding)", () =>
    post(token, VALID_PNG, { "Content-Type":"application/octet-stream", "Content-Length":String(VALID_PNG.length), "Asset-Upload-Metadata":m.v2 })
  ));

  results.push(await run("A3: octet-stream | metadata V3 plain base64 (no JSON)", () =>
    post(token, VALID_PNG, { "Content-Type":"application/octet-stream", "Content-Length":String(VALID_PNG.length), "Asset-Upload-Metadata":m.v3 })
  ));

  results.push(await run("A4: octet-stream | metadata V4 plain base64url (no JSON)", () =>
    post(token, VALID_PNG, { "Content-Type":"application/octet-stream", "Content-Length":String(VALID_PNG.length), "Asset-Upload-Metadata":m.v4 })
  ));

  results.push(await run("A5: octet-stream | SENZA metadata header (baseline)", () =>
    post(token, VALID_PNG, { "Content-Type":"application/octet-stream", "Content-Length":String(VALID_PNG.length) })
  ));

  results.push(await run("A6: octet-stream | metadata V5 outer base64 (non url)", () =>
    post(token, VALID_PNG, { "Content-Type":"application/octet-stream", "Content-Length":String(VALID_PNG.length), "Asset-Upload-Metadata":m.v5 })
  ));

  // ── GRUPPO B: TUS protocol (application/offset+octet-stream) ────────────
  // "application/offset+octet-stream" è il Content-Type del TUS protocol.
  // TUS = chunked resumable upload. Canva lo ha menzionato come tipo accettato.

  results.push(await run("B1: offset+octet-stream + Tus-Resumable + Upload-Length + metadata V1", () =>
    post(token, VALID_PNG, {
      "Content-Type":          "application/offset+octet-stream",
      "Content-Length":        String(VALID_PNG.length),
      "Tus-Resumable":         "1.0.0",
      "Upload-Offset":         "0",
      "Asset-Upload-Metadata": m.v1,
    })
  ));

  results.push(await run("B2: offset+octet-stream | metadata V1 | senza TUS headers", () =>
    post(token, VALID_PNG, {
      "Content-Type":          "application/offset+octet-stream",
      "Content-Length":        String(VALID_PNG.length),
      "Asset-Upload-Metadata": m.v1,
    })
  ));

  // ── GRUPPO C: https.request (elimina undici/fetch come variabile) ────────
  results.push(await run("C1: https.request | octet-stream | metadata V1", () =>
    httpsPost(token, VALID_PNG, {
      "Content-Type":          "application/octet-stream",
      "Content-Length":        VALID_PNG.length,
      "Asset-Upload-Metadata": m.v1,
    })
  ));

  results.push(await run("C2: https.request | octet-stream | metadata V2 (inner no padding)", () =>
    httpsPost(token, VALID_PNG, {
      "Content-Type":          "application/octet-stream",
      "Content-Length":        VALID_PNG.length,
      "Asset-Upload-Metadata": m.v2,
    })
  ));

  const winner = results.find(r => r.ok);
  const errors = [...new Set(results.map(r => r.body))];

  return res.status(200).json({
    WINNER:    winner ? winner.label : "NESSUNO",
    ALL_ERRORS: errors,
    tokenInfo: { ...tokenInfo, token: undefined },
    metaValues: m,
    results,
  });
}
