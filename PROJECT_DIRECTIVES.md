# VMScout - Project Directives

Queste direttive devono essere lette prima di ogni operazione sul progetto e aggiornate ogni volta che l'architettura o le regole del progetto cambiano.

---

## 1. Obiettivo e Visione

**VMScout** (Visual Marketing Scout) è un'applicazione "Anti-stock, anti-AI. Solo autenticità". Aiuta i marketer a generare strategie visive, storyboard video, piani editoriali (soprattutto per Social IG/FB) e suggerimenti per post cross-platform. Tema scuro coerente in tutte le sezioni (`#0D0D0D`/`#080808`, accenti gold `#C9A96E`).

**Multi-utente (dal 2026-09-09).** Login obbligatorio con **nickname + password** (nessuna email). Ogni utente vede/gestisce SOLO i propri progetti e la propria connessione Canva/Facebook. Il primo utente registrato ha ereditato i progetti + i token OAuth legacy esistenti. Ogni progetto ha il proprio storico di richieste AI e una "memoria" accumulata (vedi §5). Auth: helper in `api/db.js`, endpoint come `?action=auth_*` in `api/history.js`, gate lato client in `src/AuthContext.jsx` + `src/AppRouter.jsx` + `src/LoginScreen.jsx`.

**Isolamento per-utente completo.** (a) *Progetti*: scoping `user_id` su tutte le action di `history.js`. (b) *localStorage*: `src/userStorage.js` → `userLS(uid)` namespacizza le chiavi come `u_<uid>_<key>`; `BrandContext.jsx` usa `vmscout_brands_<uid>`; `InstagramAnalytics.jsx` (`AdsPanel` + main) usa `userLS` per token IG, cache post/analisi e sponsorizzate (`ig_*`, `fb_ads_*`, `fb_ad_account`). `AuthContext.logout()` chiama `userLS.clearFor(uid)` (azzera `u_<uid>_*` + chiavi legacy). (c) *Credenziali OAuth di terze parti*: ogni utente imposta **App ID/Secret Meta** e **Client ID/Secret Canva** della PROPRIA app nel tab **Impostazioni** (`src/Settings.jsx`). Tabella `app_config_u`, helper `getAppConfig(db, userId)` in `api/db.js` (fallback a env se l'utente non ha impostato nulla → alessandro continua a funzionare con le env di Vercel). Endpoint `get_app_config` (vista non-segreta: solo flag "secret set") / `save_app_config` in `history.js`. Consumatori: `canva-auth.js`, `canva-lib.js` (`getCanvaToken`), `instagram.js` (`fb_login`/callback/`connect_token`) risolvono le credenziali per-utente. I secret sono salvati in chiaro sul DB (come `TURSO_DB_TOKEN`) ma non escono MAI dal server verso il client. Redirect URL restano unici: `…/api/canva-auth` e `…/api/instagram`.

**Meta Ads = solo token (dal 2026-09-09).** `AdsPanel` in stato disconnesso mostra SOLO l'incolla-token con i passaggi numerati (niente più bottone OAuth "Connetti Facebook"). `connect_token` converte il token in long-lived usando App ID/Secret dell'utente (da Impostazioni); senza, usa il token così com'è.

**Multilingua (dal 2026-09-09).** UI in **IT · EN · ES · FR · DE**, selettore lingua (bandierine SVG — `src/Flag.jsx` — le flag-emoji non si vedono su Windows) nella nav e nel login; la lingua è salvata sull'account (`vms_users.lang`) e in `localStorage["vms_lang"]` pre-login. Infrastruttura: `src/i18n/index.jsx` (`LangProvider`, `useT()`, `fmtDate/fmtDateTime/weekdaysShort`) + catalogo `src/i18n/strings.js` (chiavi a punti, `{var}` interpolati). I CONTENUTI generati dall'AI restano multilingua a parte (captions/cta in it/en/es dal modello). **Copertura i18n:** completa su nav, login, Home, Dashboard, Canva Studio, tab **Impostazioni** (`src/Settings.jsx`), la shell di Visual Scout (hero, input, tab, pulsanti compositori, Riformula) + sezioni/StatCard/pulsanti di Analytics e i passaggi di setup di `AdsPanel` (`an.ads.*`). **Da tradurre ancora (coda lunga):** sotto-intestazioni dentro i tab risultato di Visual Scout (`StrategyTab`/`PostsTab`/`EditorialTab`/`SponsorTab`), micro-copy profonda residua di `InstagramAnalytics.jsx` (`ConnectPanel` IG, celle/opzioni delle sponsorizzate caricate), tooltip SVG di `AnalyticsCharts.jsx`. Nuove stringhe UI → sempre via `t("chiave")`, mai hard-coded.

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
  **Anti-progetti-fantasma** (`BrandContext.jsx`): il progetto di default vuoto ("Il Mio Brand" senza contenuto) NON viene mai sincronizzato sul DB né ripescato dall'hydration — prima ogni browser nuovo ne creava uno. `isMeaningful()` = ha contenuto o è rinominato; solo quelli si sincronizzano / si mostrano. `dedupeEmptyDefaults()` collassa i doppioni in `localStorage`. All'avvio `cleanup_empty_projects` (POST) elimina dal DB le righe default-vuote **senza** dati associati (nessuna richiesta/insight/design) — provabilmente safe.
- **`requests`**: `id`, `project_id`, `type` (`strategy` | `analytics`), `prompt`, `result_json`, `created_at`
  Storico di ogni domanda/risposta AI, per progetto. **Non è più un tab a sé stante**: vive dentro ogni sezione che lo genera (vedi §5).
- **`project_insights`**: `project_id` (PK), `data` (JSON: `{ tips[], strengths[], weaknesses[], calendar[], directives, directives_updated_at }`), `updated_at`
  La "memoria" del progetto. `directives` = brief operativo per-progetto (markdown), letto prima di **ogni** studio/analisi e riscritto dall'AI in background alla fine di ognuno — vedi **`docs/PROJECT_LEARNING_LOOP.md`**. `tips`/`strengths`/`weaknesses`/`calendar` crescono a ogni analisi Instagram (§5).
- **`canva_designs`**: `id`, `project_id`, `kind` (`design` | `carousel`), `format`, `title`, `design_url`, `thumb_url` (foto principale usata), `slides`, `created_at`
  Storico dei design Canva creati dall'app. Il frontend chiama `save_design` dopo ogni `/api/canva-create` / `/api/canva-carousel` riuscito (helper in `src/canvaDesigns.js`). Renderizzato nella galleria "Design creati" di Canva Studio (`CreatedDesignsPanel`) e riusabile come pagina nel `CarouselComposer` (via `thumb_url`).
- **`vms_users`**: `id` (UUID), `nickname`, `nickname_lower` (UNIQUE, per lookup case-insensitive), `pass_hash` (`scrypt$N$r$p$salt$hash`, node crypto), `lang`, `created_at`. ⚠️ nome `vms_` perché sul DB Turso esiste già una tabella `users`.
- **`vms_sessions`**: `token_hash` (PK, sha256 del token — il raw sta solo nel cookie `vms_sess` HttpOnly/Secure/SameSite=Lax, 400gg), `user_id`, `expires_at`, `user_agent`.
- **`canva_auth_u`** / **`fb_auth_u`**: token OAuth **per-utente** (`user_id` PK). Le vecchie `canva_auth`/`fb_auth` a riga unica (`id=1`) restano solo per la migrazione one-shot fatta all'atto della registrazione del primo utente.
- **`user_id`** aggiunto (ALTER lazy) a `projects` / `requests` / `canva_designs` / `project_insights` — ogni action di `history.js` filtra/scrive per utente della sessione (`getSessionUser` + `assertOwnsProject` in `api/db.js`). `getCanvaToken(db, userId)` / `getFbToken(db, userId)` in `canva-lib.js`/`instagram.js`; ogni `canva-*`/`instagram.js` risolve la sessione dal cookie; l'OAuth callback porta l'user id in uno `state` firmato HMAC.

*Vedi `api/history.js` (schema + auth actions) e `api/db.js` (`ensureAuthTables`, helper scrypt/cookie/sessione).*

---

## 4. API Endpoints

| File | Rotta | Descrizione |
|------|-------|-------------|
| `api/chat.js` | `POST /api/chat` | Proxy Anthropic. Accetta anche `images: [url,...]` opzionale: le scarica e le converte in base64 lato server (niente CORS) per l'analisi visiva |
| `api/history.js` | `GET/POST/DELETE /api/history?action=...` | CRUD progetti, storico richieste AI, memoria + direttive di progetto, storico design Canva (`projects`, `save_project`, `delete_project`, `save_request`, `history`, `delete_request`, `get_insights`, `merge_insights`, `save_directives`, `update_calendar_status`, `stats`, `save_design`, `designs`, `delete_design`) |
| `api/instagram.js` | `POST /api/instagram` | Proxy Instagram/Facebook Graph API — vedi §6 per il routing token |
| `api/canva-auth.js` | `GET /api/canva-auth?action=login\|callback\|status\|logout` | OAuth2 PKCE per Canva Connect |
| `api/canva-upload.js` | `POST /api/canva-upload` (`{url}` o `{b64}` = clip ritagliata) · `GET ?src=<url>` = proxy video a finestre di 2MB, `no-store` | Upload media su Canva + proxy anteprime video. Vedi §7 |
| `api/canva-create.js` | `POST /api/canva-create` | Crea design da template Canva per **una** slide/story. Body: `caption`, `search_query`, `format`, `templateId`, `cta`, + `imageUrl`/`videoUrl`/`mediaType`/`assetId` opzionali (`assetId` = asset Canva già caricato, es. clip ritagliata → salta l'upload). **Reel = sempre video**; **Story = foto o video**; post = foto. Usato per-frame dal tab Story |
| `api/canva-carousel.js` | `POST /api/canva-carousel` | **Carosello intero in un solo design** (FOTO/VIDEO, anche misti): upload media + **un solo autofill** (`Testo_1..N`/`Immagine_1..N`) sul Brand Template a 6 pagine + `trimTrailingPages` se N<6. Tipo media PER SLIDE (`media_kind`/dedotto da `video_url`), `media` = default globale. Body: `slides[]`, `carouselTemplateId`, `format`. Vedi §7 |
| `api/canva-export.js` | `POST /api/canva-export` | Autofill template Canva con caption/immagine/CTA (legacy, non più chiamato dal frontend) |
| `api/canva-test.js` | `GET /api/canva-test` | Diagnostica upload Canva |

### Upload immagini su Canva — `uploadUrlAsset()` in `api/canva-lib.js`
Due metodi, in cascata:
1. **Binario (preferito)** — VMScout scarica i byte dell'immagine (già ridimensionata da `sizedImageUrl`, 1280px) e li invia con `POST /v1/asset-uploads` (`Content-Type: application/octet-stream`, header `Asset-Upload-Metadata: {"name_base64": "..."}`), poi poll `GET /v1/asset-uploads/{jobId}`. Il job si chiude in pochi secondi perché Canva non deve fare un fetch esterno.
2. **Fallback** — `POST /v1/url-asset-uploads` con `{name, url}`: Canva scarica lei dal URL. Era l'unico metodo e lasciava il job `in_progress` 40s+ (timeout) su foto Unsplash/Pexels grandi. Su risposta 400 "already exists" (Canva deduplica per URL) si ritenta con URL reso univoco (`bustedUrl`).

`canva-upload.js` (media scelti a mano nel CarouselComposer) usa ancora solo il metodo 2 + `POST /v1/folders/move` (`to_folder_id: "uploads"`) per far comparire l'asset nel tab Caricamenti.

> Tutte le funzioni di polling (`uploadUrlAsset`, `runAutofill`, `trimTrailingPages`) accettano una `deadline` assoluta che il chiamante calcola per tenere l'intera richiesta sotto `maxDuration:60`.

### `canva-create` / `canva-carousel` lavorano a CICLI (client polling)
Canva a volte impiega minuti per elaborare upload/autofill → non c'è modo di stare in un singolo serverless call. Il flusso:
1. Client `POST` col body normale.
2. Il server fa fino a ~48s di lavoro; se un job Canva è ancora in corso risponde **HTTP 202** `{ pending: true, phase, resume: {...} }`. `resume` contiene solo job-id opachi di Canva (nessuna tabella DB).
3. Il client (`handleCreate` in `App.jsx`) rimanda `{ ...body, resume }` ogni 3s finché ottiene `{ ok }` o un errore. Cap client: 5 minuti. Il pulsante mostra `progress` ("Caricamento sfondo…" / "Composizione…").
`uploadUrlAsset` e `runAutofill` accettano `resumeJobId` per riprendere il solo polling. Stati `resume`: **canva-create** `upload` → `autofill`; **canva-carousel** `upload` (job asset-uploads, `slots[]`) → `autofill` (un solo job, poi `trimTrailingPages`).

### Token OAuth Canva — `getCanvaToken(db)` in `api/canva-lib.js` (punto UNICO)
Ogni endpoint Canva (`canva-create`, `canva-carousel`, `canva-scaffold`, `canva-upload`, `canva-export`) legge il token **solo** da qui. Canva **ruota** il `refresh_token` a ogni `POST /v1/oauth/token`: la risposta contiene un nuovo `refresh_token` e quello usato viene invalidato subito. `getCanvaToken` ripersiste sempre `td.refresh_token` in `canva_auth`; se il refresh fallisce lancia `CANVA_NOT_CONNECTED` invece di ricadere su un access_token scaduto (→ era la causa di *"Access token is invalid"*: gli endpoint rinnovavano l'access_token senza salvare il refresh_token ruotato, e la volta dopo il refresh moriva). *Sta in `canva-lib.js` e non in un file suo per non superare il limite di 12 Serverless Functions del deploy — ogni file in `api/` conta come funzione.*

### Autofill — `api/canva-lib.js` `runAutofill()` (condiviso da canva-create / canva-carousel / canva-export)
Canva ha **rimosso** il vecchio `POST /v1/designs/templates/{id}/autofill` (→ `Unknown endpoint`). Flusso corrente:
1. `GET /v1/brand-templates/{id}/dataset` → filtra `data` ai soli campi definiti (Canva rifiuta chiavi sconosciute)
2. `POST /v1/autofills` con `{type:"create_from_brand_template", brand_template_id, data, title}` → job async
3. Poll `GET /v1/autofills/{jobId}` ogni 1.5s finché `status=success` (ceiling 35s per stare sotto `maxDuration:60`)
4. Risultato in `job.result.design` (o `job.design`) → `{id, url}`

> Serve un ID di **Brand Template** (design pubblicato come "Modello del brand", URL `canva.com/brand-templates/<ID>`), **non** l'ID di un design. `cleanTemplateId()` normalizza gli incolla sporchi. L'autofill richiede piano Canva **Enterprise** (trial sui piani a pagamento durante lo sviluppo).

### Campi autofill dei template (ricostruiti a mano in Canva il 2026-09-09)
⚠️ **Nessun template aveva davvero un campo immagine di autofill** — Post/Story/Reel avevano solo testo + "Sfondo" = colore pieno; il "post funziona" era falso (mai verificato visivamente). Rifatti così via browser automation (dettagli in memory [[project-canva-upload-saga]]):
- **post / story / reel** (`EAHUiCrR7F8` / `EAHUiDPEzhU` / `EAHUiIqblm4`): aggiunta una **cornice** (Elementi → Cornici) full-bleed a dimensione pagina (1080×1080 o 1080×1920, X/Y 0) dietro al testo, connessa via "Crea in blocco" → colonna `Immagine_Sfondo` (image) → "Associa i campi automaticamente". Campo testo `Testo_Post` c'era già.
- **carosello** (`EAHUiOe8TUA`): 6 pagine, ognuna con una cornice full-bleed (copiata con Ctrl+C/V) connessa a `Immagine_1..6`; testo `Testo_1..6`. "Associa i campi automaticamente" ha mappato tutti e 12. ⚠️ Le cornici copincollate finiscono SOPRA il testo → click destro → Livello → "Sposta in secondo piano" su ogni pagina 2-6, poi ripubblicare.
- Trucco tabella "Crea in blocco": "Aggiungi immagine" NON preseleziona l'header → scrivi `_N` per fare `Immagine_N` da `Immagine`. NON rinominare via doppio-click (scrolla e colpisce colonna 1).
- **Video**: la cornice `Immagine_Sfondo` accetta anche un video — autofill `{ type: "video", asset_id }` (funzione preview Canva, **verificata funzionante**). Reel = sempre video, Story = foto o video.
- Non abbiamo lo scope `brandtemplate:content:read` → `runAutofill` non legge il dataset. `/api/canva-test?dataset=<id>` dà 403. Si verifica solo con l'autofill vero + apertura del design.

### Carosello = un solo design (dal 2026-09-09)
`canva-carousel.js`: carica gli N media → **un solo `runAutofill`** su `carouselTemplateId` (`EAHUiOe8TUA`) con `Testo_1..N` + `Immagine_1..N` (+ alias `Image_N`/`Sfondo_N`/`Caption_N`) → `trimTrailingPages()` se N<6 → un unico design a N pagine. Fasi cicliche `resume.stage`: `upload` → `autofill`. Gli slot hanno `kind` "image"|"video" per pollare l'endpoint giusto.
- **Foto**: frontend `CarouselComposer` (tab Post) → `carouselTemplateId`, `CAROUSEL_MAX_PAGES = 6`.
- **Video**: frontend `VideoCarouselComposer` (tab Video Storytelling) → `media: "video"`. Una pagina per scena. Editor di ritaglio per scena (`VideoTrimmer`): anteprima + due maniglie per scegliere `[trimStart,trimEnd]` (default `0 → scene.duration`). Cap client 6 min.

### Story = una story per frame (dal 2026-09-09)
Le Story su Instagram sono card separate → NON un multi-pagina. Tab **Story** (`StoryTab`): deriva N frame da `post_composer` (o storyboard), suggerisce foto **e** video per ogni frame. `StoryComposer` → loop `POST /api/canva-create` `format:"story"` per frame (template Story `EAHUiDPEzhU`, 1 pagina, `Immagine_Sfondo`/`Testo_Post`) → lista di link. Toggle foto/video per frame; video ritagliati a `STORY_CLIP_SEC`=5s con `recordVideoSegment` → `canva-create` con `assetId`.

### Riformula con indicazioni (dal 2026-09-09)
`RegenBox` (chiaro) / `RegenBoxDark` (modali): pulsante **⟳ Riformula** che si espande in un campo di indicazioni. `notes` vuoto → versione completamente nuova; `notes` compilato → riformulazione **mirata** (cambia solo ciò che l'utente chiede). `callRegen(promptText)` → `/api/chat` `{system, messages}` → JSON.
- Post: `PostsTab` → `regenItem("slide", …)` aggiorna `data.post_composer[i]`.
- Video: `VideoTab` scene → `regenItem("scene", …)` aggiorna `data.video_storytelling.scenes[i]` (`REGEN_SCENE_PROMPT`).
- Story: `StoryTab` frame → stato locale (`frames`), non tocca i post (`REGEN_ROW_PROMPT`).
- Caroselli: `CarouselComposer` / `VideoCarouselComposer` / `StoryComposer` → `regenRow(i, notes)` riformula testo overlay + query della riga (`REGEN_ROW_PROMPT`), resetta il media scelto.

### Anteprima e ritaglio video nel browser (dal 2026-09-09)
- **Proxy** `GET /api/canva-upload?src=<url>` (Pexels/Pixabay bloccano l'hotlink cross-origin col header `Origin`). Serve il `Range` a **finestre di 2MB**, `Cache-Control: no-store` (la CDN di Vercel non varia per `Range` → serviva 200+Content-Range e bloccava il tag `<video>`). NIENTE streaming/`pipe` (su Vercel non arriva mai al `<video>`).
- **`getVideoBlob(url)`** (App.jsx): scarica l'intera rendition una volta (`fetchProxiedFull`, loop di finestre da 2MB) → `Blob` → `blob:` URL, in cache. Il `<video>` fa seeking/play in locale, zero rete. Usato da `VideoTrimmer`, `HoverVideoThumb` (poster `<img>` + play-on-click) e dal ritaglio.
- **Ritaglio = `recordVideoSegment`** via **MediaRecorder** (NON ffmpeg.wasm): riproduce il `blob:` dal secondo X al secondo Y, `video.captureStream()` → `MediaRecorder` (`video/mp4;codecs=avc1`, WebM di ripiego) → blob. In tempo reale, ri-codificato. `handleCreate` registra ogni scena → `POST /api/canva-upload {b64}` → `startBytesUpload` (binario, ≤45MB) → `asset_id` → `slides[].asset_id`. Se fallisce → fallback `video_url` (Canva scarica l'URL) con warning. Cap clip 3.8MB.
- La rendition Pexels scelta da `parse` è ~540-1000px (leggera per anteprima + record + upload b64 sotto il limite ~4.5MB di Vercel).

> Scartato: **ffmpeg.wasm** — ogni core ≤0.11 richiede `SharedArrayBuffer` (→ header COOP/COEP su tutta l'app, romperebbe img Pexels/Unsplash + popup OAuth Canva); la 0.12 (single-thread, no SAB) fallisce sul Worker cross-origin / `importScripts` del blob.
> Scartato: **Design Merge API** (`POST /v1/merges` `insert_pages`) per unire N design da 1 pagina — è preview, per l'account risponde `success` ma NON aggiunge pagine. Helper rimossi; `startAutofillJob`/`checkAutofillJob` restano in canva-lib.js inutilizzati.

---

## 5. Storico e Memoria di Progetto — vivono nelle sezioni, non in un tab separato

Non esiste più un tab "Storico": ogni sezione mostra e gestisce la propria cronologia inline.

- **Visual Scout** (`src/App.jsx`): la chat stessa È lo storico. Al mount (ogni volta che si entra nel tab o si cambia progetto) `VisualMarketingScout` recupera da `requests` (type=`strategy`) tutti gli scambi passati e li ricostruisce come bolle di chat già presenti, ognuna con un tasto **🗑 Elimina** (rimuove sia dal DB che dalla UI). Ogni nuovo invio viene salvato via `saveToHistory` e il messaggio riceve l'id per poter essere eliminato in seguito.
- **Analytics** (`src/InstagramAnalytics.jsx`): la sessione (post caricati, foto profilo, ultima analisi) resta in `localStorage` così riaprendo il tab non serve ricaricare/rianalizzare da capo. Le analisi precedenti sono in una sezione richiudibile **"🕘 Analisi Precedenti"** in fondo alla pagina (fetch pigro solo quando aperta), con dettaglio espandibile ed eliminazione.
- **Dashboard** (`src/Dashboard.jsx`, nuovo tab): mostra la `project_insights` del progetto attivo — punti di forza, punti da migliorare, consigli accumulati, e il **calendario dei prossimi post** con lo stato (`suggerito`/`generato`). Ogni idea calendario ha un bottone "🎯 Genera con Visual Scout".

### Loop di auto-apprendimento — **vedi `docs/PROJECT_LEARNING_LOOP.md` per il quadro completo**
1. **Direttive di progetto** (`project_insights.data.directives`, markdown): lette prima di **ogni** studio (Visual Scout) e analisi (Analytics) via `directivesBlock()` (`src/projectDirectives.js`), con priorità massima nel system prompt. Alla fine di ogni studio/analisi parte **in background** `refineProjectDirectives()` — chiamata AI separata e leggera che riscrive le direttive tenendo il valido e potando il resto (non blocca la UI, non tocca i timeout dei prompt principali). Visualizzate/editabili in Dashboard (`DirectivesCard`).
2. Ogni analisi Instagram chiama anche `mergeIntoProjectInsights()` → `merge_insights`: aggiunge (deduplicando) nuovi tips/strengths/weaknesses e nuove idee al calendario. `getSystemPrompt()` e `analyze()` includono anche il blocco "MEMORIA DI PROGETTO/MEMORIA ACCUMULATA".
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

**Reach demografico (2026-09-09)**: Instagram **NON** espone reach per età/genere/paese sul singolo post — l'unico `breakdown` per media è `follow_type` (follower / non-follower). Perciò:
- **Per-post**: `fetchPostInsights()` fa una call extra `reach&breakdown=follow_type` → `m.reach_follower` / `m.reach_non_follower`. `AllPostsRow` è espandibile (chevron) → `ReachSplitBar` mostra la barra follower/non-follower + "% scoperta".
- **Livello account**: `ReachedAudiencePanel` (nuovo, sotto `AccountOverviewPanel`) fa 6 call `reached_audience_demographics` + `engaged_audience_demographics` con `breakdown=age|gender|country` e `timeframe=last_14/30/90_days` (selettore periodo). Degrada silenziosamente a "empty" se il token non ha lo scope o non c'è abbastanza reach. i18n `an.aud.*`.

**Lista post**: `AllPostsList` mostra **tutti** i post con ordinamento (data ↓ default, data ↑, engagement, reach, interazioni) e le metriche estese per post. La Top 5 per engagement resta separata.

**Analisi visiva**: `analyze()` allega come immagini (via `images` in `api/chat.js`) le foto (`thumbnail_url`/`media_url`) dei post con più engagement, così Claude analizza davvero stile visivo/storytelling, non solo i numeri. `postsSummary` include ora anche `condivisioni`, `interazioni_tot`, `visite_profilo`, `nuovi_follow`; il system prompt riceve `accountCtx` (follower, reach 28gg, top paesi/età). L'output è JSON strutturato con `patterns`, `timing`, `content_pillars`, `visual_storytelling`, `corrections`, `next_posts[]` (ognuna con `hook_type`, `hook`, `visual_scout_brief` pronto per l'handoff). Vedi `AnalysisPanel` in `InstagramAnalytics.jsx` per il renderer.

---

## 7. Regole di Sviluppo

- **Mai aggiungere dipendenze** senza motivo concreto. Mantenere l'app super leggera.
- **JSON strictness**: i prompt AI (Visual Scout e Analytics) chiedono output esclusivamente JSON. Non modificare le strutture senza testare il parsing lato frontend. Campi guidati dai framework: `strategy.framework` (architettura carosello scelta), `post_composer[].hook_type`, e in Analytics `next_posts[].hook_type` + `next_posts[].hook` (prima riga pronta). Sono additivi e resi come badge/citazioni in `StrategyTab`/`PostsTab`/`NextPostCard` — se rimossi la UI degrada senza rompersi.
- **Design System**: tema scuro (`#0D0D0D`/`#080808` sfondo, `#F0EBE3` testo chiaro), accenti gold `#C9A96E`/`#8B7355`. Font: **`Space Grotesk`** per tutta la UI e i titoli (geometrico/futuristico), **`JetBrains Mono`** per tech/etichette/ID. Caricati in `index.html`; base globale (tipografia, scrollbar, `::selection`, focus glow, sfondo a gradiente radiale, hover `brightness`) in `src/theme.css` (importato in `main.jsx`). Look "tondeggiante": raggi ampi (card ~16-20, bottoni ~12-14, pill ~20+) — token `--r-*` in `theme.css`. Navbar in glassmorphism (`backdrop-filter: blur`). Non reintrodurre `DM Sans`/`Montserrat`/`Instrument Serif`.
- **Foto**: usare sempre sia Pexels che Pixabay per diversità. Per i caroselli ogni slide deve avere una `search_query` diversa.
- **Query di ricerca immagini**: preferire soggetti/location ampiamente taggati nelle stock library invece di nomi di luogo di nicchia (spesso restituiscono 0 risultati). `fetchImages`/`fetchVideos` in `App.jsx` fanno comunque un retry automatico allargando la query (tolgono l'ultima parola progressivamente) se la ricerca esatta non trova nulla — vedi `broadenAttempts()`. Ogni `search_query` generata dal system prompt deve essere **globalmente unica** in tutta la risposta (non solo all'interno della singola sezione).
- **Carosello Canva = un solo design**: `api/canva-carousel.js` fa UN autofill sul Brand Template carosello a 6 pagine (`canvaTemplates.carousel`, campi `Immagine_1..6`/`Testo_1..6` aggiunti a mano il 2026-09-09) e taglia le pagine in eccesso. Vedi §7.
- **Crea design da suggerimento (Visual Scout)**: ogni slide del Post Composer ha il pulsante "✦ Crea design" → `CanvaQuickDesignModal` (portale, dark). Precompilata con caption/query/cta; l'utente sceglie formato e UNA foto suggerita, "🔀 Auto", **oppure incolla un URL immagine** (Pinterest `i.pinimg.com/...`, sito, ecc. — Canva lo scarica server-side via `url-asset-uploads`). Invia a `/api/canva-create` con `imageUrl`; al successo salva in `canva_designs`. Stessa opzione URL per riga in `RowImagePicker` del carosello.
- **Composer carosello (Visual Scout)**: `CarouselComposer` (era `CanvaCarouselBtn`) — modale con le slide di partenza editabili + aggiungi/rimuovi/riordina pagine, foto per pagina (`RowImagePicker`), e "+ Da design creato" che aggiunge una pagina riusando `thumb_url`+`title` di un design in `canva_designs`. Max 10 pagine → `/api/canva-carousel` → salva in `canva_designs` (`kind: "carousel"`).
- **Canva Studio = libreria**: non c'è più "Crea design rapido"; al suo posto `CreatedDesignsPanel` (galleria dei `canva_designs` del progetto, con apri/elimina). La creazione vive in Visual Scout.
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
| `FB_APP_ID` | Server — app Meta, per OAuth analisi sponsorizzate |
| `FB_APP_SECRET` | Server |
| `FB_REDIRECT_URI` | Server (opz., default `https://vmscout.vercel.app/api/instagram`) |
| `VITE_PEXELS_KEY` | Client (build) |
| `VITE_PIXABAY_KEY` | Client (build) |

### Analisi sponsorizzate — collegamento Facebook (Meta Marketing API)
`api/instagram.js` gestisce, oltre al proxy Graph generico:
- `GET ?action=fb_login` → OAuth dialog Facebook (scope `ads_read`), `state` in cookie.
- callback (rilevato da `?code`) → scambio code→token breve→token long-lived (~60gg), salvato in tabella `fb_auth` (id=1, single-user). `api/db.js` → `ensureFbAuthTable`.
- `GET ?action=fb_status` / `fb_logout`.
- `POST { fb_action: "adaccounts" }` → `me/adaccounts`.
- `POST { fb_action: "ads", ad_account_id, date_preset }` → `act_<id>/ads` con `adset{targeting}`, `creative{...}`, `insights{...}`.
Frontend: `<AdsPanel>` in `src/InstagramAnalytics.jsx` — connetti FB, scegli account pubblicitario, carica sponsorizzate 90gg, `summarizeTargeting()` estrae età/genere/geo/interessi, "Analizza con Claude" → JSON con audience migliori / da tagliare / target consigliato.
Setup app Meta: aggiungere il prodotto **Facebook Login**, redirect URI `https://vmscout.vercel.app/api/instagram`, permesso `ads_read` (Standard Access basta per admin/dev/tester dell'app — nessuna App Review per uso proprio). L'account IG dev'essere collegato a una Pagina FB in un Business Manager che possiede l'account pubblicitario.

### `vercel.json`
- Rewrite catch-all verso `index.html` per SPA routing
- `api/canva-upload.js`, `api/canva-create.js`, `api/canva-carousel.js`, `api/chat.js`: `maxDuration: 60` (upload/polling job e analisi visiva possono richiedere più dei 10s di default)
- `api/canva-test.js`: `maxDuration: 30`

---

## 9. Skill di marketing (dev tooling)

`.claude/skills/` contiene le ~50 skill di [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT), versionate nel repo ma **fuori dal bundle** (Vercel builda solo `dist/` + `api/`). Servono a Claude Code durante lo sviluppo di feature marketing; il loro know-how rilevante è distillato in `src/marketingFrameworks.js` per l'uso runtime dell'app. Per aggiornarle: ri-clonare l'upstream, ricopiare `skills/`, rimuovere le cartelle `evals/`, ri-verificare il distillato.
