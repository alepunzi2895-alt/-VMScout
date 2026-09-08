// Helper condivisi per l'autofill di un Brand Template Canva.
//
// Canva ha RIMOSSO il vecchio endpoint sincrono
//   POST /v1/designs/templates/{id}/autofill   → "Unknown endpoint"
// Quello corrente è asincrono:
//   POST /v1/autofills            → crea un job
//   GET  /v1/autofills/{jobId}    → polling finché status = "success"
// e richiede un ID di **Brand Template** (non l'ID di un design).

import { ensureCanvaAuthTable } from "./db.js";

const CANVA_API = "https://api.canva.com/rest/v1";

// Canva limita a ~30 richieste/min per utente: un polling troppo fitto (o N job
// carosello pollati in parallelo) genera 429 che, se trattati come "job ancora
// in corso", mandano tutto in loop infinito. Intervallo prudente + backoff.
const POLL_INTERVAL_MS = 3500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// GET verso Canva con gestione del 429: aspetta il Retry-After (o 8s) e riprova,
// senza contare come errore. `{ status, ok, body }`.
async function canvaGet(token, path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await fetch(`${CANVA_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      return { status: 0, ok: false, body: {}, netError: e.message };
    }
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get("retry-after"));
      await sleep(Math.min(20_000, (retryAfter > 0 ? retryAfter : 8) * 1000));
      continue;
    }
    const body = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, body };
  }
  return { status: 429, ok: false, body: {} };
}

// ─── Token OAuth Canva — punto UNICO di lettura/rinnovo ──────────────
//
// Canva RUOTA il refresh_token a ogni chiamata /oauth/token: la risposta
// contiene un NUOVO refresh_token e quello usato viene invalidato subito. Se un
// endpoint rinnova l'access_token ma NON ripersiste il nuovo refresh_token, il
// refresh successivo fallisce → si ricade sull'access_token scaduto → Canva
// risponde "Access token is invalid". Tutti gli endpoint devono usare questo.
//
// (Sta in canva-lib.js e non in un file suo per non superare il limite di
// Serverless Functions del deploy: ogni file in api/ conta come funzione.)
export async function getCanvaToken(db) {
  await ensureCanvaAuthTable(db);
  const r = await db.execute(
    "SELECT access_token, refresh_token, expires_in, created_at FROM canva_auth WHERE id=1"
  );
  if (!r.rows.length) {
    const e = new Error("CANVA_NOT_CONNECTED"); e.code = "CANVA_NOT_CONNECTED"; throw e;
  }

  const row    = r.rows[0];
  const ageS   = (Date.now() - new Date(row.created_at + "Z").getTime()) / 1000;
  const expiry = row.expires_in || 3600;

  // Ancora valido (margine 120s): usa l'access_token corrente.
  if (ageS <= expiry - 120 || !row.refresh_token) return row.access_token;

  // Vicino alla scadenza → refresh + rotazione refresh_token.
  const clientId     = process.env.CANVA_CLIENT_ID     || process.env.VITE_CANVA_CLIENT_ID     || "";
  const clientSecret = process.env.CANVA_CLIENT_SECRET || process.env.VITE_CANVA_CLIENT_SECRET || "";
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let td = {};
  try {
    const tr = await fetch(`${CANVA_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${creds}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
    });
    td = await tr.json().catch(() => ({}));
  } catch {
    // Errore di rete durante il refresh: prova comunque l'access_token esistente.
    return row.access_token;
  }

  if (!td.access_token) {
    // refresh_token morto (già ruotato altrove, revocato o scaduto): serve
    // riconnettere Canva.
    const e = new Error("CANVA_TOKEN_EXPIRED"); e.code = "CANVA_NOT_CONNECTED"; throw e;
  }

  await db.execute({
    sql: "UPDATE canva_auth SET access_token=?, refresh_token=?, expires_in=?, created_at=datetime('now') WHERE id=1",
    args: [td.access_token, td.refresh_token || row.refresh_token, td.expires_in || 3600],
  });
  return td.access_token;
}

// Canva `url-asset-uploads` scarica l'immagine lato server e va in timeout /
// resta "in_progress" a lungo su file grossi: il caso tipico è Unsplash
// `urls.full`/`urls.raw` (6000px+, molti MB) o Pexels `large2x` (~1880px).
// Unsplash e Pexels servono via imgix: basta chiedere una versione più piccola
// con i loro parametri. 1280px di larghezza bastano per un post/story IG
// (1080px) e dimezzano i byte → download Canva molto più rapido.
// (wsrv.nl come proxy si è rivelato inaffidabile su alcune foto → niente proxy.)
function sizedImageUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "images.unsplash.com") {
      u.searchParams.set("w", "1280");
      u.searchParams.set("q", "75");
      u.searchParams.set("fm", "jpg");
      u.searchParams.set("fit", "max");
      return u.toString();
    }
    if (u.hostname === "images.pexels.com") {
      u.searchParams.set("auto", "compress");
      u.searchParams.set("cs", "tinysrgb");
      u.searchParams.set("w", "1280");
      u.searchParams.delete("h");
      u.searchParams.delete("dpr");
      return u.toString();
    }
  } catch { /* URL non parsabile: usala com'è */ }
  return url;
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function refererFor(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes("pixabay")) return "https://pixabay.com/";
    if (h.includes("unsplash")) return "https://unsplash.com/";
    if (h.includes("pexels")) return "https://www.pexels.com/";
  } catch { /* */ }
  return undefined;
}

// Scarica i byte di un'immagine con header "da browser" (alcune CDN — Pixabay,
// plus.unsplash.com — rispondono 403 a fetch senza referer/UA). Se fallisce,
// riprova tramite il proxy wsrv.nl che sa gestire l'hotlink.
async function downloadImage(url) {
  const headers = { "User-Agent": BROWSER_UA, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8" };
  const ref = refererFor(url);
  if (ref) headers.Referer = ref;
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15_000) : undefined;

  try {
    const r = await fetch(url, { headers, signal });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length) return { bytes: buf };
    }
  } catch { /* passa al proxy */ }

  // Fallback: proxy wsrv.nl (ridimensiona anche a 1280 e forza JPEG).
  try {
    const prox = `https://wsrv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&w=1280&output=jpg&q=80`;
    const r = await fetch(prox, { signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15_000) : undefined });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length) return { bytes: buf };
    }
    return { error: `Immagine non scaricabile (HTTP ${r.status} anche via proxy).` };
  } catch (e) {
    return { error: `Download immagine fallito: ${e.message}` };
  }
}

// Aggiunge un parametro univoco all'URL: Canva `url-asset-uploads` deduplica
// per URL e, se la stessa foto era già stata caricata, risponde 400 "already
// exists" SENZA restituirci l'asset_id esistente. Cambiare l'URL forza un nuovo
// upload. Unsplash/Pexels ignorano i parametri sconosciuti.
export function bustedUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.set("_vmsu", Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    return u.toString();
  } catch {
    return null;
  }
}

// Una singola verifica di un job asset-uploads.
// `{ assetId }` | `{ pending: true }` | `{ error }`.
export async function checkImageUpload({ token, jobId }) {
  const { status, ok, body } = await canvaGet(token, `/asset-uploads/${jobId}`);
  if (ok && body?.job) {
    const j = body.job;
    if (j.status === "success" && j.asset?.id) return { assetId: j.asset.id };
    if (j.status === "failed") return { error: `Canva: ${j.error?.message || j.error?.code || "elaborazione immagine fallita"}` };
    return { pending: true };
  }
  if (status === 404 || status === 410) return { error: "Job di upload non trovato su Canva (scaduto)." };
  return { pending: true, transient: status }; // errore transitorio: riprova al giro dopo
}

// Poll di UN job asset-uploads finché success/failed o scadenza `stopAt`.
async function pollBinaryJob({ token, jobId, job, stopAt }) {
  if (job?.status === "success" && job.asset?.id) return { assetId: job.asset.id };
  let misses = 0;
  while (Date.now() < stopAt) {
    await sleep(POLL_INTERVAL_MS);
    const c = await checkImageUpload({ token, jobId });
    if (c.assetId) return { assetId: c.assetId };
    if (c.error) return { assetId: null, error: c.error };
    if (c.transient && ++misses >= 6) {
      return { assetId: null, error: `Canva non risponde al polling dell'upload (HTTP ${c.transient}).` };
    }
    if (!c.transient) misses = 0;
  }
  return { assetId: null, pending: true, jobId };
}

// Scarica i byte dell'immagine e AVVIA l'upload BINARIO (`POST /v1/asset-uploads`).
// Solo create, niente polling. `{ jobId }` | `{ assetId }` (raro, se già pronto) |
// `{ error, stop? }`. A differenza di `url-asset-uploads`, Canva non deve fare un
// fetch esterno lento da Unsplash/Pexels: il job si chiude in pochi secondi.
export async function startImageUpload({ token, url, name = "vmscout.jpg" }) {
  const dl = await downloadImage(sizedImageUrl(url));
  if (dl.error) return { error: dl.error };
  const bytes = dl.bytes;
  if (!bytes?.length) return { error: "Immagine vuota." };
  if (bytes.length > 45 * 1024 * 1024) return { error: "Immagine troppo grande (>45MB)." };

  const safeName = (String(name).replace(/[^\w.\- ]/g, "").trim() || "vmscout").slice(0, 50);
  try {
    const r = await fetch(`${CANVA_API}/asset-uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(safeName, "utf8").toString("base64") }),
      },
      body: bytes,
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) {
      return { stop: true, error: "Permesso Canva insufficiente per caricare immagini (scope asset:write). Disconnetti e riconnetti Canva dentro VMScout." };
    }
    if (!r.ok || !d?.job?.id) {
      return { error: `Canva ha rifiutato l'upload binario (HTTP ${r.status})${d?.message ? `: ${d.message}` : ""}.` };
    }
    if (d.job.status === "success" && d.job.asset?.id) return { assetId: d.job.asset.id };
    return { jobId: d.job.id };
  } catch (e) {
    return { error: `Errore di rete verso Canva: ${e.message}` };
  }
}

// Scarica i byte e carica su Canva (binario), aspettando l'asset_id fino a stopAt.
// Con `resumeJobId` salta download + create e riprende solo il polling.
async function uploadBinaryAsset({ token, url, name, stopAt, resumeJobId }) {
  if (resumeJobId) return pollBinaryJob({ token, jobId: resumeJobId, stopAt });
  const start = await startImageUpload({ token, url, name });
  if (start.assetId) return { assetId: start.assetId };
  if (start.error) return { assetId: null, error: start.error, stop: start.stop };
  return pollBinaryJob({ token, jobId: start.jobId, stopAt });
}

// Carica un'immagine su Canva e ne restituisce l'asset_id. Prima prova il metodo
// binario (veloce), poi come fallback `url-asset-uploads` (Canva scarica l'URL).
// `error` riporta il motivo REALE di Canva per poterlo mostrare all'utente.
// `deadline` (ms assoluti) limita TUTTO (download + create + polling), così il
// chiamante può garantire che upload + autofill stiano sotto il maxDuration:60.
export async function uploadUrlAsset({ token, url, name = "vmscout.jpg", deadline, resumeJobId }) {
  const stopAt = deadline || (Date.now() + 45_000);

  // Resume: riprendi solo il polling di un job binario già avviato.
  if (resumeJobId) return uploadBinaryAsset({ token, resumeJobId, stopAt });

  if (!url) return { assetId: null, error: "URL immagine mancante" };

  // Metodo 1: byte scaricati da noi → upload binario.
  const bin = await uploadBinaryAsset({ token, url, name, stopAt });
  if (bin.assetId) return { assetId: bin.assetId };
  if (bin.pending) return { assetId: null, pending: true, jobId: bin.jobId };
  if (bin.stop) return { assetId: null, error: bin.error };
  let lastErr = bin.error || "Canva non è riuscita a caricare l'immagine.";

  // Metodo 2 (fallback): url-asset-uploads.
  const candidates = [...new Set([sizedImageUrl(url), url])];
  for (let i = 0; i < candidates.length && Date.now() < stopAt; i++) {
    const candidate = candidates[i];
    try {
      const r = await fetch(`${CANVA_API}/url-asset-uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(name).slice(0, 255), url: candidate }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) {
        return { assetId: null, error: "Permesso Canva insufficiente per caricare immagini (scope asset:write). Disconnetti e riconnetti Canva dentro VMScout." };
      }
      if (!r.ok || !d?.job?.id) {
        const blob = `${d?.code || ""} ${d?.message || ""}`.toLowerCase();
        // Asset già presente sull'account ma senza id restituito → riprova lo
        // stesso URL reso univoco, così Canva crea un nuovo asset.
        if (/already exist|duplicate/.test(blob) && !/[?&]_vmsu=/.test(candidate)) {
          const busted = bustedUrl(candidate);
          if (busted) candidates.push(busted);
        }
        lastErr = `Canva ha rifiutato l'upload (HTTP ${r.status})${d?.message ? `: ${d.message}` : ""}.`;
        continue;
      }

      const jobId = d.job.id;
      let job = d.job;
      while ((job.status === "in_progress" || job.status === "pending") && Date.now() < stopAt) {
        await sleep(POLL_INTERVAL_MS);
        const poll = await canvaGet(token, `/url-asset-uploads/${jobId}`);
        job = poll.body?.job ?? job;
      }
      if (job.status === "success" && job.asset?.id) return { assetId: job.asset.id };
      lastErr = job.status === "failed"
        ? `Canva: ${job.error?.message || job.error?.code || "download dell'immagine fallito"}`
        : `Canva ci sta ancora scaricando l'immagine (job ${job.status}). Il design è stato creato senza sfondo: aprilo in Canva e trascina la foto, oppure riprova tra un minuto.`;
      // job fallito/lento: prova il candidato successivo (URL grezzo) se resta tempo
    } catch (e) {
      lastErr = `Errore di rete verso Canva: ${e.message}`;
    }
  }
  return { assetId: null, error: lastErr };
}

// L'utente spesso incolla un pezzo di URL Canva
// (es. "DAHUh-jxeuU/dsxKa-nws_k9rmxg1CENfg" da canva.com/design/<id>/<token>/view).
// Un ID valido è un singolo segmento: teniamo solo la prima parte prima di
// "/", "?" o "#" e rimuoviamo spazi/virgolette.
export function cleanTemplateId(raw) {
  return String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^https?:\/\/[^/]*\/(?:design|brand-templates?)\//, "")
    .split(/[/?#\s]/)[0];
}

// Il dataset del Brand Template: nomi dei campi di autofill e tipo. Canva
// RIFIUTA le chiavi non presenti nel dataset, quindi filtriamo `data` prima
// di inviarlo (il backend manda anche alias tipo Caption/Background).
async function fetchDataset(token, brandTemplateId) {
  try {
    const { body } = await canvaGet(token, `/brand-templates/${brandTemplateId}/dataset`);
    return body?.dataset && typeof body.dataset === "object" ? body.dataset : null;
  } catch { return null; }
}

// Poll di un job autofill. `{ ok, designId, designUrl }` | `{ ok:false, pending, jobId }`
// (ancora in lavorazione allo scadere di stopAt) | `{ ok:false, status, message }`.
async function pollAutofillJob({ token, jobId, job, stopAt }) {
  let j = job || { id: jobId, status: "in_progress" };
  while ((j.status === "in_progress" || j.status === "pending") && Date.now() < stopAt) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await canvaGet(token, `/autofills/${jobId}`);
    j = poll.body?.job ?? poll.body ?? j;
  }
  if (j.status === "success") {
    const design = j.result?.design ?? j.design ?? null;
    const designId = design?.id ?? null;
    const designUrl = design?.url || (designId ? `https://www.canva.com/design/${designId}/edit` : null);
    return { ok: true, designId, designUrl };
  }
  if (j.status === "in_progress" || j.status === "pending") {
    return { ok: false, pending: true, jobId, status: 202, message: "Autofill Canva ancora in corso." };
  }
  return {
    ok: false,
    status: 502,
    message: j.error?.message || `Autofill Canva non riuscito (stato: ${j.status || "sconosciuto"}).`,
    details: j,
  };
}

export async function runAutofill({ token, templateId, data, title, deadline, resumeJobId }) {
  const stopAt = deadline || (Date.now() + 35_000);

  // Resume: riprendi solo il polling di un job autofill già avviato.
  if (resumeJobId) return pollAutofillJob({ token, jobId: resumeJobId, stopAt });

  const brandTemplateId = cleanTemplateId(templateId);
  if (!brandTemplateId) {
    return { ok: false, status: 400, message: "Brand Template ID mancante o non valido." };
  }

  // Filtra i campi a quelli realmente definiti nel template.
  const dataset = await fetchDataset(token, brandTemplateId);
  let payloadData = data;
  if (dataset) {
    payloadData = Object.fromEntries(Object.entries(data || {}).filter(([k]) => k in dataset));
    if (!Object.keys(payloadData).length) {
      return {
        ok: false,
        status: 400,
        message: `Nessun campo compatibile col Brand Template. Campi attesi: ${Object.keys(dataset).join(", ") || "(nessuno)"}. In VMScout i placeholder devono chiamarsi Testo_Post / Immagine_Sfondo (post, story, reel) oppure Image_1/Testo_1, Image_2/Testo_2… (carosello).`,
        details: dataset,
      };
    }
  }

  const createRes = await fetch(`${CANVA_API}/autofills`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "create_from_brand_template",
      brand_template_id: brandTemplateId,
      data: payloadData,
      ...(title ? { title: String(title).slice(0, 255) } : {}),
    }),
  });
  const createJson = await createRes.json().catch(() => ({}));

  if (!createRes.ok) {
    const blob = JSON.stringify(createJson).toLowerCase();
    const msg = createJson.message || createJson.error || "Errore Canva Autofill API";
    let hint = "";
    if (createRes.status === 401 || /access token|invalid.*token|token.*(invalid|expired)|unauthenticated/.test(blob)) {
      hint = " — la sessione Canva è scaduta o è stata revocata. In VMScout: disconnetti Canva e riconnettilo, poi riprova.";
    } else if (/autofill capable elements|no autofill|autofillable/.test(blob)) {
      hint = " — il Brand Template non ha campi di autofill. In Canva apri il template, seleziona ogni riquadro immagine e ogni casella di testo, click destro → 'Aggiungi al modello del brand' (o pannello Dati) e assegna un nome campo: per il carosello Image_1/Testo_1, Image_2/Testo_2, ... (per un post singolo: Immagine_Sfondo e Testo_Post/Caption). Poi ripubblica il Modello del brand.";
    } else if (/not found|invalid|brand_template|permission|not authorized/.test(blob)) {
      hint = " — verifica che l'ID sia quello di un Brand Template pubblicato (non di un design) e che l'account Canva collegato abbia accesso al template. In Canva: apri il template → Condividi → 'Modello del brand', poi copia l'ID dall'URL /brand-templates/<ID>.";
    } else if (/enterprise|not available on your plan|upgrade/.test(blob)) {
      hint = " — l'API Autofill di Canva richiede un piano Canva Enterprise (o l'accesso trial per integrazioni in sviluppo).";
    }
    return { ok: false, status: createRes.status, message: msg + hint, details: createJson };
  }

  const job = createJson.job ?? createJson;
  if (!job.id) {
    return { ok: false, status: 502, message: "Canva non ha restituito un job di autofill.", details: createJson };
  }
  return pollAutofillJob({ token, jobId: job.id, job, stopAt });
}

// Elimina le pagine in coda a un design (Design Merge API, preview). Serve al
// carosello: il template ha N pagine fisse (Image_1..N/Testo_1..N), ma se
// l'utente compone meno slide le pagine extra restano con il placeholder.
// Best-effort: se fallisce, il design resta comunque valido (solo con qualche
// pagina vuota in coda). Richiede scope design:content:write + design:meta:read.
export async function trimTrailingPages({ token, designId, keep, deadline }) {
  if (!designId || !keep || keep < 1) return { ok: false, trimmed: 0 };
  try {
    const dRes = await fetch(`${CANVA_API}/designs/${designId}`, { headers: { Authorization: `Bearer ${token}` } });
    const dJson = await dRes.json().catch(() => ({}));
    const total = dJson?.design?.page_count ?? dJson?.page_count ?? null;
    if (!total || total <= keep) return { ok: true, trimmed: 0 };

    const pageNumbers = [];
    for (let p = keep + 1; p <= total; p++) pageNumbers.push(p);

    const mRes = await fetch(`${CANVA_API}/merges`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "modify_existing_design",
        design_id: designId,
        operations: [{ type: "delete_pages", page_numbers: pageNumbers }],
      }),
    });
    const mJson = await mRes.json().catch(() => ({}));
    if (!mRes.ok) return { ok: false, trimmed: 0, error: mJson.message || mJson.error };

    let job = mJson.job ?? mJson;
    const jobId = job.id;
    const stopAt = deadline || (Date.now() + 15_000);
    while (jobId && (job.status === "in_progress" || job.status === "pending") && Date.now() < stopAt) {
      await sleep(POLL_INTERVAL_MS);
      const p = await canvaGet(token, `/merges/${jobId}`);
      job = p.body?.job ?? job;
    }
    const rd = job.result?.design ?? job.design ?? null;
    return {
      ok: job.status === "success",
      trimmed: pageNumbers.length,
      designUrl: rd?.url || null,
      designId: rd?.id || null,
    };
  } catch (e) {
    return { ok: false, trimmed: 0, error: e.message };
  }
}
