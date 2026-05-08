import { getDb } from "./db.js";

const CANVA_API  = "https://api.canva.com/rest/v1";
const PEXELS_KEY = process.env.VITE_PEXELS_KEY || "";

// Saved template design IDs (created via Claude Canva MCP)
const TEMPLATE_IDS = {
  post:  "DAHJFvIQ56k",   // 1080 × 1350
  story: "DAHJFudau5o",   // 1080 × 1920
  reel:  "DAHJFnY488g",   // 1080 × 1920
};

// ─── helpers ────────────────────────────────────────────

async function getToken(db) {
  const r = await db.execute(
    "SELECT access_token, refresh_token, expires_in, created_at FROM luxy_canva_auth WHERE id=1"
  );
  if (!r.rows.length) {
    const e = new Error("CANVA_NOT_CONNECTED"); e.code = "CANVA_NOT_CONNECTED"; throw e;
  }
  const row    = r.rows[0];
  const ageS   = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  const expiry = row.expires_in || 3600;

  if (ageS > expiry - 120 && row.refresh_token) {
    const creds = Buffer.from(
      `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`
    ).toString("base64");
    const tr = await fetch(`${CANVA_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${creds}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
    });
    const td = await tr.json();
    if (td.access_token) {
      await db.execute({
        sql: "UPDATE luxy_canva_auth SET access_token=?, expires_in=?, created_at=datetime('now') WHERE id=1",
        args: [td.access_token, td.expires_in || 3600],
      });
      return td.access_token;
    }
  }
  return row.access_token;
}

async function fetchPexelsUrl(query, vertical) {
  if (!PEXELS_KEY) return null;
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${vertical ? "portrait" : "landscape"}`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const d = await r.json();
    return d.photos?.[0]?.src?.large2x || d.photos?.[0]?.src?.large || null;
  } catch { return null; }
}

async function uploadToCanva(imageUrl, token) {
  try {
    const img = await fetch(imageUrl, { headers: { "User-Agent": "VMScout/1.0" } });
    if (!img.ok) return null;
    const buf  = await img.arrayBuffer();
    const blob = new Blob([buf], { type: img.headers.get("content-type") || "image/jpeg" });
    const form = new FormData();
    form.append("asset", blob, "luxy-bg.jpg");
    const r = await fetch(`${CANVA_API}/asset/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const d = await r.json();
    return d.asset?.id || null;
  } catch { return null; }
}

async function startSession(designId, token) {
  const r = await fetch(`${CANVA_API}/designs/${designId}/editing-sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Editing session non avviata: ${r.status}`);
  return r.json();
}

async function applyAndCommit(designId, sessionId, ops, token) {
  if (ops.length > 0) {
    const r = await fetch(
      `${CANVA_API}/designs/${designId}/editing-sessions/${sessionId}/operations`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ operations: ops }),
      }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`Operazioni fallite (${r.status}): ${err.message || JSON.stringify(err)}`);
    }
  }
  await fetch(`${CANVA_API}/designs/${designId}/editing-sessions/${sessionId}/commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── core design builder ─────────────────────────────────

function buildOperations(sessData, assetId, caption, cta) {
  const ops       = [];
  const richtexts = sessData.richtexts || [];
  const fills     = sessData.fills     || [];

  // Background: largest editable fill with a containerElement
  const bgFill = [...fills]
    .filter(f => f.type === "image" && f.editable && f.containerElement)
    .sort((a, b) => {
      const area = f => (f.containerElement.dimension.width || 0) * (f.containerElement.dimension.height || 0);
      return area(b) - area(a);
    })[0];

  if (bgFill && assetId) {
    ops.push({
      type: "update_fill",
      element_id: bgFill.element_id,
      asset_type: "image",
      asset_id: assetId,
      alt_text: "Luxy Experience Ibiza",
    });
  }

  if (richtexts.length === 0) return ops;

  // Sort text elements top→bottom
  const sorted = [...richtexts].sort(
    (a, b) => (a.containerElement?.position?.top || 0) - (b.containerElement?.position?.top || 0)
  );

  if (sorted.length === 1) {
    // Story / Reel: single element → caption
    ops.push({ type: "replace_text", element_id: sorted[0].element_id, text: caption });
    return ops;
  }

  // Post: multi-element layout — assign by role
  // Largest bounding-box area = main headline
  const largest = [...sorted].sort((a, b) => {
    const area = el =>
      (el.containerElement?.dimension?.width || 0) * (el.containerElement?.dimension?.height || 0);
    return area(b) - area(a);
  })[0];

  const captionLines = caption.replace(/\n+/g, " ").trim();
  const headline     = captionLines.split(/[.!?✦]/)[0]?.trim() || captionLines.slice(0, 60);

  sorted.forEach(el => {
    const top = el.containerElement?.position?.top || 0;
    let text;
    if (el.element_id === largest.element_id) {
      text = headline;                         // big headline → prima frase
    } else if (top < 200) {
      text = "@luxy.exp";                      // header → handle
    } else if (top > 1100) {
      text = cta || "→ DM per info";          // footer → CTA
    } else {
      text = captionLines;                     // middle → caption completa
    }
    ops.push({ type: "replace_text", element_id: el.element_id, text });
  });

  return ops;
}

// ─── handler ────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { caption, cta, search_query, format = "post" } = req.body;
  if (!caption) return res.status(400).json({ error: "Manca caption" });

  const db = getDb();
  let token;
  try {
    token = await getToken(db);
  } catch (e) {
    return res.status(401).json({ error: e.code || "AUTH_ERROR", message: "Canva non connesso. Clicca 'Connetti Canva'." });
  }

  try {
    const vertical = format === "story" || format === "reel";

    // 1. Fetch Pexels image
    const imageUrl = search_query ? await fetchPexelsUrl(search_query, vertical) : null;

    // 2. Upload to Canva assets
    const assetId = imageUrl ? await uploadToCanva(imageUrl, token) : null;

    // 3. Resolve template ID (edit directly — Connect API has no public copy endpoint)
    const designId = TEMPLATE_IDS[format] || TEMPLATE_IDS.post;

    // 4. Start editing session (returns element structure)
    const sessData = await startSession(designId, token);
    const sessionId = sessData.session_id
      || sessData.editing_session?.id
      || sessData.transaction?.transaction_id;

    if (!sessionId) throw new Error("Session ID non trovato nella risposta Canva");

    // 5. Build + apply operations
    const ops = buildOperations(sessData, assetId, caption, cta);
    await applyAndCommit(designId, sessionId, ops, token);

    const editUrl = `https://www.canva.com/design/${designId}/edit`;
    return res.status(200).json({ ok: true, url: editUrl, designId, imageUrl });

  } catch (err) {
    console.error("[canva-create]", err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
