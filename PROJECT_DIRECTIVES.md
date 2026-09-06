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

- **`projects`**: `id`, `name`, `sector`, `description`, `tone`, `instagram_handle`, `hashtags`, `canva_templates` (JSON), `created_at`, `updated_at`
  Specchio server-side dei progetti/brand gestiti in `BrandContext.jsx` (che resta la fonte di verità immediata via `localStorage`; il DB è lo storico durevole cross-browser).
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
| `api/canva-create.js` | `POST /api/canva-create` | Crea design da template Canva per **una** slide (caption + foto Pexels) |
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

**Metriche Insights**: `impressions` e `video_views` sono deprecate per gli account moderni. Usare `reach,saved` per foto/caroselli e `reach,saved,views` per video/reel.

**Analisi visiva**: `analyze()` allega come immagini (via `images` in `api/chat.js`) le foto (`thumbnail_url`/`media_url`) dei post con più engagement, così Claude analizza davvero stile visivo/storytelling, non solo i numeri. L'output è JSON strutturato (non più markdown libero) con `patterns`, `timing`, `content_pillars`, `visual_storytelling` (style/recurring_elements/storytelling_pattern/strengths/weaknesses), `corrections`, `next_posts[]` (ognuna con `visual_scout_brief` pronto per l'handoff). Vedi `AnalysisPanel` in `InstagramAnalytics.jsx` per il renderer.

---

## 7. Regole di Sviluppo

- **Mai aggiungere dipendenze** senza motivo concreto. Mantenere l'app super leggera.
- **JSON strictness**: i prompt AI (Visual Scout e Analytics) chiedono output esclusivamente JSON. Non modificare le strutture senza testare il parsing lato frontend.
- **Design System**: tema scuro (`#0D0D0D`/`#080808` sfondo, `#F0EBE3` testo chiaro), accenti gold `#C9A96E`/`#8B7355`, `JetBrains Mono` per tech/etichette, `Instrument Serif` per eleganza, `DM Sans`/`Montserrat` per testi standard.
- **Foto**: usare sempre sia Pexels che Pixabay per diversità. Per i caroselli ogni slide deve avere una `search_query` diversa.
- **Query di ricerca immagini**: preferire soggetti/location ampiamente taggati nelle stock library invece di nomi di luogo di nicchia (spesso restituiscono 0 risultati). `fetchImages`/`fetchVideos` in `App.jsx` fanno comunque un retry automatico allargando la query (tolgono l'ultima parola progressivamente) se la ricerca esatta non trova nulla — vedi `broadenAttempts()`. Ogni `search_query` generata dal system prompt deve essere **globalmente unica** in tutta la risposta (non solo all'interno della singola sezione).
- **Canva senza template fissi per-slide**: `api/canva-carousel.js` compila un intero carosello in una sola chiamata usando un template con placeholder ripetuti `Image_N`/`Testo_N` (configurato una volta in Canva Studio), invece di richiedere un design per slide.

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
