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
