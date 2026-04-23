// /api/luxy-db.js — CRUD endpoints per Luxy Experience
// Gestisce: init tabelle, salvataggio richieste, memoria brand, statistiche

import { getDb } from "./db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const db = getDb();
  const { action } = req.query;

  try {
    // ─── INIT: crea tabelle se non esistono ───────────────────
    if (action === "init") {
      await db.batch([
        // Storico richieste marketing
        `CREATE TABLE IF NOT EXISTS luxy_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT (datetime('now')),
          type TEXT NOT NULL,          -- 'content','strategy','post','campaign'
          prompt TEXT NOT NULL,
          result_json TEXT,
          language TEXT DEFAULT 'it',
          tags TEXT,                   -- JSON array es: ["ibiza","yacht","villa"]
          status TEXT DEFAULT 'done'
        )`,
        // Memoria brand (info persistenti su Luxy)
        `CREATE TABLE IF NOT EXISTS luxy_brand_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          updated_at TEXT DEFAULT (datetime('now')),
          key TEXT UNIQUE NOT NULL,    -- es: 'tone_of_voice', 'services', 'target'
          value TEXT NOT NULL,
          category TEXT DEFAULT 'brand' -- 'brand','audience','style','services'
        )`,
        // Post generati e approvati
        `CREATE TABLE IF NOT EXISTS luxy_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT (datetime('now')),
          platform TEXT NOT NULL,      -- 'instagram','facebook','linkedin','tiktok'
          language TEXT DEFAULT 'it',
          caption TEXT NOT NULL,
          hashtags TEXT,               -- JSON array
          cta TEXT,
          visual_description TEXT,
          search_query TEXT,
          status TEXT DEFAULT 'draft', -- 'draft','approved','published'
          campaign_tag TEXT,
          request_id INTEGER REFERENCES luxy_requests(id)
        )`,
        // Campagne
        `CREATE TABLE IF NOT EXISTS luxy_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT (datetime('now')),
          name TEXT NOT NULL,
          goal TEXT,
          target_audience TEXT,
          start_date TEXT,
          end_date TEXT,
          status TEXT DEFAULT 'active',
          notes TEXT
        )`
      ], "write");

      // Seed memoria brand di default se vuota
      const existing = await db.execute("SELECT COUNT(*) as n FROM luxy_brand_memory");
      if (existing.rows[0].n === 0) {
        await db.batch([
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('brand_name', 'Luxy Experience', 'brand')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('tagline', 'Il tuo concierge ovunque nel mondo. A casa a Ibiza.', 'brand')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('tone_of_voice', 'Elegante, diretto, esclusivo. Mai arrogante. Fa sentire il cliente speciale.', 'brand')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('services', '["Ville e hotel di lusso","Yacht e barche private","Noleggio auto e scooter premium","Nightlife, tavoli ed eventi","Assistenza h24 personalizzata"]', 'services')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('target_audience', 'Clienti HNWI e affluent (30-55 anni), coppie e gruppi di amici, viaggiatori abituali del lusso, clienti corporate. Mercati: IT, UK, DE, ES, CH.', 'audience')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('visual_style', 'Minimal luxury. Foto reali e autentiche, mai plastic stock. Palette: nero, oro, bianco avorio. Film grain, golden hour, candid moments.', 'style')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('core_locations', 'Ibiza (home base), Formentera, Maiorca, Costa del Sol, Sardegna, Côte d Azur, Dubai, Maldive', 'brand')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES 
            ('usp', 'Esperienza 100% personalizzata. Assistenza h24. Zero stress. Il cliente non deve pensare a nulla. Accesso a esperienze normalmente inaccessibili.', 'brand')`
        ], "write");
      }

      return res.status(200).json({ ok: true, message: "Tabelle create e memoria brand inizializzata" });
    }

    // ─── SAVE REQUEST ────────────────────────────────────────
    if (action === "save_request" && req.method === "POST") {
      const { type, prompt, result_json, language, tags } = req.body;
      const result = await db.execute({
        sql: "INSERT INTO luxy_requests (type, prompt, result_json, language, tags) VALUES (?,?,?,?,?)",
        args: [type || "content", prompt, JSON.stringify(result_json) || null, language || "it", JSON.stringify(tags) || null]
      });
      return res.status(200).json({ ok: true, id: Number(result.lastInsertRowid) });
    }

    // ─── GET REQUESTS HISTORY ────────────────────────────────
    if (action === "history" && req.method === "GET") {
      const limit = req.query.limit || 20;
      const type = req.query.type;
      let sql = "SELECT id, created_at, type, prompt, language, tags, status FROM luxy_requests";
      const args = [];
      if (type) { sql += " WHERE type = ?"; args.push(type); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(Number(limit));
      const rows = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    // ─── GET/SET BRAND MEMORY ────────────────────────────────
    if (action === "memory") {
      if (req.method === "GET") {
        const category = req.query.category;
        let sql = "SELECT key, value, category, updated_at FROM luxy_brand_memory";
        const args = [];
        if (category) { sql += " WHERE category = ?"; args.push(category); }
        sql += " ORDER BY category, key";
        const rows = await db.execute({ sql, args });
        return res.status(200).json({ ok: true, data: rows.rows });
      }
      if (req.method === "PUT") {
        const { key, value, category } = req.body;
        await db.execute({
          sql: "INSERT INTO luxy_brand_memory (key, value, category, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
          args: [key, value, category || "brand"]
        });
        return res.status(200).json({ ok: true });
      }
    }

    // ─── SAVE POST ────────────────────────────────────────────
    if (action === "save_post" && req.method === "POST") {
      const { platform, language, caption, hashtags, cta, visual_description, search_query, campaign_tag, request_id } = req.body;
      const result = await db.execute({
        sql: "INSERT INTO luxy_posts (platform, language, caption, hashtags, cta, visual_description, search_query, campaign_tag, request_id) VALUES (?,?,?,?,?,?,?,?,?)",
        args: [platform, language || "it", caption, JSON.stringify(hashtags), cta, visual_description, search_query, campaign_tag, request_id || null]
      });
      return res.status(200).json({ ok: true, id: Number(result.lastInsertRowid) });
    }

    // ─── GET POSTS ────────────────────────────────────────────
    if (action === "posts" && req.method === "GET") {
      const { platform, status, limit } = req.query;
      let sql = "SELECT * FROM luxy_posts";
      const args = [];
      const where = [];
      if (platform) { where.push("platform = ?"); args.push(platform); }
      if (status) { where.push("status = ?"); args.push(status); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(Number(limit) || 50);
      const rows = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    // ─── UPDATE POST STATUS ───────────────────────────────────
    if (action === "update_post" && req.method === "PUT") {
      const { id, status } = req.body;
      await db.execute({ sql: "UPDATE luxy_posts SET status=? WHERE id=?", args: [status, id] });
      return res.status(200).json({ ok: true });
    }

    // ─── STATS ───────────────────────────────────────────────
    if (action === "stats") {
      const [req_count, post_count, approved] = await Promise.all([
        db.execute("SELECT COUNT(*) as n, MAX(created_at) as last FROM luxy_requests"),
        db.execute("SELECT COUNT(*) as n FROM luxy_posts"),
        db.execute("SELECT COUNT(*) as n FROM luxy_posts WHERE status='approved'"),
      ]);
      return res.status(200).json({
        ok: true,
        stats: {
          total_requests: Number(req_count.rows[0].n),
          last_request: req_count.rows[0].last,
          total_posts: Number(post_count.rows[0].n),
          approved_posts: Number(approved.rows[0].n),
        }
      });
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("[luxy-db]", err);
    return res.status(500).json({ error: err.message });
  }
}
