// /api/db.js — Turso LibSQL client + auth/session/crypto helpers (server-side only)
//
// Gli helper di autenticazione vivono QUI e non in un file dedicato: ogni file
// in api/ conta come Serverless Function di Vercel e siamo a 12/12. db.js è già
// importato da history.js, canva-lib.js, instagram.js e da tutti i canva-*.
import { createClient } from "@libsql/client";
import crypto from "crypto";

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
// (Legacy: tabella a riga unica id=1. Dalla v2 i token sono per-utente in
// canva_auth_u — vedi ensureAuthTables. Questa resta per la migrazione.)
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

// Token utente Facebook (long-lived, ~60gg) per la Marketing API.
// (Legacy riga unica id=1 → migrato a fb_auth_u per-utente.)
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

// ═══════════════════════════════════════════════════════════════════
// AUTH — utenti (nickname + password), sessioni, token OAuth per-utente
// ═══════════════════════════════════════════════════════════════════

export const LANGS = ["it", "en", "es", "fr", "de"];
export const normLang = (l) => (LANGS.includes(String(l)) ? String(l) : "it");

// ─── Schema ────────────────────────────────────────────────────────
export async function ensureAuthTables(db) {
  if (ensureAuthTables._ready) return;
  // le tabelle legacy a riga unica devono esistere: l'adozione del primo utente
  // fa `INSERT ... SELECT FROM canva_auth/fb_auth`.
  await ensureCanvaAuthTable(db).catch(() => {});
  await ensureFbAuthTable(db).catch(() => {});
  await db.batch([
    `CREATE TABLE IF NOT EXISTS vms_users (
      id             TEXT PRIMARY KEY,
      nickname       TEXT NOT NULL,
      nickname_lower TEXT NOT NULL UNIQUE,
      pass_hash      TEXT NOT NULL,
      lang           TEXT NOT NULL DEFAULT 'it',
      created_at     TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS vms_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      user_agent TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS canva_auth_u (
      user_id       TEXT PRIMARY KEY,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_in    INTEGER NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS fb_auth_u (
      user_id      TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      expires_in   INTEGER,
      created_at   TEXT DEFAULT (datetime('now'))
    )`,
    // Credenziali OAuth delle app di terze parti dell'utente (Canva, Meta),
    // impostabili dall'app in Impostazioni. Vuoto = usa il fallback da env.
    `CREATE TABLE IF NOT EXISTS app_config_u (
      user_id             TEXT PRIMARY KEY,
      canva_client_id     TEXT DEFAULT '',
      canva_client_secret TEXT DEFAULT '',
      fb_app_id           TEXT DEFAULT '',
      fb_app_secret       TEXT DEFAULT '',
      updated_at          TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON vms_sessions(user_id)`,
  ], "write");
  ensureAuthTables._ready = true;
}

// Credenziali OAuth di Canva e Meta per un utente. Ordine: valore impostato
// dall'utente in Impostazioni → variabile d'ambiente (fallback legacy/condiviso).
// `source.canva` / `source.fb`: "user" | "env" | "none".
const ENV_APP_CONFIG = () => ({
  canvaClientId:     process.env.CANVA_CLIENT_ID     || process.env.VITE_CANVA_CLIENT_ID     || "",
  canvaClientSecret: process.env.CANVA_CLIENT_SECRET || process.env.VITE_CANVA_CLIENT_SECRET || "",
  fbAppId:           process.env.FB_APP_ID           || process.env.VITE_FB_APP_ID           || "",
  fbAppSecret:       process.env.FB_APP_SECRET       || process.env.VITE_FB_APP_SECRET       || "",
});

export async function getAppConfig(db, userId) {
  await ensureAuthTables(db);
  const env = ENV_APP_CONFIG();
  let row = {};
  if (userId) {
    try {
      const r = await db.execute({
        sql: "SELECT canva_client_id, canva_client_secret, fb_app_id, fb_app_secret FROM app_config_u WHERE user_id=?",
        args: [userId],
      });
      row = r.rows[0] || {};
    } catch { /* tabella non ancora creata: usa env */ }
  }
  return {
    canvaClientId:     row.canva_client_id     || env.canvaClientId,
    canvaClientSecret: row.canva_client_secret || env.canvaClientSecret,
    fbAppId:           row.fb_app_id           || env.fbAppId,
    fbAppSecret:       row.fb_app_secret       || env.fbAppSecret,
    source: {
      canva: row.canva_client_id ? "user" : (env.canvaClientId ? "env" : "none"),
      fb:    row.fb_app_id       ? "user" : (env.fbAppId       ? "env" : "none"),
    },
  };
}

// ─── Password: scrypt (node crypto, nessuna dipendenza npm) ─────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

// Hash fittizio calcolato al load del modulo: verificarlo sui login "nickname
// inesistente" pareggia i tempi di risposta (niente user-enumeration via timing).
export const DUMMY_HASH = hashPassword("dummy-password-for-timing");

export function verifyPassword(pw, stored) {
  try {
    const [tag, N, r, p, saltHex, hashHex] = String(stored).split("$");
    if (tag !== "scrypt") return false;
    const expected = Buffer.from(hashHex, "hex");
    const dk = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch { return false; }
}

// ─── Cookie parse/serialize (nessuna dipendenza `cookie`) ───────────
export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function serializeCookie(name, val, o = {}) {
  const p = [`${name}=${encodeURIComponent(val)}`];
  if (o.maxAge != null) p.push(`Max-Age=${Math.floor(o.maxAge)}`);
  p.push(`Path=${o.path || "/"}`);
  if (o.httpOnly) p.push("HttpOnly");
  if (o.secure) p.push("Secure");
  if (o.sameSite) p.push(`SameSite=${o.sameSite}`);
  return p.join("; ");
}

// ─── Sessioni ──────────────────────────────────────────────────────
export const SESSION_COOKIE = "vms_sess";
export const SESSION_TTL_S = 400 * 24 * 60 * 60;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function createSession(db, userId, req) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.execute({
    sql: `INSERT INTO vms_sessions (token_hash, user_id, expires_at, user_agent)
          VALUES (?, ?, datetime('now','+400 days'), ?)`,
    args: [sha256(raw), userId, String(req.headers["user-agent"] || "").slice(0, 200)],
  });
  // pulizia opportunistica delle sessioni scadute di questo utente
  db.execute({ sql: `DELETE FROM vms_sessions WHERE user_id=? AND expires_at < datetime('now')`, args: [userId] }).catch(() => {});
  return raw;
}
export const sessionSetCookie = (raw) =>
  serializeCookie(SESSION_COOKIE, raw, { httpOnly: true, secure: true, sameSite: "Lax", maxAge: SESSION_TTL_S, path: "/" });
export const sessionClearCookie = () =>
  serializeCookie(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "Lax", maxAge: 0, path: "/" });

export async function destroySession(db, req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (raw) await db.execute({ sql: "DELETE FROM vms_sessions WHERE token_hash=?", args: [sha256(raw)] });
}

// `{ id, nickname, lang }` | null
export async function getSessionUser(db, req) {
  await ensureAuthTables(db);
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const h = sha256(raw);
  const r = await db.execute({
    sql: `SELECT u.id, u.nickname, u.lang, s.expires_at
          FROM vms_sessions s JOIN vms_users u ON u.id = s.user_id
          WHERE s.token_hash = ?`,
    args: [h],
  });
  if (!r.rows.length) return null;
  if (new Date(r.rows[0].expires_at.replace(" ", "T") + "Z").getTime() < Date.now()) {
    db.execute({ sql: "DELETE FROM vms_sessions WHERE token_hash=?", args: [h] }).catch(() => {});
    return null;
  }
  return { id: r.rows[0].id, nickname: r.rows[0].nickname, lang: normLang(r.rows[0].lang) };
}

// ─── Proprietà progetto ────────────────────────────────────────────
export async function assertOwnsProject(db, userId, projectId, { allowMissing = false } = {}) {
  if (!projectId) return;
  const r = await db.execute({ sql: "SELECT user_id FROM projects WHERE id=?", args: [projectId] });
  if (!r.rows.length) {
    if (allowMissing) return;
    const e = new Error("PROJECT_NOT_FOUND"); e.status = 404; throw e;
  }
  if (r.rows[0].user_id !== userId) { const e = new Error("FORBIDDEN"); e.status = 403; throw e; }
}

// ─── State OAuth firmato (HMAC) — porta l'user id attraverso il redirect ──
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.createHash("sha256").update(process.env.TURSO_DB_TOKEN || "vmscout-fallback").digest("hex");

export function signValue(v) {
  const mac = crypto.createHmac("sha256", AUTH_SECRET).update(String(v)).digest("base64url").slice(0, 24);
  return `${Buffer.from(String(v)).toString("base64url")}.${mac}`;
}
export function verifySignedValue(tok) {
  try {
    const [b, mac] = String(tok).split(".");
    const v = Buffer.from(b, "base64url").toString();
    const want = crypto.createHmac("sha256", AUTH_SECRET).update(v).digest("base64url").slice(0, 24);
    if (mac.length !== want.length) return null;
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want)) ? v : null;
  } catch { return null; }
}

// Origin atteso per le mutazioni auth (difesa CSRF leggera, oltre a SameSite=Lax)
export function badOrigin(req) {
  const o = req.headers.origin;
  if (!o) return false; // curl / same-origin senza header Origin
  try {
    const host = new URL(o).host;
    return host !== req.headers.host;
  } catch { return true; }
}
