# VMScout - Project Directives

Queste direttive devono essere lette prima di ogni operazione sul progetto e aggiornate ogni volta che l'architettura o le regole del progetto cambiano.

---

## 1. Obiettivo e Visione

**VMScout** (Visual Marketing Scout) è un'applicazione "Anti-stock, anti-AI. Solo autenticità". Aiuta i marketer a generare strategie visive, storyboard video, piani editoriali (soprattutto per Social IG/FB) e suggerimenti per post cross-platform. Estetica "Aesthetic Beige" (#EFE6D5).

Il progetto ospita anche **Luxy Experience** — un marketing hub dedicato a `@luxy.exp`, concierge di lusso con base a Ibiza.

---

## 2. Architettura Tecnica

- **Frontend**: Vite + React + Vanilla CSS (no Tailwind).
- **Backend/API**: Vercel Serverless Functions (cartella `api/`).
- **Database**: Turso (libsql/sqlite). Connessione via `api/db.js` con `getDb()`.
- **Provider Foto/Video**: Pexels + Pixabay (chiavi `VITE_PEXELS_KEY`, `VITE_PIXABAY_KEY` lato client).
- **AI**: Anthropic Claude (`ANTHROPIC_API_KEY` lato server, mai esposta al client).
- **Canva**: Connect API v1 (`https://api.canva.com/rest/v1`) con OAuth2 PKCE.

---

## 3. Database Struttura (Turso)

### Tabelle core VMScout
- **`users`**: `id`, `email`, `created_at`
- **`strategies`**: `id`, `user_id`, `brief`, `data` (JSON), `created_at`

### Tabelle Luxy Experience (create via `GET /api/luxy-db?action=init`)
- **`luxy_requests`**: storico richieste AI (type, prompt, result_json, language, tags)
- **`luxy_brand_memory`**: memoria brand persistente (key/value, category) — pre-popolata con dati Luxy
- **`luxy_posts`**: post generati (platform, caption, hashtags, cta, visual_description, search_query, status)
- **`luxy_campaigns`**: campagne (name, goal, target_audience, date range, status)
- **`luxy_canva_auth`**: token OAuth Canva (id=1 fisso, access_token, refresh_token, expires_in, created_at)

*Vedi `api/luxy-db.js` per lo schema completo e il seed della brand memory.*

---

## 4. API Endpoints

| File | Rotta | Descrizione |
|------|-------|-------------|
| `api/chat.js` | `POST /api/chat` | Proxy Anthropic, mantiene segreta la chiave |
| `api/luxy-db.js` | `GET/POST/PUT/DELETE /api/luxy-db?action=...` | CRUD tabelle Luxy (init, save_request, history, memory, save_post, posts, stats, ecc.) |
| `api/canva-auth.js` | `GET /api/canva-auth?action=login\|callback\|status\|logout` | OAuth2 PKCE per Canva Connect |
| `api/canva-upload.js` | `POST /api/canva-upload` | Upload media su Canva (body: `{url, name}`) |
| `api/canva-test.js` | `GET /api/canva-test` | Diagnostica upload Canva |

### canva-upload.js — flusso attuale (funzionante)
1. `POST /v1/url-asset-uploads` con `{name, url}` → Canva scarica il media dal URL
2. Poll `GET /v1/url-asset-uploads/{jobId}` ogni 1.5s finché `status=success` (max 20s)
3. `POST /v1/folders/move` con `{to_folder_id: "uploads", item_id: assetId}` → sposta l'asset nella sezione Caricamenti dell'editor

> **NON usare** `POST /v1/asset-uploads` (binary upload diretto) — richiede TUS protocol complesso e dà errori 415/400. Usare sempre `url-asset-uploads`.

---

## 5. Luxy Experience — Componenti Frontend (`src/LuxyExperience.jsx`)

### Componenti principali
- **`CanvaUploadBtn`**: bottone riutilizzabile, chiama `/api/canva-upload` con l'URL del media
- **`PhotoThumb`**: anteprima immagine con badge source (Pexels/Pixabay), `CanvaUploadBtn`, link esterno
- **`SlidePhotoRow`**: una riga per slide del carosello — mostra badge numero, titolo AI, overlay AI, CopyBtn, foto Pexels, foto Pixabay
- **`CarouselSlideStrip`**: mappa le slide su `SlidePhotoRow`
- **`PexelsPhotoStrip`**: strip foto generiche (non-carosello)
- **`OutputCard`**: card output AI — se `output.slides` esiste usa `CarouselSlideStrip`, altrimenti `PexelsPhotoStrip` + video
- **`detectSlideCount(output)`**: utility — estrae N slide dal titolo o visual_description dell'output AI

### Schema JSON output AI (carosello)
```json
{
  "type": "carousel",
  "title": "...",
  "caption": "...",
  "slides": [
    { "n": 1, "title": "Titolo slide", "overlay": "Testo overlay", "search_query": "ibiza sunset villa" },
    { "n": 2, "title": "...", "overlay": "...", "search_query": "..." }
  ],
  "hashtags": ["..."],
  "visual_description": "...",
  "search_query": "query generica fallback"
}
```
> Le `search_query` devono essere **uniche per ogni slide** — regola enforced nel system prompt.

---

## 6. Canva Connect — Note Tecniche

- **OAuth scope richiesto**: `asset:write` (verificato da JWT decode)
- **Token storage**: Turso `luxy_canva_auth WHERE id=1` — token refresh automatico se scaduto (±120s prima della scadenza)
- **Upload folder ID**: `"uploads"` — è l'ID speciale della cartella Caricamenti in Canva
- **Endpoint corretto**: `POST /rest/v1/url-asset-uploads` (preview API, stabile per immagini e video <100MB)
- **Video**: supportati (mp4/mov), limite 100MB
- **Move API**: `POST /rest/v1/folders/move` — video non supportati per lo spostamento; per immagini funziona regolarmente

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
- `api/canva-upload.js`: `maxDuration: 60` (necessario per polling job)
- `api/canva-test.js`: `maxDuration: 30`
