// /api/db.js — Turso LibSQL client (server-side only)
import { createClient } from "@libsql/client";

let _client = null;

export function getDb() {
  if (_client) return _client;
  const url = process.env.TURSO_DB_URL;
  const authToken = process.env.TURSO_DB_TOKEN;
  if (!url || !authToken) throw new Error("TURSO_DB_URL or TURSO_DB_TOKEN not configured");
  _client = createClient({ url, authToken });
  return _client;
}

// Crea la tabella token OAuth Canva se non esiste — idempotente, così nessun
// endpoint dipende da una chiamata di init manuale separata.
export async function ensureCanvaAuthTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS canva_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_in INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// Token utente Facebook (long-lived, ~60gg) per la Marketing API — analisi
// delle sponsorizzate. Un'unica riga (id=1): VMScout è single-user.
export async function ensureFbAuthTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fb_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      expires_in INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}
