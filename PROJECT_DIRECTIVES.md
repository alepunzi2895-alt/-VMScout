# VMScout - Project Directives

Queste direttive devono essere lette prima di ogni operazione sul progetto e aggiornate ogni volta che l'architettura o le regole del progetto cambiano.

## 1. Obiettivo e Visione
**VMScout** (Visual Marketing Scout) è un'applicazione "Anti-stock, anti-AI. Solo autenticità". Aiuta i marketer a generare strategie visive, storyboard video, piani editoriali (soprattutto per Social IG/FB) e suggerimenti per post cross-platform. Estetica "Aesthetic Beige" (#EFE6D5).

## 2. Architettura Tecnica
- **Frontend**: Vite + React + Vanilla CSS (No Tailwind).
- **Backend/API**: Vercel Serverless Functions (`api/chat.js` proxy per Anthropic).
- **Database**: Turso (libsql sqlite). Usato per memorizzare utenti e log delle strategie.
- **Provider Foto/Video**: Unsplash, Pexels, Pixabay, interagiscono dal client tramite chiavi API (`VITE_*_KEY`).

## 3. Database Struttura (Turso)
- **`users`**:
  - `id` (TEXT PRIMARY)
  - `email` (TEXT UNIQUE)
  - `created_at` (DATETIME)
- **`strategies`**:
  - `id` (TEXT PRIMARY)
  - `user_id` (TEXT)
  - `brief` (TEXT)
  - `data` (TEXT JSON)
  - `created_at` (DATETIME)

*Vedi `scripts/init_db.js` per lo schema di creazione vero e proprio.*

## 4. Regole di Sviluppo
- **Mai aggiungere dipendenze** senza motivo concreto. Mantenere l'app super leggera.
- **Anthropic API**: `api/chat.js` mantiene segreta `ANTHROPIC_API_KEY`.
- **JSON strictness**: Il prompt in `App.jsx` chiede all'AI (Claude) di rispondere *esclusivamente* in JSON, pena la rottura del frontend. Evitare modifiche repentine a quel prompt senza testarlo profondamente.
- **Design System**: Colori caldi, `JetBrains Mono` per elementi tech/etichette, `Instrument Serif` per tipografia elegante, `DM Sans` per bottoni e testi standard.

## 5. Deployment
Push sulla branch `main` edita in automatico i server Vercel. Ricordarsi di aggiungere le variabili d'ambiente `TURSO_DB_URL`, `TURSO_AUTH_TOKEN` (o `TURSO_DB_TOKEN`) sulla console di Vercel.
