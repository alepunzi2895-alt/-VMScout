// ─────────────────────────────────────────────────
// MARKETING FRAMEWORKS TOOLKIT
// ─────────────────────────────────────────────────
// Distillato compatto delle skill di marketing installate in
// `.claude/skills/` (coreyhaines31/marketingskills, licenza MIT): hook,
// framework di copy, architetture carosello, struttura short-form video,
// pillar di contenuto, principi di psicologia della persuasione, value
// equation dell'offerta, Jobs To Be Done, test degli angoli.
//
// Viene iniettato nei system prompt AI (Visual Marketing Scout in
// `App.jsx`, Instagram Analytics in `InstagramAnalytics.jsx`) così ogni
// generazione si appoggia a strutture riconosciute invece di improvvisare.
// È SOLO input: non allunga l'output del modello, quindi non incide sui
// limiti di concisione / timeout documentati in PROJECT_DIRECTIVES.md.
//
// Regola d'uso per il modello: applicare il framework pertinente in
// silenzio, MAI nominarlo nell'output rivolto all'utente finale, MAI usare
// scarsità/urgenza finte.

export const MARKETING_TOOLKIT = `
TOOLKIT FRAMEWORK MARKETING — applica in silenzio quello pertinente, non citare i nomi nell'output, mai scarsità/urgenza finte:

HOOK (la prima riga o il primo frame decide se il resto viene letto):
- Curiosità: "Mi sbagliavo su [credenza comune]" · "Il vero motivo per cui [esito] non è quello che pensi"
- Storia: "3 anni fa [stato passato], oggi [stato attuale]" · "La settimana scorsa è successo [cosa inattesa]"
- Valore: "Come [risultato desiderato] senza [dolore]" · "[N] [cose] che [esito]:" · "Smetti di [errore]. Fai questo:"
- Contrarian: "Opinione impopolare: [affermazione forte]" · "[Consiglio comune] è sbagliato. Ecco perché:"

COPY: chiarezza prima di creatività; benefici prima delle feature; concreto prima di vago (numeri reali, non "ottimizza/innovativo"); lingua del cliente; una sola idea per blocco; voce attiva; niente buzzword, niente punti esclamativi.
STRUTTURE: AIDA (Attenzione-Interesse-Desiderio-Azione) · PAS (Problema-Agitazione-Soluzione) · BAB (Prima-Dopo-Ponte).

CAROSELLO / MULTI-SLIDE: scegli UNA architettura e tienila per tutte le slide —
- Value-Stack: il conteggio esatto è l'hook ("[N] [risorse] per [ruolo]"), una voce concreta per slide, zero riempitivi.
- Problem-Proof: slide 1 = risultato dichiarato come fatto con numero → problema reale → sistema con strumenti/passi nominati → dettaglio salvabile → prova/screenshot finale.
- Hack List: hook contrarian con statistica → una tecnica NOMINATA per slide (contrasto sbagliato/giusto) → sintesi + CTA.
- Rant: opinione forte → escalation con dettagli concreti → "il problema non è X ma Y" → chiusura firmata.
- Demo: mostra i passi di un prodotto/workflow, uno per slide.
Slide 1 è la copertina: deve fermare lo scroll da sola. Un solo template visivo per le slide interne. Ogni slide: una idea + un motivo per swipare.

SHORT-FORM VIDEO: Hook 0-3s (cosa si vede + cosa si sente) → sviluppo per beat narrativi distinti → CTA finale. Si guarda senza audio: testo on-screen sempre. Tipi di hook video: Segreto / Scoperta inattesa / Domanda / Promessa / Warning / Trasformazione.

PILLAR DI CONTENUTO: 3-5 temi ricorrenti che uniscono expertise e interessi del pubblico. Mix indicativo: educativo ~25% / dietro le quinte ~25% / insight di settore ~30% / personale ~15% / promo ≤5-10%. Ogni contenuto deve essere ricercabile, condivisibile o entrambi.

PSICOLOGIA DELLA PERSUASIONE (uso etico): riprova sociale · autorità/credenziali · reciprocità (dai prima di chiedere) · scarsità/urgenza REALE · avversione alla perdita (cosa si perde a non agire) · ancoraggio · framing (stessa cosa, inquadratura diversa) · effetto peak-end (cura picco e finale) · effetto Zeigarnik (loop aperti che spingono a continuare) · effetto mera esposizione (presenza costante e coerente).

OFFERTA — Value Equation: Valore = (Risultato sognato × Probabilità percepita di riuscita) / (Ritardo temporale × Sforzo e sacrificio). Se qualcosa non converte, alza il numeratore (risultato più grande e specifico, prove, garanzie) o abbassa il denominatore (primo risultato più rapido, meno attrito) prima di toccare il prezzo.

JOBS TO BE DONE: il cliente "assume" il prodotto per ottenere un risultato — inquadra il messaggio attorno al lavoro da fare e alla trasformazione, non alle caratteristiche.

ANGOLI / TEST: varia un angolo alla volta (dolore, desiderio, obiezione, identità, status) per scoprire cosa risuona; ogni idea successiva deve esplorare un angolo o un formato diverso dalla precedente.
`.trim();

// Versione condensata per l'Analytics, dove il prompt è molto vincolato in
// concisione: solo i framework utili a proporre `next_posts` e i
// `visual_scout_brief`.
export const MARKETING_TOOLKIT_BRIEF = `
TOOLKIT FRAMEWORK (applica in silenzio, non nominarli, mai scarsità finta):
- HOOK prima riga/frame: Curiosità · Storia (prima→dopo) · Valore ("come [X] senza [Y]", liste numerate) · Contrarian.
- COPY: chiarezza>creatività, benefici>feature, numeri concreti, lingua del cliente. Strutture: AIDA · PAS · BAB.
- CAROSELLO: una sola architettura per tutte le slide — Value-Stack (conteggio esatto) · Problem-Proof (risultato→sistema→prova) · Hack List (tecniche nominate) · Rant · Demo. Slide 1 = copertina scroll-stopper.
- VIDEO SHORT: hook 0-3s → beat distinti → CTA; testo on-screen sempre.
- PILLAR: 3-5 temi ricorrenti; mix educativo/dietro le quinte/insight/personale/promo(≤10%).
- PSICOLOGIA (etica): riprova sociale, autorità, reciprocità, scarsità reale, avversione alla perdita, ancoraggio, framing, peak-end, Zeigarnik.
- OFFERTA (Value Equation): Valore = (risultato sognato × probabilità percepita) / (tempo × sforzo).
- JTBD: messaggio sul lavoro da fare e sulla trasformazione, non sulle feature.
- ANGOLI: un angolo per volta (dolore/desiderio/obiezione/identità); ogni idea diversa dalla precedente per angolo E formato.
`.trim();
