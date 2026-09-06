// /api/history.js — CRUD per progetti e storico richieste AI (VMScout)
// Persiste ciò che prima viveva solo in localStorage: progetti (brand) e ogni
// domanda/risposta generata dall'AI (strategia, analytics, ecc.), per progetto.

import { getDb } from "./db.js";

async function ensureTables(db) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS projects (
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
    )`,
    `CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ], "write");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const db = getDb();
  const { action } = req.query;

  try {
    await ensureTables(db);

    // ─── PROJECTS ──────────────────────────────────────────────
    if (action === "projects" && req.method === "GET") {
      const rows = await db.execute("SELECT * FROM projects ORDER BY updated_at DESC");
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (action === "save_project" && req.method === "POST") {
      const { id, name, sector, description, tone, instagramHandle, hashtags, canvaTemplates } = req.body;
      if (!id || !name) return res.status(400).json({ error: "Mancano id o name" });
      await db.execute({
        sql: `INSERT INTO projects (id, name, sector, description, tone, instagram_handle, hashtags, canva_templates, updated_at)
              VALUES (?,?,?,?,?,?,?,?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, sector=excluded.sector, description=excluded.description,
                tone=excluded.tone, instagram_handle=excluded.instagram_handle,
                hashtags=excluded.hashtags, canva_templates=excluded.canva_templates,
                updated_at=excluded.updated_at`,
        args: [id, name, sector || "", description || "", tone || "", instagramHandle || "", hashtags || "", JSON.stringify(canvaTemplates || {})],
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "delete_project" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      await db.execute({ sql: "DELETE FROM projects WHERE id=?", args: [id] });
      await db.execute({ sql: "DELETE FROM requests WHERE project_id=?", args: [id] });
      return res.status(200).json({ ok: true });
    }

    // ─── REQUESTS (storico domande/risposte AI) ────────────────
    if (action === "save_request" && req.method === "POST") {
      const { project_id, type, prompt, result_json } = req.body;
      if (!type || !prompt) return res.status(400).json({ error: "Mancano type o prompt" });
      const result = await db.execute({
        sql: "INSERT INTO requests (project_id, type, prompt, result_json) VALUES (?,?,?,?)",
        args: [project_id || null, type, prompt, JSON.stringify(result_json ?? null)],
      });
      return res.status(200).json({ ok: true, id: Number(result.lastInsertRowid) });
    }

    if (action === "history" && req.method === "GET") {
      const { project_id, type, limit } = req.query;
      let sql = "SELECT * FROM requests";
      const where = [];
      const args = [];
      if (project_id) { where.push("project_id = ?"); args.push(project_id); }
      if (type) { where.push("type = ?"); args.push(type); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(Number(limit) || 50);
      const rows = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (action === "delete_request" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      await db.execute({ sql: "DELETE FROM requests WHERE id=?", args: [id] });
      return res.status(200).json({ ok: true });
    }

    if (action === "stats" && req.method === "GET") {
      const [projCount, reqCount] = await Promise.all([
        db.execute("SELECT COUNT(*) as n FROM projects"),
        db.execute("SELECT COUNT(*) as n, MAX(created_at) as last FROM requests"),
      ]);
      return res.status(200).json({
        ok: true,
        stats: {
          total_projects: Number(projCount.rows[0].n),
          total_requests: Number(reqCount.rows[0].n),
          last_request: reqCount.rows[0].last,
        },
      });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("[history]", err);
    return res.status(500).json({ error: err.message });
  }
}
