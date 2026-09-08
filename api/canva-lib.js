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

// Carica un'immagine su Canva da URL (job asincrono) e ne restituisce l'asset_id.
// Prova prima la versione normalizzata/ridimensionata, poi l'URL grezzo.
// `error` riporta il motivo REALE di Canva per poterlo mostrare all'utente.
// `deadline` (ms assoluti) limita create + polling di TUTTI i candidati, così il
// chiamante può garantire che upload + autofill stiano sotto il maxDuration:60.
export async function uploadUrlAsset({ token, url, name = "vmscout.jpg", deadline }) {
  if (!url) return { assetId: null, error: "URL immagine mancante" };
  const stopAt = deadline || (Date.now() + 40_000);
  const candidates = [...new Set([sizedImageUrl(url), url])];
  let lastErr = "Canva non è riuscita a caricare l'immagine.";
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
        await new Promise(res => setTimeout(res, 1500));
        const poll = await fetch(`${CANVA_API}/url-asset-uploads/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
        job = (await poll.json().catch(() => ({})))?.job ?? job;
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
    const r = await fetch(`${CANVA_API}/brand-templates/${brandTemplateId}/dataset`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    return j?.dataset && typeof j.dataset === "object" ? j.dataset : null;
  } catch { return null; }
}

export async function runAutofill({ token, templateId, data, title, deadline }) {
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

  let job = createJson.job ?? createJson;
  const jobId = job.id;
  if (!jobId) {
    return { ok: false, status: 502, message: "Canva non ha restituito un job di autofill.", details: createJson };
  }

  // Ceiling di polling: gli step precedenti (upload immagini) + questo devono
  // stare sotto il maxDuration:60 di vercel.json. Il chiamante passa un
  // `deadline` assoluto condiviso con l'upload; in mancanza, 35s.
  const stopAt = deadline || (Date.now() + 35_000);
  while ((job.status === "in_progress" || job.status === "pending") && Date.now() < stopAt) {
    await new Promise(r => setTimeout(r, 1500));
    const pollRes = await fetch(`${CANVA_API}/autofills/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pollJson = await pollRes.json().catch(() => ({}));
    job = pollJson.job ?? pollJson;
  }

  if (job.status !== "success") {
    return {
      ok: false,
      status: 502,
      message: job.error?.message || `Autofill Canva non riuscito (stato: ${job.status || "sconosciuto"}).`,
      details: job,
    };
  }

  const design = job.result?.design ?? job.design ?? null;
  const designId = design?.id ?? null;
  const designUrl = design?.url || (designId ? `https://www.canva.com/design/${designId}/edit` : null);
  return { ok: true, designId, designUrl };
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
      await new Promise(r => setTimeout(r, 1500));
      const pRes = await fetch(`${CANVA_API}/merges/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
      job = (await pRes.json().catch(() => ({}))).job ?? job;
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
