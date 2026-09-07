// Direttive specifiche di progetto — il "cervello" che migliora a ogni studio.
//
// Loop: prima di ogni prompt/analisi le direttive del progetto vengono iniettate
// nel system prompt; DOPO ogni generazione (Visual Scout) o analisi (Analytics)
// una chiamata AI leggera e in background le riscrive tenendo ciò che funziona e
// scartando il superato. Persistite in `project_insights.data.directives`.
// Vedi docs/PROJECT_LEARNING_LOOP.md.

export async function fetchProjectInsights(projectId) {
  if (!projectId) return null;
  try {
    const res = await fetch(`/api/history?action=get_insights&project_id=${encodeURIComponent(projectId)}`);
    const d = await res.json();
    return d.ok ? d.data : null;
  } catch (e) {
    console.warn("[projectDirectives] fetch insights fallito:", e.message);
    return null;
  }
}

export async function saveProjectDirectives(projectId, directives) {
  if (!projectId) return null;
  try {
    const res = await fetch("/api/history?action=save_directives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, directives }),
    });
    return await res.json();
  } catch (e) {
    console.warn("[projectDirectives] salvataggio fallito:", e.message);
    return null;
  }
}

// Blocco da anteporre a ogni system prompt AI del progetto.
export function directivesBlock(directives) {
  const d = (directives || "").trim();
  if (!d) return "";
  return `\n\nDIRETTIVE SPECIFICHE DI QUESTO PROGETTO — leggile e RISPETTALE prima di ogni altra regola (sono l'apprendimento accumulato dagli studi e dalle analisi precedenti):\n${d}\n`;
}

// Chiamata AI leggera, in background: rivede le direttive dopo uno studio o
// un'analisi. Non blocca la UI. Ritorna il nuovo testo (già salvato) o null.
export async function refineProjectDirectives({ projectId, kind, current, brandName, context }) {
  if (!projectId) return null;
  const system = `Sei il curatore delle DIRETTIVE DI MARKETING del progetto "${brandName || "progetto"}".
Ti do le direttive attuali e il risultato di ${kind === "analysis" ? "un'analisi Instagram appena conclusa" : "una generazione strategica (Visual Scout) appena conclusa"}.

Riscrivi le direttive del progetto:
- Markdown, SOLO bullet brevi (una riga ciascuno), massimo 14 righe, in italiano.
- Raggruppa se utile sotto poche intestazioni: Tono & stile / Formati che funzionano / Hook & angoli / Errori da evitare / Priorità offerta.
- MANTIENI ciò che è ancora valido, INTEGRA ciò che hai appena imparato, RIMUOVI il superato, il generico o il ridondante. Devono restare concise e operative: guidano i prossimi prompt.
- Niente preamboli, niente spiegazioni, solo i bullet (con eventuali intestazioni). Se non c'è nulla di nuovo di utile, restituisci le direttive attuali invariate.

DIRETTIVE ATTUALI:
${(current || "").trim() || "(nessuna ancora — creale da zero, essenziali e specifiche)"}`;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, messages: [{ role: "user", content: String(context || "").slice(0, 6000) }] }),
    });
    const data = await res.json();
    if (data.error) return null;
    const raw = (data.content || []).map(b => (b.type === "text" ? b.text : "")).filter(Boolean).join("").trim();
    if (raw && raw.length > 12) {
      await saveProjectDirectives(projectId, raw.slice(0, 4000));
      return raw.slice(0, 4000);
    }
  } catch (e) {
    console.warn("[projectDirectives] refine fallito:", e.message);
  }
  return null;
}
