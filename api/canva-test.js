// GET /api/canva-test — verifica upload via url-asset-uploads

import { getDb } from "./db.js";

const CANVA_API_BASE = "https://api.canva.com/rest/v1";

// A small publicly-accessible test image
const TEST_URL = "https://images.pexels.com/photos/3155666/pexels-photo-3155666.jpeg?auto=compress&cs=tinysrgb&w=200";

async function getToken() {
  const db = getDb();
  const r  = await db.execute("SELECT access_token FROM luxy_canva_auth WHERE id=1");
  if (!r.rows.length) throw new Error("NOT_CONNECTED");
  return r.rows[0].access_token;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  let token;
  try { token = await getToken(); }
  catch { return res.status(200).json({ error: "Canva non connesso." }); }

  // ── 1. POST url-asset-uploads (correct approach) ─────────────────
  let urlUploadResult;
  try {
    const r = await fetch(`${CANVA_API_BASE}/url-asset-uploads`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "luxy-test.jpg", url: TEST_URL }),
    });
    const d = await r.json();
    urlUploadResult = { status: r.status, ok: r.ok, body: JSON.stringify(d).slice(0, 400) };
  } catch (e) {
    urlUploadResult = { status: "ERR", ok: false, body: e.message };
  }

  // ── 2. If job in_progress, poll once after 1s ────────────────────
  let pollResult = null;
  const jobId = urlUploadResult.ok && JSON.parse(urlUploadResult.body)?.job?.id;
  if (jobId) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r2 = await fetch(`${CANVA_API_BASE}/url-asset-uploads/${jobId}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const d2 = await r2.json();
      pollResult = { status: r2.status, ok: r2.ok, body: JSON.stringify(d2).slice(0, 400) };
    } catch (e) {
      pollResult = { status: "ERR", ok: false, body: e.message };
    }
  }

  return res.status(200).json({
    upload:  urlUploadResult,
    poll:    pollResult,
    jobId,
    winner:  urlUploadResult.ok ? "url-asset-uploads" : "NESSUNO",
  });
}
