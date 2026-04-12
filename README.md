# ◈ Visual Marketing Scout

AI-powered visual marketing strategy tool. Anti-stock, anti-AI. Solo autenticità.

## Deploy su Vercel — Guida Rapida

### 1. Push su GitHub

```bash
cd vms-vercel
git init
git add .
git commit -m "Visual Marketing Scout v3"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/visual-marketing-scout.git
git push -u origin main
```

### 2. Importa su Vercel

1. Vai su [vercel.com/new](https://vercel.com/new)
2. Clicca **"Import Git Repository"**
3. Seleziona il repo `visual-marketing-scout`
4. Framework Preset: **Vite** (dovrebbe autodetectarlo)
5. Clicca **Deploy**

### 3. Configura Environment Variables

Vai su **Vercel Dashboard → Il tuo progetto → Settings → Environment Variables**

Aggiungi queste variabili:

| Nome | Valore | Obbligatoria |
|------|--------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | ✅ Sì |
| `VITE_UNSPLASH_KEY` | Access Key da unsplash.com/developers | Opzionale |
| `VITE_PEXELS_KEY` | API Key da pexels.com/api | Opzionale |
| `VITE_PIXABAY_KEY` | API Key da pixabay.com/api/docs | Opzionale |

> ⚠️ **ANTHROPIC_API_KEY** è l'unica obbligatoria. Senza, il motore AI non funziona.
> Le altre 3 sono opzionali — abilitano le anteprime foto inline.

Dopo aver aggiunto le variabili, fai **Redeploy** dal tab Deployments.

### 4. Ottieni le API Keys

| Servizio | Link | Cosa serve |
|----------|------|-----------|
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com/) | API Key (`sk-ant-...`) |
| Unsplash | [unsplash.com/developers](https://unsplash.com/developers) | Access Key |
| Pexels | [pexels.com/api/new](https://www.pexels.com/api/new/) | API Key |
| Pixabay | [pixabay.com/api/docs](https://pixabay.com/api/docs/) | API Key |

---

## Architettura

```
vms-vercel/
├── api/
│   └── chat.js          ← Serverless function (proxy Anthropic)
├── src/
│   ├── main.jsx         ← Entry point React
│   └── App.jsx          ← App completa (strategia + post + video)
├── index.html
├── vite.config.js
├── vercel.json          ← Routing config
├── package.json
└── .env.example         ← Template variabili
```

**Flusso:**
1. Utente scrive brief marketing
2. Frontend chiama `/api/chat` (serverless function)
3. Serverless function chiama Anthropic con la key sicura server-side
4. Risposta JSON parsata e renderizzata in 4 tab: Strategia / Piano / Post / Video
5. Restyling "Aesthetic Beige" (#EFE6D5) applicato a tutto il layout.
6. Nuovo modulo "Piano Editoriale": distribuzione contenuti settimanale (7 giorni) con suggerimenti cross-posting per Facebook.

## Development Locale

```bash
cp .env.example .env.local
# Edita .env.local con le tue keys

npm install
npm run dev
```

> Per il dev locale, il proxy `/api/chat` non funziona con `vite dev`.
> Opzione A: usa [vercel dev](https://vercel.com/docs/cli/dev) (`npx vercel dev`)
> Opzione B: durante lo sviluppo, punta temporaneamente all'API Anthropic diretta
