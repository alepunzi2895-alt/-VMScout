import { createClient } from "@libsql/client";

const DB_URL = process.env.TURSO_DB_URL || "libsql://vmscout-therealmfkk.aws-eu-west-1.turso.io";
const DB_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DB_TOKEN;

if (!DB_TOKEN) {
  console.error("❌ Errore: TURSO_AUTH_TOKEN non presente nell'ambiente.");
  process.exit(1);
}

const client = createClient({
  url: DB_URL,
  authToken: DB_TOKEN,
});

// Nota: gli endpoint API (api/history.js, api/canva-*.js) creano già queste
// tabelle in modo lazy (CREATE TABLE IF NOT EXISTS) al primo utilizzo — questo
// script serve solo per un bootstrap manuale/anticipato del DB.
async function run() {
  console.log("Inizializzazione Database su:", DB_URL);

  try {
    console.log("Creazione tabella 'projects'...");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sector TEXT,
        description TEXT,
        tone TEXT,
        instagram_handle TEXT,
        hashtags TEXT,
        canva_templates TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    console.log("Creazione tabella 'requests' (storico domande/risposte AI)...");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    console.log("Creazione tabella 'canva_auth' (token OAuth Canva)...");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS canva_auth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_in INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    console.log("✅ Database inizializzato con successo!");
  } catch (error) {
    console.error("❌ Errore durante l'inizializzazione del DB:", error);
  }
}

run();
