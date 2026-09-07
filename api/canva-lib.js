// Helper condivisi per l'autofill di un Brand Template Canva.
//
// Canva ha RIMOSSO il vecchio endpoint sincrono
//   POST /v1/designs/templates/{id}/autofill   → "Unknown endpoint"
// Quello corrente è asincrono:
//   POST /v1/autofills            → crea un job
//   GET  /v1/autofills/{jobId}    → polling finché status = "success"
// e richiede un ID di **Brand Template** (non l'ID di un design).

const CANVA_API = "https://api.canva.com/rest/v1";

// Canva `url-asset-uploads` fallisce / va in timeout su file enormi: il caso
// tipico è Unsplash `urls.full`/`urls.raw` = foto a piena risoluzione (6000px+,
// molti MB). Unsplash serve via imgix, quindi basta chiedere una versione
// ridimensionata con i suoi parametri. (wsrv.nl come proxy si è rivelato
// inaffidabile su alcune foto → niente proxy, solo normalizzazione host-aware.)
function sizedImageUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "images.unsplash.com") {
      u.searchParams.set("w", "1600");
      u.searchParams.set("q", "80");
      u.searchParams.set("fm", "jpg");
      u.searchParams.set("fit", "max");
      return u.toString();
    }
  } catch { /* URL non parsabile: usala com'è */ }
  return url;
}

// Carica un'immagine su Canva da URL (job asincrono) e ne restituisce l'asset_id.
// Prova prima la versione normalizzata/ridimensionata, poi l'URL grezzo.
export async function uploadUrlAsset({ token, url, name = "vmscout.jpg" }) {
  if (!url) return { assetId: null, error: "URL immagine mancante" };
  const candidates = [...new Set([sizedImageUrl(url), url])];
  for (const candidate of candidates) {
    try {
      const r = await fetch(`${CANVA_API}/url-asset-uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(name).slice(0, 255), url: candidate }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.job?.id) continue;

      const jobId = d.job.id;
      const deadline = Date.now() + 28_000;
      let job = d.job;
      while ((job.status === "in_progress" || job.status === "pending") && Date.now() < deadline) {
        await new Promise(res => setTimeout(res, 1500));
        const poll = await fetch(`${CANVA_API}/url-asset-uploads/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
        job = (await poll.json().catch(() => ({})))?.job ?? job;
      }
      if (job.status === "success" && job.asset?.id) return { assetId: job.asset.id };
      // job fallito: se era il candidato proxato, prova col grezzo
    } catch { /* prova il candidato successivo */ }
  }
  return { assetId: null, error: "Canva non è riuscita a caricare l'immagine dall'URL (formato non supportato, file troppo grande o URL non pubblico)." };
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

export async function runAutofill({ token, templateId, data, title }) {
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
    if (/autofill capable elements|no autofill|autofillable/.test(blob)) {
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
  // stare sotto il maxDuration:60 di vercel.json. L'autofill di norma finisce in
  // pochi secondi; 35s è un margine ampio.
  const deadline = Date.now() + 35_000;
  while ((job.status === "in_progress" || job.status === "pending") && Date.now() < deadline) {
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
export async function trimTrailingPages({ token, designId, keep }) {
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
    const deadline = Date.now() + 15_000;
    while (jobId && (job.status === "in_progress" || job.status === "pending") && Date.now() < deadline) {
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
