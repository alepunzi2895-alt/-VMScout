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

export async function deleteCanvaDesign(id) {
  try {
    await fetch("/api/history?action=delete_design", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return true;
  } catch (e) {
    console.warn("[canvaDesigns] eliminazione fallita:", e.message);
    return false;
  }
}
