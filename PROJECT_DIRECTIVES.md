# VMScout - Project Directives

Queste direttive devono essere lette prima di ogni operazione sul progetto e aggiornate ogni volta che l'architettura o le regole del progetto cambiano.

---

## 1. Obiettivo e Visione

**VMScout** (Visual Marketing Scout) è un'applicazione "Anti-stock, anti-AI. Solo autenticità". Aiuta i marketer a generare strategie visive, storyboard video, piani editoriali (soprattutto per Social IG/FB) e suggerimenti per post cross-platform. Estetica "Aesthetic Beige" (#EFE6D5). Supporta più progetti/brand in parallelo (vedi `BrandContext.jsx`), ognuno con il proprio storico di richieste AI.

---

## 2. Architettura Tecnica

- **Frontend**: Vite + React + Vanilla CSS (no Tailwind).
- **Backend/API**: Vercel Serverless Functions (cartella `api/`).
- **Database**: Turso (libsql/sqlite). Connessione via `api/db.js` con `getDb()`.
- **Provider Foto/Video**: Pexels + Pixabay (chiavi `VITE_PEXELS_KEY`, `VITE_PIXABAY_KEY` lato client).
- **AI**: Anthropic Claude (`ANTHROPIC_API_KEY` lato server, mai esposta al client).
- **Canva**: Connect API v1 (`https://api.canva.com/rest/v1`) con OAuth2 PKCE.

---

## 3. Database — Struttura (Turso)

Tutte le tabelle vengono create in modo **lazy** (`CREATE TABLE IF NOT EXISTS`) dagli endpoint stessi al primo utilizzo — non serve alcuna chiamata di init manuale. `scripts/init_db.js` è disponibile solo come bootstrap opzionale.

- **`projects`**: `id`, `name`, `sector`, `description`, `tone`, `instagram_handle`, `hashtags`, `canva_templates` (JSON), `created_at`, `updated_at`
  Specchio server-side dei progetti/brand gestiti in `BrandContext.jsx` (che resta la fonte di verità immediata via `localStorage`; il DB è lo storico durevole cross-browser).
- **`requests`**: `id`, `project_id`, `type` (`strategy` | `analytics`), `prompt`, `result_json`, `created_at`
  Storico di ogni domanda/risposta AI generata da Visual Scout o Analytics, consultabile dal tab **Storico** (`src/History.jsx`).
- **`canva_auth`**: `id` (fisso a 1), `access_token`, `refresh_token`, `expires_in`, `created_at` — token OAuth Canva.

*Vedi `api/history.js` per lo schema completo delle prime due tabelle e `api/db.js` (`ensureCanvaAuthTable`) per la terza.*

---

## 4. API Endpoints

| File | Rotta | Descrizione |
|------|-------|-------------|
| `api/chat.js` | `POST /api/chat` | Proxy Anthropic, mantiene segreta la chiave |
| `api/history.js` | `GET/POST/DELETE /api/history?action=...` | CRUD progetti + storico richieste AI (`projects`, `save_project`, `delete_project`, `save_request`, `history`, `delete_request`, `stats`) |
| `api/instagram.js` | `POST /api/instagram` | Proxy Instagram/Facebook Graph API — vedi §6 per il routing token |
| `api/canva-auth.js` | `GET /api/canva-auth?action=login\|callback\|status\|logout` | OAuth2 PKCE per Canva Connect |
| `api/canva-upload.js` | `POST /api/canva-upload` | Upload media su Canva (body: `{url, name}`) |
| `api/canva-create.js` | `POST /api/canva-create` | Crea design da template Canva (caption + foto Pexels) |
| `api/canva-export.js` | `POST /api/canva-export` | Autofill template Canva con caption/immagine/CTA |
| `api/canva-test.js` | `GET /api/canva-test` | Diagnostica upload Canva |

### canva-upload.js — flusso attuale (funzionante)
1. `POST /v1/url-asset-uploads` con `{name, url}` → Canva scarica il media dal URL
2. Poll `GET /v1/url-asset-uploads/{jobId}` ogni 1.5s finché `status=success` (max 20s)
3. `POST /v1/folders/move` con `{to_folder_id: "uploads", item_id: assetId}` → sposta l'asset nella sezione Caricamenti dell'editor

> **NON usare** `POST /v1/asset-uploads` (binary upload diretto) — richiede TUS protocol complesso e dà errori 415/400. Usare sempre `url-asset-uploads`.

---

## 5. Storico Domande/Risposte

Ogni generazione AI (Visual Scout: brief → strategia completa; Analytics: analisi engagement) viene salvata in modo automatico e silenzioso (`fetch` fire-and-forget, non blocca né rompe la UI se fallisce) nella tabella `requests`, associata al progetto attivo (`project_id`). Il tab **Storico** in `AppRouter.jsx` (componente `src/History.jsx`) mostra l'elenco filtrabile per tipo, con dettaglio JSON espandibile ed eliminazione per singola voce.

Punti di salvataggio:
- `src/App.jsx` → `saveToHistory(...)` dentro `sendMessage`, tipo `"strategy"`.
- `src/InstagramAnalytics.jsx` → `saveToHistory(...)` dentro `analyze()`, tipo `"analytics"`.
- `src/BrandContext.jsx` → `syncProjectToDb`/`deleteProjectFromDb` per creazione/modifica/eliminazione progetti.

---

## 6. Instagram Analytics — Note Tecniche (IMPORTANTE)

Meta espone **due famiglie di access token non intercambiabili tra host**:

- **`IGAA…`** — token del flusso moderno *"Instagram API with Instagram Login"* (login diretto, nessuna Facebook Page da collegare). Va usato **solo** su `graph.instagram.com`. Nessun concetto di "Page": l'account si legge direttamente con `GET /me?fields=id,username`.
- **`EAA…`** — token legacy da Graph API Explorer (Facebook Login + Page collegata a un account IG Business). Va usato su `graph.facebook.com`, con lo step `me/accounts` per individuare la Page e il relativo `instagram_business_account`.

`api/instagram.js` sceglie l'host in automatico in base al prefisso del token (`graphHostFor()`). Usare l'host sbagliato per un token produce l'errore Facebook `"Invalid OAuth access token - Cannot parse access token"` — l'host non riesce nemmeno a interpretare il formato del token, non è un problema di permessi.

`src/InstagramAnalytics.jsx` sanifica il token in input (spazi, a-capo, caratteri invisibili da copia-incolla, prefisso `"Bearer "`, virgolette) sia lato client (`sanitizeToken`) sia lato server (difesa in profondità in `api/instagram.js`), perché anche un solo carattere estraneo nella stringa causa lo stesso errore di parsing.

**Metriche Insights**: `impressions` e `video_views` sono deprecate dalla Instagram Insights API per gli account moderni (Meta risponde con errore "does not support this metric"). Usare `reach,saved` per foto/caroselli e `reach,saved,views` per video/reel.

---

## 7. Regole di Sviluppo

- **Mai aggiungere dipendenze** senza motivo concreto. Mantenere l'app super leggera.
- **JSON strictness**: il prompt AI chiede output esclusivamente JSON. Non modificare la struttura senza testare il parsing lato frontend.
- **Design System**: colori caldi (`#EFE6D5` beige, `#2C2C2C` dark, `#C9A84C` gold), `JetBrains Mono` per tech/etichette, `Instrument Serif` per eleganza, `DM Sans` per testi standard.
- **Foto**: usare sempre sia Pexels che Pixabay per diversità. Per i caroselli ogni slide deve avere una `search_query` diversa.

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
- `api/canva-upload.js`, `api/canva-create.js`: `maxDuration: 60` (necessario per polling job)
- `api/canva-test.js`: `maxDuration: 30`
