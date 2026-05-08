// GET /api/canva-test
// Diagnostic endpoint — tries every upload approach and reports results.
// Visit this URL after deploying to find which method works.

import { getDb } from "./db.js";
import https from "https";
import fs from "fs";
import os from "os";
import path from "path";

const CANVA_HOST = "api.canva.com";
const CANVA_PATH = "/rest/v1/asset-uploads";

// Small 1×1 white JPEG (binary, no external download needed)
// This removes Pexels download as a possible failure point.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
  "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
  "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA" +
  "AAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA" +
  "/9oADAMBAAIRAxEAPwCwABmX/9k=",
  "base64"
);

async function getToken() {
  const db = getDb();
  const r = await db.execute(
    "SELECT access_token, refresh_token, expires_in, created_at FROM luxy_canva_auth WHERE id=1"
  );
  if (!r.rows.length) throw new Error("CANVA_NOT_CONNECTED");
  const row  = r.rows[0];
  const ageS = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  const exp  = row.expires_in || 3600;
  return {
    token:     row.access_token,
    ageSeconds: Math.round(ageS),
    expiresIn:  exp,
    isExpired:  ageS > exp - 120,
    tokenPreview: row.access_token.slice(0, 20) + "...",
  };
}

function makeMetadata(filename) {
  const nameB64  = Buffer.from(filename).toString("base64");
  const nameMeta = Buffer.from(JSON.stringify({ name_base64: nameB64 })).toString("base64url");
  return nameMeta;
}

async function tryFetch(label, token, body, headers) {
  try {
    const r = await fetch(`https://${CANVA_HOST}${CANVA_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { label, status: r.status, ok: r.status === 200, body: text.slice(0, 200), parsed };
  } catch (e) {
    return { label, status: "exception", ok: false, body: e.message };
  }
}

async function tryHttps(label, token, buf, headers) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: CANVA_HOST, path: CANVA_PATH, method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...headers } },
      (res) => {
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => resolve({
          label, status: res.statusCode, ok: res.statusCode === 200,
          body: body.slice(0, 200),
        }));
      }
    );
    req.on("error", e => resolve({ label, status: "exception", ok: false, body: e.message }));
    req.write(buf);
    req.end();
  });
}

async function tryHttpsPipe(label, token, tmpFile, headers) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: CANVA_HOST, path: CANVA_PATH, method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...headers } },
      (res) => {
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => resolve({
          label, status: res.statusCode, ok: res.statusCode === 200,
          body: body.slice(0, 200),
        }));
      }
    );
    req.on("error", e => resolve({ label, status: "exception", ok: false, body: e.message }));
    fs.createReadStream(tmpFile).pipe(req);
  });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  let tokenInfo;
  try {
    tokenInfo = await getToken();
  } catch (e) {
    return res.status(401).json({ error: "Canva non connesso. Vai su VMScout e collega Canva prima." });
  }

  const meta     = makeMetadata("test.jpg");
  const tmpFile  = path.join(os.tmpdir(), `canva-test-${Date.now()}.jpg`);
  fs.writeFileSync(tmpFile, TINY_JPEG);

  const token    = tokenInfo.token;
  const results  = [];

  // ── Test 1: fetch + Buffer + explicit Content-Type + Content-Length
  results.push(await tryFetch(
    "fetch | Buffer | Content-Type: image/jpeg | Content-Length explicit",
    token, TINY_JPEG,
    {
      "Content-Type":          "image/jpeg",
      "Content-Length":        String(TINY_JPEG.length),
      "Asset-Upload-Metadata": meta,
    }
  ));

  // ── Test 2: fetch + Blob (no Content-Type header, derived from blob.type)
  results.push(await tryFetch(
    "fetch | Blob(image/jpeg) | no explicit Content-Type",
    token, new Blob([TINY_JPEG], { type: "image/jpeg" }),
    { "Asset-Upload-Metadata": meta }
  ));

  // ── Test 3: https.request + req.write(buf) + req.end()
  results.push(await tryHttps(
    "https.request | req.write(buf) + end()",
    token, TINY_JPEG,
    {
      "Content-Type":          "image/jpeg",
      "Content-Length":        TINY_JPEG.length,
      "Asset-Upload-Metadata": meta,
    }
  ));

  // ── Test 4: https.request + ReadStream pipe
  results.push(await tryHttpsPipe(
    "https.request | ReadStream pipe",
    token, tmpFile,
    {
      "Content-Type":          "image/jpeg",
      "Content-Length":        TINY_JPEG.length,
      "Asset-Upload-Metadata": meta,
    }
  ));

  // ── Test 5: fetch + Buffer + NO Asset-Upload-Metadata (check if that header causes 415)
  results.push(await tryFetch(
    "fetch | Buffer | NO Asset-Upload-Metadata (baseline test)",
    token, TINY_JPEG,
    { "Content-Type": "image/jpeg", "Content-Length": String(TINY_JPEG.length) }
  ));

  // ── Test 6: fetch + Buffer + wrong Content-Type → should fail differently
  results.push(await tryFetch(
    "fetch | Buffer | Content-Type: application/octet-stream",
    token, TINY_JPEG,
    {
      "Content-Type":          "application/octet-stream",
      "Content-Length":        String(TINY_JPEG.length),
      "Asset-Upload-Metadata": meta,
    }
  ));

  try { fs.unlinkSync(tmpFile); } catch {}

  const winner = results.find(r => r.ok);

  return res.status(200).json({
    tokenInfo,
    winner: winner ? winner.label : "NONE — all approaches failed",
    results,
  });
}
