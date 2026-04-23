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

async function run() {
  console.log("Inizializzazione Database su:", DB_URL);

  try {
    // Tabella users
    console.log("Creazione tabella 'users'...");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabella strategies
    console.log("Creazione tabella 'strategies'...");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        brief TEXT,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    console.log("✅ Database inizializzato con successo!");
  } catch (error) {
    console.error("❌ Errore durante l'inizializzazione del DB:", error);
  }
}

run();
