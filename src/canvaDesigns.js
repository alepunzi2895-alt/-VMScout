// Helper per lo storico dei design Canva creati dall'app (tabella `canva_designs`
// via /api/history). Usati da Visual Scout (salvataggio dopo la creazione) e da
// Canva Studio (galleria "Design creati").

export async function saveCanvaDesign(payload) {
  try {
    const res = await fetch("/api/history?action=save_design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    console.warn("[canvaDesigns] salvataggio fallito:", e.message);
    return null;
  }
}

export async function listCanvaDesigns(projectId) {
  try {
    const qs = projectId ? `&project_id=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`/api/history?action=designs${qs}`);
    const d = await res.json();
    return d.ok ? d.data : [];
  } catch (e) {
    console.warn("[canvaDesigns] lista fallita:", e.message);
    return [];
  }
}

// Elimina il design dallo storico VMScout e (se `alsoCanva`) lo sposta nel
// Cestino di Canva. Restituisce `{ ok, canva }` dove `canva` è l'esito del
// tentativo lato Canva (`null` se non applicabile, `{ ok:false, code:"SCOPE" }`
// se manca il permesso folder:write).
export async function deleteCanvaDesign(id, { alsoCanva = true } = {}) {
  try {
    const res = await fetch("/api/history?action=delete_design", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, also_canva: alsoCanva }),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, canva: d.canva ?? null };
  } catch (e) {
    console.warn("[canvaDesigns] eliminazione fallita:", e.message);
    return { ok: false, canva: null };
  }
}
