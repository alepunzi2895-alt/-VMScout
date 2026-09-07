# Loop di Auto-Apprendimento del Progetto

Ogni progetto/brand in VMScout ha una **memoria propria** che migliora a ogni
studio (Visual Scout) e a ogni analisi (Analytics). L'obiettivo: più usi un
progetto, più le risposte dell'AI diventano precise e focalizzate su *quel*
brand, invece di ripartire ogni volta da zero.

---

## 1. Cosa viene accumulato

Tutto vive in **`project_insights.data`** (tabella Turso, una riga per progetto,
JSON). Chiave per chiave:

| Campo | Cos'è | Chi lo scrive |
|-------|-------|---------------|
| `directives` | **Le direttive specifiche del progetto** — un brief operativo in markdown (bullet brevi): tono & stile, formati che funzionano, hook/angoli che risuonano, errori da evitare, priorità dell'offerta. | L'AI, alla fine di **ogni** studio e analisi (riscrittura completa, vedi §3) |
| `directives_updated_at` | Timestamp dell'ultima riscrittura | idem |
| `strengths` / `weaknesses` | Punti di forza / debolezze confermati | `merge_insights` dopo un'analisi Instagram |
| `tips` | Consigli accumulati (deduplicati, max 30) | `merge_insights` |
| `calendar` | Idee "prossimo post" con stato `suggerito`/`generato` | `merge_insights` + handoff verso Visual Scout |

Le `directives` sono la parte **guida**: sintetiche, curate, sempre valide.
`strengths`/`weaknesses`/`tips` sono lo storico grezzo da cui le direttive
vengono distillate.

---

## 2. PRIMA di ogni prompt — lettura

Le direttive vengono anteposte a ogni system prompt AI del progetto, con priorità
massima:

```
DIRETTIVE SPECIFICHE DI QUESTO PROGETTO — leggile e RISPETTALE prima di ogni
altra regola (sono l'apprendimento accumulato dagli studi e dalle analisi
precedenti):
<contenuto di directives>
```

Punti di iniezione (`src/projectDirectives.js` → `directivesBlock()`):

- **Visual Scout** — `getSystemPrompt()` in `src/App.jsx` (studio strategico completo)
- **Analytics** — `textSystem` di `analyze()` in `src/InstagramAnalytics.jsx` (analisi Instagram)

> La riformulazione di singola slide (`REGEN_SLIDE_PROMPT`) e il carosello non
> iniettano le direttive per ora: sono operazioni derivate, non "studi" nuovi.
> Se serve, aggiungere lì `directivesBlock()` allo stesso modo.

---

## 3. DOPO ogni studio/analisi — riscrittura

Appena un risultato è pronto e mostrato all'utente, parte **in background** una
chiamata AI leggera e separata (`refineProjectDirectives()` in
`src/projectDirectives.js`) che:

1. riceve **le direttive attuali** + una **sintesi compatta** di ciò che è appena
   stato prodotto (framework scelto, hook, pillar, correzioni, stile visivo…);
2. riscrive le direttive: markdown, solo bullet, max ~14 righe, in italiano;
3. **mantiene** ciò che è ancora valido, **integra** il nuovo, **rimuove** il
   superato / generico / ridondante;
4. salva via `POST /api/history?action=save_directives`.

Caratteristiche volute:

- **Non blocca la UI** — l'utente vede subito la strategia/analisi; le direttive
  si aggiornano poco dopo, in silenzio.
- **Nessun impatto sui timeout** dei prompt principali — è una chiamata a parte,
  input piccolo, output ~150 parole.
- **Convergenza, non deriva** — l'istruzione è *raffinare e potare*, non
  riscrivere da capo; se non c'è nulla di nuovo di utile, restituisce le
  direttive invariate. Cap fisso a 4000 caratteri lato server.

---

## 4. Dove l'utente le vede / modifica

**Dashboard → "🎯 Direttive di progetto"** (`DirectivesCard` in `src/Dashboard.jsx`):
mostra il testo corrente + data di aggiornamento, con "Modifica" per correggerle a
mano. Le modifiche manuali diventano la nuova base che l'AI raffinerà al giro
dopo.

---

## 5. Flusso completo

```
                    ┌─────────────────────────────────────────┐
                    │  project_insights.data.directives        │
                    │  (brief operativo del progetto)          │
                    └───────────────┬─────────────────────────┘
                                    │ letto (directivesBlock)
                 ┌──────────────────┼──────────────────┐
                 ▼                                     ▼
        Visual Scout — studio                 Analytics — analisi IG
        getSystemPrompt()                     analyze() textSystem
                 │                                     │
                 ▼ risultato mostrato                  ▼ risultato mostrato
                 │                                     │
                 └───────────┬─────────────────────────┘
                             ▼  (background, non blocca)
                  refineProjectDirectives()
                  = direttive attuali + sintesi risultato → nuove direttive
                             │
                             ▼
                  POST save_directives  ──►  torna al blocco in alto
```

---

## 6. File coinvolti

| File | Ruolo |
|------|-------|
| `src/projectDirectives.js` | `directivesBlock()`, `refineProjectDirectives()`, `saveProjectDirectives()`, `fetchProjectInsights()` |
| `src/App.jsx` | inietta le direttive in `getSystemPrompt()`; chiama `refineProjectDirectives` dopo ogni strategia |
| `src/InstagramAnalytics.jsx` | inietta le direttive in `analyze()`; chiama `refineProjectDirectives` dopo ogni analisi |
| `src/Dashboard.jsx` | `DirectivesCard` — visualizzazione + modifica manuale |
| `api/history.js` | azioni `save_directives`, `get_insights` (ritorna `directives`), `merge_insights` (accetta anche `directives`) |

---

## 7. Estensioni possibili

- Iniettare le direttive anche in `REGEN_SLIDE_PROMPT` e nel prompt del carosello.
- Versionare le direttive (storico delle riscritture) per poter tornare indietro.
- Un pulsante "rigenera direttive ora" nella Dashboard che rilancia `refine`
  sull'ultima analisi + ultimo studio.
