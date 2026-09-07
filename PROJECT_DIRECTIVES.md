# VMScout - Project Directives

Queste direttive devono essere lette prima di ogni operazione sul progetto e aggiornate ogni volta che l'architettura o le regole del progetto cambiano.

---

## 1. Obiettivo e Visione

**VMScout** (Visual Marketing Scout) è un'applicazione "Anti-stock, anti-AI. Solo autenticità". Aiuta i marketer a generare strategie visive, storyboard video, piani editoriali (soprattutto per Social IG/FB) e suggerimenti per post cross-platform. Tema scuro coerente in tutte le sezioni (`#0D0D0D`/`#080808`, accenti gold `#C9A96E`). Supporta più progetti/brand in parallelo (vedi `BrandContext.jsx`), ognuno con il proprio storico di richieste AI e una propria "memoria" accumulata (vedi §5).

---

## 2. Architettura Tecnica

- **Frontend**: Vite + React + Vanilla CSS (no Tailwind).
- **Backend/API**: Vercel Serverless Functions (cartella `api/`).
- **Database**: Turso (libsql/sqlite). Connessione via `api/db.js` con `getDb()`.
- **Provider Foto/Video**: Pexels + Pixabay (chiavi `VITE_PEXELS_KEY`, `VITE_PIXABAY_KEY` lato client).
- **AI**: Anthropic Claude (`ANTHROPIC_API_KEY` lato server, mai esposta al client). `api/chat.js` supporta anche input visivo (vedi §6).
- **Canva**: Connect API v1 (`https://api.canva.com/rest/v1`) con OAuth2 PKCE.

---

## 3. Database — Struttura (Turso)

Tutte le tabelle vengono create in modo **lazy** (`CREATE TABLE IF NOT EXISTS`) dagli endpoint stessi al primo utilizzo — non serve alcuna chiamata di init manuale. `scripts/init_db.js` è disponibile solo come bootstrap opzionale.

- **`projects`**: `id`, `name`, `sector`, `description`, `tone`, `instagram_handle`, `hashtags`, `logo` (data URL, immagine/logo del progetto ridimensionata client-side a 320px), `canva_templates` (JSON), `created_at`, `updated_at`
  Specchio server-side dei progetti/brand gestiti in `BrandContext.jsx` (che resta la fonte di verità immediata via `localStorage`; il DB è lo storico durevole cross-browser). Le colonne aggiunte dopo il `CREATE TABLE` iniziale (es. `logo`) sono create con `ALTER TABLE` lazy e idempotente in `ensureTables()` di `api/history.js`. Logo/edit/elimina progetto si gestiscono dalle card della griglia "Progetti" in `Home.jsx` (`BrandAvatar.jsx` = avatar con logo o iniziale; `fileToResizedDataURL` = resize client-side).
- **`requests`**: `id`, `project_id`, `type` (`strategy` | `analytics`), `prompt`, `result_json`, `created_at`
  Storico di ogni domanda/risposta AI, per progetto. **Non è più un tab a sé stante**: vive dentro ogni sezione che lo genera (vedi §5).
- **`project_insights`**: `project_id` (PK), `data` (JSON: `{ tips[], strengths[], weaknesses[], calendar[] }`), `updated_at`
  La "memoria" del progetto: cresce a ogni analisi Instagram (§5) e viene letta da Visual Scout e Analytics prima di ogni nuova generazione (loop di auto-apprendimento).
- **`canva_auth`**: `id` (fisso a 1), `access_token`, `refresh_token`, `expires_in`, `created_at` — token OAuth Canva.

*Vedi `api/history.js` per lo schema completo delle prime tre tabelle e `api/db.js` (`ensureCanvaAuthTable`) per la quarta.*

---

## 4. API Endpoints

| File | Rotta | Descrizione |
|------|-------|-------------|
| `api/chat.js` | `POST /api/chat` | Proxy Anthropic. Accetta anche `images: [url,...]` opzionale: le scarica e le converte in base64 lato server (niente CORS) per l'analisi visiva |
| `api/history.js` | `GET/POST/DELETE /api/history?action=...` | CRUD progetti, storico richieste AI, memoria di progetto (`projects`, `save_project`, `delete_project`, `save_request`, `history`, `delete_request`, `get_insights`, `merge_insights`, `update_calendar_status`, `stats`) |
| `api/instagram.js` | `POST /api/instagram` | Proxy Instagram/Facebook Graph API — vedi §6 per il routing token |
| `api/canva-auth.js` | `GET /api/canva-auth?action=login\|callback\|status\|logout` | OAuth2 PKCE per Canva Connect |
| `api/canva-upload.js` | `POST /api/canva-upload` | Upload media su Canva (body: `{url, name}`) |
| `api/canva-create.js` | `POST /api/canva-create` | Crea design da template Canva per **una** slide. Body: `caption`, `search_query`, `format`, `templateId`, `cta`, e `imageUrl` opzionale — se il client passa `imageUrl` (foto suggerita scelta a mano nella modale di Visual Scout) si usa quella, altrimenti fallback su ricerca Pexels dalla `search_query` |
| `api/canva-carousel.js` | `POST /api/canva-carousel` | Compone un **carosello intero** in un solo design: upload di tutte le immagini delle slide + un solo autofill su un template con placeholder ripetuti (vedi §7) |
| `api/canva-export.js` | `POST /api/canva-export` | Autofill template Canva con caption/immagine/CTA |
| `api/canva-test.js` | `GET /api/canva-test` | Diagnostica upload Canva |

### canva-upload.js / canva-carousel.js — flusso upload immagini (funzionante)
1. `POST /v1/url-asset-uploads` con `{name, url}` → Canva scarica il media dal URL
2. Poll `GET /v1/url-asset-uploads/{jobId}` ogni 1.5s finché `status=success` (max 20s)
3. `POST /v1/folders/move` con `{to_folder_id: "uploads", item_id: assetId}` → sposta l'asset nella sezione Caricamenti dell'editor (solo `canva-upload.js`)

> **NON usare** `POST /v1/asset-uploads` (binary upload diretto) — richiede TUS protocol complesso e dà errori 415/400. Usare sempre `url-asset-uploads`.

---

## 5. Storico e Memoria di Progetto — vivono nelle sezioni, non in un tab separato

Non esiste più un tab "Storico": ogni sezione mostra e gestisce la propria cronologia inline.

- **Visual Scout** (`src/App.jsx`): la chat stessa È lo storico. Al mount (ogni volta che si entra nel tab o si cambia progetto) `VisualMarketingScout` recupera da `requests` (type=`strategy`) tutti gli scambi passati e li ricostruisce come bolle di chat già presenti, ognuna con un tasto **🗑 Elimina** (rimuove sia dal DB che dalla UI). Ogni nuovo invio viene salvato via `saveToHistory` e il messaggio riceve l'id per poter essere eliminato in seguito.
- **Analytics** (`src/InstagramAnalytics.jsx`): la sessione (post caricati, foto profilo, ultima analisi) resta in `localStorage` così riaprendo il tab non serve ricaricare/rianalizzare da capo. Le analisi precedenti sono in una sezione richiudibile **"🕘 Analisi Precedenti"** in fondo alla pagina (fetch pigro solo quando aperta), con dettaglio espandibile ed eliminazione.
- **Dashboard** (`src/Dashboard.jsx`, nuovo tab): mostra la `project_insights` del progetto attivo — punti di forza, punti da migliorare, consigli accumulati, e il **calendario dei prossimi post** con lo stato (`suggerito`/`generato`). Ogni idea calendario ha un bottone "🎯 Genera con Visual Scout".

### Loop di auto-apprendimento
1. Ogni analisi Instagram (`analyze()` in `InstagramAnalytics.jsx`) chiama `mergeIntoProjectInsights()` → `POST /api/history?action=merge_insights`: aggiunge (deduplicando) nuovi tips/strengths/weaknesses e nuove idee al calendario.
2. Sia `getSystemPrompt()` (Visual Scout) sia il prompt di `analyze()` (Analytics) leggono prima `get_insights` e includono un blocco "MEMORIA DI PROGETTO/MEMORIA ACCUMULATA" nel system prompt, istruendo l'AI a **non ripetere gli stessi consigli** ma a costruirci sopra.
3. Handoff Analytics → Visual Scout: cliccare un'idea (in "Prossimi Post" nell'analisi, o nel calendario della Dashboard) chiama `onSuggestBrief(brief)` → risale fino a `AppRouter.jsx` (`goToScoutWithBrief`) → cambia tab e passa `initialBrief` a `VisualMarketingScout`, che lo invia **da solo** non appena la cronologia è stata idratata (per non perdere il messaggio in una race con l'hydration).

---

## 6. Instagram Analytics — Note Tecniche (IMPORTANTE)

Meta espone **due famiglie di access token non intercambiabili tra host**:

- **`IGAA…`** — token del flusso moderno *"Instagram API with Instagram Login"* (login diretto, nessuna Facebook Page da collegare). Va usato **solo** su `graph.instagram.com`. Nessun concetto di "Page": l'account si legge direttamente con `GET /me?fields=id,username,profile_picture_url`.
- **`EAA…`** — token legacy da Graph API Explorer (Facebook Login + Page collegata a un account IG Business). Va usato su `graph.facebook.com`, con lo step `me/accounts` per individuare la Page e il relativo `instagram_business_account`.

`api/instagram.js` sceglie l'host in automatico in base al prefisso del token (`graphHostFor()`). Usare l'host sbagliato per un token produce l'errore Facebook `"Invalid OAuth access token - Cannot parse access token"` — l'host non riesce nemmeno a interpretare il formato del token, non è un problema di permessi.

`src/InstagramAnalytics.jsx` sanifica il token in input (spazi, a-capo, caratteri invisibili da copia-incolla, prefisso `"Bearer "`, virgolette) sia lato client (`sanitizeToken`) sia lato server (difesa in profondità in `api/instagram.js`).

**Metriche Insights**: `impressions` e `video_views` sono deprecate per gli account moderni. Instagram fallisce l'**intera** chiamata insights se una sola metrica non è valida per quel media/account → `fetchPostInsights()` prova il set esteso (`reach,saved,likes,comments,shares,total_interactions,profile_visits,follows` + `views` per i video) e ricade su quello minimo garantito (`reach,saved` / `+views`). `engRate()` usa `total_interactions` ufficiale, con fallback ricostruito dai singoli campi.

**Panoramica account**: `fetchAccountOverview()` legge `followers_count,media_count,follows_count` + (best-effort, non blocca il flusso post) `reach`/`profile_views` a 28gg (`period=days_28&metric_type=total_value`) e `follower_demographics` con `breakdown=country|age|gender` (richiede >100 follower + `instagram_business_manage_insights`). Reso da `AccountOverviewPanel`. Salvato in `localStorage` (`ig_account`).

**Lista post**: `AllPostsList` mostra **tutti** i post con ordinamento (data ↓ default, data ↑, engagement, reach, interazioni) e le metriche estese per post. La Top 5 per engagement resta separata.

**Analisi visiva**: `analyze()` allega come immagini (via `images` in `api/chat.js`) le foto (`thumbnail_url`/`media_url`) dei post con più engagement, così Claude analizza davvero stile visivo/storytelling, non solo i numeri. `postsSummary` include ora anche `condivisioni`, `interazioni_tot`, `visite_profilo`, `nuovi_follow`; il system prompt riceve `accountCtx` (follower, reach 28gg, top paesi/età). L'output è JSON strutturato con `patterns`, `timing`, `content_pillars`, `visual_storytelling`, `corrections`, `next_posts[]` (ognuna con `hook_type`, `hook`, `visual_scout_brief` pronto per l'handoff). Vedi `AnalysisPanel` in `InstagramAnalytics.jsx` per il renderer.

---

## 7. Regole di Sviluppo

- **Mai aggiungere dipendenze** senza motivo concreto. Mantenere l'app super leggera.
- **JSON strictness**: i prompt AI (Visual Scout e Analytics) chiedono output esclusivamente JSON. Non modificare le strutture senza testare il parsing lato frontend. Campi guidati dai framework: `strategy.framework` (architettura carosello scelta), `post_composer[].hook_type`, e in Analytics `next_posts[].hook_type` + `next_posts[].hook` (prima riga pronta). Sono additivi e resi come badge/citazioni in `StrategyTab`/`PostsTab`/`NextPostCard` — se rimossi la UI degrada senza rompersi.
- **Design System**: tema scuro (`#0D0D0D`/`#080808` sfondo, `#F0EBE3` testo chiaro), accenti gold `#C9A96E`/`#8B7355`, `JetBrains Mono` per tech/etichette, `Instrument Serif` per eleganza, `DM Sans`/`Montserrat` per testi standard.
- **Foto**: usare sempre sia Pexels che Pixabay per diversità. Per i caroselli ogni slide deve avere una `search_query` diversa.
- **Query di ricerca immagini**: preferire soggetti/location ampiamente taggati nelle stock library invece di nomi di luogo di nicchia (spesso restituiscono 0 risultati). `fetchImages`/`fetchVideos` in `App.jsx` fanno comunque un retry automatico allargando la query (tolgono l'ultima parola progressivamente) se la ricerca esatta non trova nulla — vedi `broadenAttempts()`. Ogni `search_query` generata dal system prompt deve essere **globalmente unica** in tutta la risposta (non solo all'interno della singola sezione).
- **Canva senza template fissi per-slide**: `api/canva-carousel.js` compila un intero carosello in una sola chiamata usando un template con placeholder ripetuti `Image_N`/`Testo_N` (configurato una volta in Canva Studio), invece di richiedere un design per slide.
- **Crea design da suggerimento (Visual Scout)**: ogni slide del Post Composer ha il pulsante "✦ Crea design" → `CanvaQuickDesignModal` (portale su `document.body`, dark). Precompilata con caption/query/cta della slide; l'utente sceglie formato (post/story/reel) e UNA foto suggerita (grid da `fetchImages`) o lascia "🔀 Auto". Invia a `/api/canva-create` con `imageUrl` = foto scelta.
- **Toolkit framework marketing**: `src/marketingFrameworks.js` esporta `MARKETING_TOOLKIT` (Visual Scout) e `MARKETING_TOOLKIT_BRIEF` (Analytics) — distillato compatto delle skill in `.claude/skills/` (hook, AIDA/PAS/BAB, architetture carosello, struttura short-form video, content pillar, psicologia della persuasione, value equation, JTBD, test angoli). È iniettato **solo come input** nei system prompt (non allunga l'output → non tocca i limiti di concisione/timeout). Il modello deve applicare i framework in silenzio, senza nominarli nell'output e senza scarsità/urgenza finte. Aggiornare il distillato se si aggiornano le skill upstream.

---

## 8. Deployment

Push su `main` triggera il deploy automatico su Vercel.

### Variabili d'ambiente richieste su Vercel
| Variabile | Scope |
|-----------|-------|
| `ANTHROPIC_API_KEY` | Server |
| `TURSO_DB_URL` | Server |
| `TURSO_AUTH_TOKEN` | Server |
| `CANVA_CLIENT_ID` | Server |
| `CANVA_CLIENT_SECRET` | Server |
| `CANVA_REDIRECT_URI` | Server |
| `VITE_PEXELS_KEY` | Client (build) |
| `VITE_PIXABAY_KEY` | Client (build) |

### `vercel.json`
- Rewrite catch-all verso `index.html` per SPA routing
- `api/canva-upload.js`, `api/canva-create.js`, `api/canva-carousel.js`, `api/chat.js`: `maxDuration: 60` (upload/polling job e analisi visiva possono richiedere più dei 10s di default)
- `api/canva-test.js`: `maxDuration: 30`

---

## 9. Skill di marketing (dev tooling)

`.claude/skills/` contiene le ~50 skill di [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT), versionate nel repo ma **fuori dal bundle** (Vercel builda solo `dist/` + `api/`). Servono a Claude Code durante lo sviluppo di feature marketing; il loro know-how rilevante è distillato in `src/marketingFrameworks.js` per l'uso runtime dell'app. Per aggiornarle: ri-clonare l'upstream, ricopiare `skills/`, rimuovere le cartelle `evals/`, ri-verificare il distillato.
