// GET /api/canva-test — trova l'approccio funzionante per l'upload Canva

import { getDb } from "./db.js";
import https from "https";

const CANVA_HOST = "api.canva.com";
const CANVA_PATH = "/rest/v1/asset-uploads";

// 1×1 white PNG — bytes verificati, garantito valido
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
  "AABjkB6QAAAABJRU5ErkJggg==",
  "base64"
);

async function getToken() {
  const db = getDb();
  const r  = await db.execute(
    "SELECT access_token, expires_in, created_at FROM luxy_canva_auth WHERE id=1"
  );
  if (!r.rows.length) throw new Error("NOT_CONNECTED");
  const row  = r.rows[0];
  const ageS = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  return {
    token:      row.access_token,
    ageSeconds: Math.round(ageS),
    expiresIn:  row.expires_in || 3600,
    isExpired:  ageS > (row.expires_in || 3600) - 120,
  };
}

function makeMeta(filename) {
  const nameB64 = Buffer.from(filename).toString("base64");
  return Buffer.from(JSON.stringify({ name_base64: nameB64 })).toString("base64url");
}

async function doFetch(token, body, headers) {
  const r = await fetch(`https://${CANVA_HOST}${CANVA_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 300) };
}

function doHttps(token, buf, headers) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: CANVA_HOST, path: CANVA_PATH, method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...headers } },
      (res) => { let b = ""; res.on("data", d => b += d); res.on("end", () => resolve({ status: res.statusCode, body: b.slice(0, 300) })); }
    );
    req.on("error", e => resolve({ status: "ERR", body: e.message }));
    req.write(buf);
    req.end();
  });
}

async function run(label, fn) {
  try {
    const r = await fn();
    return { label, ...r, ok: r.status === 200 || r.status === 202 };
  } catch (e) {
    return { label, status: "EXC", body: e.message, ok: false };
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  let tokenInfo;
  try { tokenInfo = await getToken(); }
  catch { return res.status(200).json({ error: "Canva non connesso." }); }

  const { token } = tokenInfo;
  const metaPng  = makeMeta("test.png");
  const metaJpg  = makeMeta("test.jpg");
  const results  = [];

  // ── Gruppo A: PNG valido (bytes verificati) ──────────────────
  // Se questo fallisce → problema API/token. Se passa → il JPEG era corrotto.

  results.push(await run("A1: PNG reale | fetch | Buffer | CT:image/png", () =>
    doFetch(token, VALID_PNG, {
      "Content-Type":          "image/png",
      "Content-Length":        String(VALID_PNG.length),
      "Asset-Upload-Metadata": metaPng,
    })
  ));

  results.push(await run("A2: PNG reale | https.request | write+end", () =>
    doHttps(token, VALID_PNG, {
      "Content-Type":          "image/png",
      "Content-Length":        VALID_PNG.length,
      "Asset-Upload-Metadata": metaPng,
    })
  ));

  // ── Gruppo B: JPEG scaricato da httpbin (reale, non inventato) ──
  let realJpeg = null;
  let downloadErr = null;
  try {
    const r = await fetch("https://httpbin.org/image/jpeg", { headers: { "User-Agent": "VMScout/1.0" } });
    if (r.ok) realJpeg = Buffer.from(await r.arrayBuffer());
  } catch (e) { downloadErr = e.message; }

  if (realJpeg) {
    results.push(await run(`B1: JPEG da httpbin (${realJpeg.length}B) | fetch | Buffer`, () =>
      doFetch(token, realJpeg, {
        "Content-Type":          "image/jpeg",
        "Content-Length":        String(realJpeg.length),
        "Asset-Upload-Metadata": metaJpg,
      })
    ));

    results.push(await run(`B2: JPEG da httpbin (${realJpeg.length}B) | https.request | write+end`, () =>
      doHttps(token, realJpeg, {
        "Content-Type":          "image/jpeg",
        "Content-Length":        realJpeg.length,
        "Asset-Upload-Metadata": metaJpg,
      })
    ));
  } else {
    results.push({ label: "B: download httpbin fallito", status: "SKIP", body: downloadErr, ok: false });
  }

  // ── Gruppo C: URL-based JSON body (come fa l'MCP tool) ───────
  // Ipotesi: Canva accetta una URL nel body JSON invece del binario
  const pexelsUrl = "https://images.pexels.com/photos/3586966/pexels-photo-3586966.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&dpr=1";

  results.push(await run("C1: JSON body { url: pexelsUrl } | CT:application/json", () =>
    doFetch(token, JSON.stringify({ url: pexelsUrl }), {
      "Content-Type":          "application/json",
      "Asset-Upload-Metadata": metaJpg,
    })
  ));

  results.push(await run("C2: JSON body { url: pexelsUrl } | senza metadata header", () =>
    doFetch(token, JSON.stringify({ url: pexelsUrl }), {
      "Content-Type": "application/json",
    })
  ));

  const winner = results.find(r => r.ok);

  return res.status(200).json({
    WINNER:    winner ? winner.label : "NESSUNO",
    tokenInfo: { ...tokenInfo, token: tokenInfo.token.slice(0, 20) + "..." },
    results,
  });
}
