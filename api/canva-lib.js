// Helper condivisi per l'autofill di un Brand Template Canva.
//
// Canva ha RIMOSSO il vecchio endpoint sincrono
//   POST /v1/designs/templates/{id}/autofill   → "Unknown endpoint"
// Quello corrente è asincrono:
//   POST /v1/autofills            → crea un job
//   GET  /v1/autofills/{jobId}    → polling finché status = "success"
// e richiede un ID di **Brand Template** (non l'ID di un design).

const CANVA_API = "https://api.canva.com/rest/v1";

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

export async function runAutofill({ token, templateId, data, title }) {
  const brandTemplateId = cleanTemplateId(templateId);
  if (!brandTemplateId) {
    return { ok: false, status: 400, message: "Brand Template ID mancante o non valido." };
  }

  const createRes = await fetch(`${CANVA_API}/autofills`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "create_from_brand_template",
      brand_template_id: brandTemplateId,
      data,
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
