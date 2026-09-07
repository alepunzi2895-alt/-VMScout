// /api/history.js — CRUD per progetti, storico richieste AI e insight accumulati (VMScout)
// Persiste ciò che prima viveva solo in localStorage: progetti (brand), ogni
// domanda/risposta generata dall'AI (strategia, analytics, ecc.) per progetto,
// e la "memoria" di progetto (punti di forza/debolezza, consigli, calendario
// post) che si arricchisce a ogni analisi Instagram — la base del loop di
// auto-apprendimento: ogni nuova strategia/analisi la legge prima di generare.

import { getDb } from "./db.js";
import crypto from "crypto";

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
    `CREATE TABLE IF NOT EXISTS project_insights (
      project_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS canva_designs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      kind TEXT,
      format TEXT,
      title TEXT,
      design_url TEXT NOT NULL,
      thumb_url TEXT,
      slides INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ], "write");

  // Colonne aggiunte dopo la creazione iniziale della tabella: ALTER lazy,
  // idempotente (SQLite lancia "duplicate column name" se già presente).
  for (const col of ["logo TEXT"]) {
    try { await db.execute(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* già presente */ }
  }
}

const EMPTY_INSIGHTS = { tips: [], strengths: [], weaknesses: [], calendar: [] };

function dedupAppend(arr, additions, cap) {
  const out = [...(arr || [])];
  const seen = new Set(out.map(v => v.toLowerCase()));
  (additions || []).forEach(a => {
    const v = (a || "").trim();
    if (v && !seen.has(v.toLowerCase())) { out.push(v); seen.add(v.toLowerCase()); }
  });
  return out.slice(-cap);
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
      const { id, name, sector, description, tone, instagramHandle, hashtags, logo, canvaTemplates } = req.body;
      if (!id || !name) return res.status(400).json({ error: "Mancano id o name" });
      await db.execute({
        sql: `INSERT INTO projects (id, name, sector, description, tone, instagram_handle, hashtags, logo, canva_templates, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, sector=excluded.sector, description=excluded.description,
                tone=excluded.tone, instagram_handle=excluded.instagram_handle,
                hashtags=excluded.hashtags, logo=excluded.logo, canva_templates=excluded.canva_templates,
                updated_at=excluded.updated_at`,
        args: [id, name, sector || "", description || "", tone || "", instagramHandle || "", hashtags || "", logo || "", JSON.stringify(canvaTemplates || {})],
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "delete_project" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      await db.execute({ sql: "DELETE FROM projects WHERE id=?", args: [id] });
      await db.execute({ sql: "DELETE FROM requests WHERE project_id=?", args: [id] });
      await db.execute({ sql: "DELETE FROM canva_designs WHERE project_id=?", args: [id] });
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

    // ─── CANVA DESIGNS (design creati dall'app, per progetto) ──────
    if (action === "save_design" && req.method === "POST") {
      const { project_id, kind, format, title, design_url, thumb_url, slides } = req.body;
      if (!design_url) return res.status(400).json({ error: "Manca design_url" });
      const result = await db.execute({
        sql: "INSERT INTO canva_designs (project_id, kind, format, title, design_url, thumb_url, slides) VALUES (?,?,?,?,?,?,?)",
        args: [project_id || null, kind || "design", format || null, title || null, design_url, thumb_url || null, slides != null ? Number(slides) : null],
      });
      return res.status(200).json({ ok: true, id: Number(result.lastInsertRowid) });
    }

    if (action === "designs" && req.method === "GET") {
      const { project_id, limit } = req.query;
      let sql = "SELECT * FROM canva_designs";
      const args = [];
      if (project_id) { sql += " WHERE project_id = ?"; args.push(project_id); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(Number(limit) || 60);
      const rows = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (action === "delete_design" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      await db.execute({ sql: "DELETE FROM canva_designs WHERE id=?", args: [id] });
      return res.status(200).json({ ok: true });
    }

    // ─── PROJECT INSIGHTS (memoria di progetto per il loop di auto-apprendimento) ─
    if (action === "get_insights" && req.method === "GET") {
      const { project_id } = req.query;
      if (!project_id) return res.status(400).json({ error: "Manca project_id" });
      const rows = await db.execute({ sql: "SELECT data, updated_at FROM project_insights WHERE project_id=?", args: [project_id] });
      if (!rows.rows.length) return res.status(200).json({ ok: true, data: null });
      let data = EMPTY_INSIGHTS;
      try { data = { ...EMPTY_INSIGHTS, ...JSON.parse(rows.rows[0].data) }; } catch {}
      return res.status(200).json({ ok: true, data, updated_at: rows.rows[0].updated_at });
    }

    if (action === "merge_insights" && req.method === "POST") {
      const { project_id, tips, strengths, weaknesses, calendar_entries } = req.body;
      if (!project_id) return res.status(400).json({ error: "Manca project_id" });

      const existing = await db.execute({ sql: "SELECT data FROM project_insights WHERE project_id=?", args: [project_id] });
      let current = EMPTY_INSIGHTS;
      if (existing.rows.length) {
        try { current = { ...EMPTY_INSIGHTS, ...JSON.parse(existing.rows[0].data) }; } catch {}
      }

      current.tips = dedupAppend(current.tips, tips, 30);
      current.strengths = dedupAppend(current.strengths, strengths, 20);
      current.weaknesses = dedupAppend(current.weaknesses, weaknesses, 20);

      if (Array.isArray(calendar_entries) && calendar_entries.length) {
        const newEntries = calendar_entries.map(e => ({
          id: crypto.randomUUID(),
          idea: e.idea || "",
          rationale: e.rationale || "",
          content_type: e.content_type || "Post",
          visual_scout_brief: e.visual_scout_brief || "",
          status: "suggerito",
          created_at: new Date().toISOString(),
        }));
        current.calendar = [...(current.calendar || []), ...newEntries].slice(-30);
      }

      await db.execute({
        sql: `INSERT INTO project_insights (project_id, data, updated_at) VALUES (?,?,datetime('now'))
              ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
        args: [project_id, JSON.stringify(current)],
      });
      return res.status(200).json({ ok: true, data: current });
    }

    if (action === "update_calendar_status" && req.method === "POST") {
      const { project_id, entry_id, status } = req.body;
      if (!project_id || !entry_id) return res.status(400).json({ error: "Mancano project_id o entry_id" });
      const existing = await db.execute({ sql: "SELECT data FROM project_insights WHERE project_id=?", args: [project_id] });
      if (!existing.rows.length) return res.status(404).json({ error: "Nessun insight per questo progetto" });
      let current = EMPTY_INSIGHTS;
      try { current = { ...EMPTY_INSIGHTS, ...JSON.parse(existing.rows[0].data) }; } catch {}
      current.calendar = (current.calendar || []).map(e => e.id === entry_id ? { ...e, status: status || "generato" } : e);
      await db.execute({
        sql: "UPDATE project_insights SET data=?, updated_at=datetime('now') WHERE project_id=?",
        args: [JSON.stringify(current), project_id],
      });
      return res.status(200).json({ ok: true, data: current });
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
