// /api/history.js — CRUD per progetti, storico richieste AI e insight accumulati (VMScout)
// Persiste ciò che prima viveva solo in localStorage: progetti (brand), ogni
// domanda/risposta generata dall'AI (strategia, analytics, ecc.) per progetto,
// e la "memoria" di progetto (punti di forza/debolezza, consigli, calendario
// post) che si arricchisce a ogni analisi Instagram — la base del loop di
// auto-apprendimento: ogni nuova strategia/analisi la legge prima di generare.

import {
  getDb, ensureAuthTables, hashPassword, verifyPassword, DUMMY_HASH,
  createSession, sessionSetCookie, sessionClearCookie, destroySession,
  getSessionUser, assertOwnsProject, normLang, badOrigin, getAppConfig,
} from "./db.js";
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
  const ALTERS = [
    ["projects", "logo TEXT"],
    ["projects", "user_id TEXT"],
    ["requests", "user_id TEXT"],
    ["canva_designs", "user_id TEXT"],
    ["project_insights", "user_id TEXT"],
  ];
  for (const [t, col] of ALTERS) {
    try { await db.execute(`ALTER TABLE ${t} ADD COLUMN ${col}`); } catch { /* già presente */ }
  }
  for (const ix of [
    "CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_designs_user ON canva_designs(user_id)",
  ]) { try { await db.execute(ix); } catch { /* ok */ } }

  await ensureAuthTables(db);
}

const EMPTY_INSIGHTS = { tips: [], strengths: [], weaknesses: [], calendar: [], directives: "", directives_updated_at: null, strategy: null, ad_strategy: null };

const MAX_DIRECTIVES_CHARS = 4000;

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

    // ═══ AUTH — pubbliche (nessuna sessione richiesta) ══════════
    if (action === "auth_register" && req.method === "POST") {
      if (badOrigin(req)) return res.status(403).json({ error: "BAD_ORIGIN" });
      const nickname = String(req.body?.nickname || "").trim().normalize("NFKC");
      const password = String(req.body?.password || "");
      const lang = normLang(req.body?.lang);
      if (!/^[\p{L}\p{N}_.\- ]{2,32}$/u.test(nickname)) return res.status(400).json({ error: "INVALID_NICKNAME" });
      if (password.length < 6 || password.length > 200) return res.status(400).json({ error: "INVALID_PASSWORD" });
      const nickLower = nickname.toLowerCase();
      const dup = await db.execute({ sql: "SELECT 1 FROM vms_users WHERE nickname_lower=?", args: [nickLower] });
      if (dup.rows.length) return res.status(409).json({ error: "NICKNAME_TAKEN" });

      const first = Number((await db.execute("SELECT COUNT(*) AS n FROM vms_users")).rows[0].n) === 0;
      const uid = crypto.randomUUID();
      const stmts = [{
        sql: "INSERT INTO vms_users (id, nickname, nickname_lower, pass_hash, lang) VALUES (?,?,?,?,?)",
        args: [uid, nickname, nickLower, hashPassword(password), lang],
      }];
      if (first) {
        for (const t of ["projects", "requests", "canva_designs", "project_insights"]) {
          stmts.push({ sql: `UPDATE ${t} SET user_id=? WHERE user_id IS NULL`, args: [uid] });
        }
        stmts.push(
          { sql: `INSERT INTO canva_auth_u (user_id, access_token, refresh_token, expires_in, created_at)
                  SELECT ?, access_token, refresh_token, expires_in, created_at FROM canva_auth WHERE id=1
                  ON CONFLICT(user_id) DO NOTHING`, args: [uid] },
          { sql: "DELETE FROM canva_auth WHERE id=1", args: [] },
          { sql: `INSERT INTO fb_auth_u (user_id, access_token, expires_in, created_at)
                  SELECT ?, access_token, expires_in, created_at FROM fb_auth WHERE id=1
                  ON CONFLICT(user_id) DO NOTHING`, args: [uid] },
          { sql: "DELETE FROM fb_auth WHERE id=1", args: [] },
        );
      }
      try { await db.batch(stmts, "write"); }
      catch (e) {
        if (/UNIQUE|nickname_lower/.test(String(e.message))) return res.status(409).json({ error: "NICKNAME_TAKEN" });
        throw e;
      }
      const raw = await createSession(db, uid, req);
      res.setHeader("Set-Cookie", sessionSetCookie(raw));
      return res.status(200).json({ ok: true, user: { id: uid, nickname, lang }, adopted: first });
    }

    if (action === "auth_login" && req.method === "POST") {
      if (badOrigin(req)) return res.status(403).json({ error: "BAD_ORIGIN" });
      const nickname = String(req.body?.nickname || "").trim().normalize("NFKC");
      const password = String(req.body?.password || "");
      const r = await db.execute({
        sql: "SELECT id, nickname, pass_hash, lang FROM vms_users WHERE nickname_lower=?",
        args: [nickname.toLowerCase()],
      });
      const row = r.rows[0];
      const ok = verifyPassword(password, row ? row.pass_hash : DUMMY_HASH);
      if (!row || !ok) return res.status(401).json({ error: "BAD_CREDENTIALS" });
      const raw = await createSession(db, row.id, req);
      res.setHeader("Set-Cookie", sessionSetCookie(raw));
      db.execute({
        sql: `DELETE FROM vms_sessions WHERE user_id=? AND token_hash NOT IN
              (SELECT token_hash FROM vms_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 10)`,
        args: [row.id, row.id],
      }).catch(() => {});
      return res.status(200).json({ ok: true, user: { id: row.id, nickname: row.nickname, lang: normLang(row.lang) } });
    }

    if (action === "auth_logout" && req.method === "POST") {
      await destroySession(db, req).catch(() => {});
      res.setHeader("Set-Cookie", sessionClearCookie());
      return res.status(200).json({ ok: true });
    }

    if (action === "auth_me" && req.method === "GET") {
      const u = await getSessionUser(db, req);
      return res.status(200).json({ ok: true, user: u });
    }

    // ═══ Tutto il resto richiede una sessione ══════════════════
    const me = await getSessionUser(db, req);
    if (!me) return res.status(401).json({ error: "AUTH_REQUIRED" });

    if (action === "auth_set_lang" && req.method === "POST") {
      if (badOrigin(req)) return res.status(403).json({ error: "BAD_ORIGIN" });
      const lang = normLang(req.body?.lang);
      await db.execute({ sql: "UPDATE vms_users SET lang=? WHERE id=?", args: [lang, me.id] });
      return res.status(200).json({ ok: true, lang });
    }

    // ─── Credenziali app di terze parti (Canva / Meta) ─────────
    // Vista non-segreta: i secret non escono mai dal server, solo il flag "set".
    if (action === "get_app_config" && req.method === "GET") {
      const cfg = await getAppConfig(db, me.id);
      const ownCfg = await db.execute({
        sql: "SELECT canva_client_id, canva_client_secret, fb_app_id, fb_app_secret FROM app_config_u WHERE user_id=?",
        args: [me.id],
      }).catch(() => ({ rows: [] }));
      const row = ownCfg.rows[0] || {};
      return res.status(200).json({
        ok: true,
        canvaClientId: row.canva_client_id || "",
        fbAppId:       row.fb_app_id || "",
        canvaSecretSet: !!row.canva_client_secret,
        fbSecretSet:    !!row.fb_app_secret,
        // se l'utente non ha impostato nulla ma c'è un fallback da env, l'app
        // funziona lo stesso: lo segnaliamo per non allarmare.
        source: cfg.source,
      });
    }

    if (action === "save_app_config" && req.method === "POST") {
      if (badOrigin(req)) return res.status(403).json({ error: "BAD_ORIGIN" });
      const b = req.body || {};
      const clean = (v) => (v == null ? null : String(v).trim().replace(/^["']|["']$/g, ""));
      const fields = {
        canva_client_id:     clean(b.canvaClientId),
        canva_client_secret: clean(b.canvaClientSecret),
        fb_app_id:           clean(b.fbAppId),
        fb_app_secret:       clean(b.fbAppSecret),
      };
      // solo le chiavi effettivamente presenti nel body vengono toccate
      const keyMap = { canvaClientId: "canva_client_id", canvaClientSecret: "canva_client_secret", fbAppId: "fb_app_id", fbAppSecret: "fb_app_secret" };
      const sets = [];
      const args = [];
      for (const [bodyKey, col] of Object.entries(keyMap)) {
        if (bodyKey in b) { sets.push(`${col}=?`); args.push(fields[col] || ""); }
      }
      if (!sets.length) return res.status(400).json({ error: "Nessun campo da salvare" });
      await db.execute({
        sql: `INSERT INTO app_config_u (user_id, ${Object.values(keyMap).join(", ")}, updated_at)
              VALUES (?, ${Object.values(keyMap).map(() => "?").join(", ")}, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET ${sets.join(", ")}, updated_at=datetime('now')`,
        args: [me.id, fields.canva_client_id || "", fields.canva_client_secret || "", fields.fb_app_id || "", fields.fb_app_secret || "", ...args],
      });
      return res.status(200).json({ ok: true });
    }

    const own = async (projectId, opts) => {
      try { await assertOwnsProject(db, me.id, projectId, opts); return null; }
      catch (e) { res.status(e.status || 500).json({ error: e.message }); return e; }
    };

    // ─── PROJECTS ──────────────────────────────────────────────
    if (action === "projects" && req.method === "GET") {
      const rows = await db.execute({ sql: "SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC", args: [me.id] });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (action === "save_project" && req.method === "POST") {
      const { id, name, sector, description, tone, instagramHandle, hashtags, logo, canvaTemplates } = req.body;
      if (!id || !name) return res.status(400).json({ error: "Mancano id o name" });
      const existing = await db.execute({ sql: "SELECT user_id FROM projects WHERE id=?", args: [id] });
      if (existing.rows.length && existing.rows[0].user_id && existing.rows[0].user_id !== me.id) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      await db.execute({
        sql: `INSERT INTO projects (id, user_id, name, sector, description, tone, instagram_handle, hashtags, logo, canva_templates, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, sector=excluded.sector, description=excluded.description,
                tone=excluded.tone, instagram_handle=excluded.instagram_handle,
                hashtags=excluded.hashtags, logo=excluded.logo, canva_templates=excluded.canva_templates,
                updated_at=excluded.updated_at`,
        args: [id, me.id, name, sector || "", description || "", tone || "", instagramHandle || "", hashtags || "", logo || "", JSON.stringify(canvaTemplates || {})],
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "delete_project" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      if (await own(id, { allowMissing: true })) return;
      await db.execute({ sql: "DELETE FROM projects WHERE id=? AND user_id=?", args: [id, me.id] });
      await db.execute({ sql: "DELETE FROM requests WHERE project_id=? AND user_id=?", args: [id, me.id] });
      await db.execute({ sql: "DELETE FROM canva_designs WHERE project_id=? AND user_id=?", args: [id, me.id] });
      await db.execute({ sql: "DELETE FROM project_insights WHERE project_id=? AND user_id=?", args: [id, me.id] });
      return res.status(200).json({ ok: true });
    }

    // Rimuove i progetti-fantasma: default senza nome utile, con TUTTI i campi
    // vuoti, nessun template Canva valorizzato e nessun dato associato
    // (richieste AI / insight / design). Provabilmente sicuro.
    if (action === "cleanup_empty_projects" && req.method === "POST") {
      const r = await db.execute({ args: [me.id], sql: `
        DELETE FROM projects
        WHERE user_id = ?
          AND (name IS NULL OR name = '' OR name = 'Il Mio Brand')
          AND COALESCE(sector,'') = '' AND COALESCE(description,'') = ''
          AND COALESCE(tone,'') = '' AND COALESCE(instagram_handle,'') = ''
          AND COALESCE(hashtags,'') = '' AND COALESCE(logo,'') = ''
          AND NOT EXISTS (
            SELECT 1 FROM json_each(COALESCE(NULLIF(projects.canva_templates, ''), '{}'))
            WHERE json_each.value IS NOT NULL AND json_each.value <> ''
          )
          AND id NOT IN (SELECT DISTINCT project_id FROM requests WHERE project_id IS NOT NULL)
          AND id NOT IN (SELECT project_id FROM project_insights)
          AND id NOT IN (SELECT DISTINCT project_id FROM canva_designs WHERE project_id IS NOT NULL)
      ` });
      return res.status(200).json({ ok: true, deleted: Number(r.rowsAffected || 0) });
    }

    // ─── REQUESTS (storico domande/risposte AI) ────────────────
    if (action === "save_request" && req.method === "POST") {
      const { project_id, type, prompt, result_json } = req.body;
      if (!type || !prompt) return res.status(400).json({ error: "Mancano type o prompt" });
      if (await own(project_id, { allowMissing: true })) return;
      const result = await db.execute({
        sql: "INSERT INTO requests (project_id, user_id, type, prompt, result_json) VALUES (?,?,?,?,?)",
        args: [project_id || null, me.id, type, prompt, JSON.stringify(result_json ?? null)],
      });
      return res.status(200).json({ ok: true, id: Number(result.lastInsertRowid) });
    }

    if (action === "history" && req.method === "GET") {
      const { project_id, type, limit } = req.query;
      const where = ["user_id = ?"];
      const args = [me.id];
      if (project_id) { where.push("project_id = ?"); args.push(project_id); }
      if (type) { where.push("type = ?"); args.push(type); }
      let sql = "SELECT * FROM requests WHERE " + where.join(" AND ");
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(Number(limit) || 50);
      const rows = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (action === "delete_request" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      await db.execute({ sql: "DELETE FROM requests WHERE id=? AND user_id=?", args: [id, me.id] });
      return res.status(200).json({ ok: true });
    }

    // ─── CANVA DESIGNS (design creati dall'app, per progetto) ──────
    if (action === "save_design" && req.method === "POST") {
      const { project_id, kind, format, title, design_url, thumb_url, slides } = req.body;
      if (!design_url) return res.status(400).json({ error: "Manca design_url" });
      if (await own(project_id, { allowMissing: true })) return;
      const result = await db.execute({
        sql: "INSERT INTO canva_designs (project_id, user_id, kind, format, title, design_url, thumb_url, slides) VALUES (?,?,?,?,?,?,?,?)",
        args: [project_id || null, me.id, kind || "design", format || null, title || null, design_url, thumb_url || null, slides != null ? Number(slides) : null],
      });
      return res.status(200).json({ ok: true, id: Number(result.lastInsertRowid) });
    }

    if (action === "designs" && req.method === "GET") {
      const { project_id, limit } = req.query;
      let sql = "SELECT * FROM canva_designs WHERE user_id = ?";
      const args = [me.id];
      if (project_id) { sql += " AND project_id = ?"; args.push(project_id); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(Number(limit) || 60);
      const rows = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, data: rows.rows });
    }

    if (action === "delete_design" && req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Manca id" });
      await db.execute({ sql: "DELETE FROM canva_designs WHERE id=? AND user_id=?", args: [id, me.id] });
      return res.status(200).json({ ok: true });
    }

    // ─── PROJECT INSIGHTS (memoria di progetto per il loop di auto-apprendimento) ─
    if (action === "get_insights" && req.method === "GET") {
      const { project_id } = req.query;
      if (!project_id) return res.status(400).json({ error: "Manca project_id" });
      if (await own(project_id, { allowMissing: true })) return;
      const rows = await db.execute({ sql: "SELECT data, updated_at FROM project_insights WHERE project_id=? AND user_id=?", args: [project_id, me.id] });
      if (!rows.rows.length) return res.status(200).json({ ok: true, data: null });
      let data = EMPTY_INSIGHTS;
      try { data = { ...EMPTY_INSIGHTS, ...JSON.parse(rows.rows[0].data) }; } catch {}
      return res.status(200).json({ ok: true, data, updated_at: rows.rows[0].updated_at });
    }

    // Direttive specifiche del progetto (documento vivo, markdown): lette prima
    // di ogni prompt/analisi e riscritte alla fine dall'AI stessa.
    if (action === "save_directives" && req.method === "POST") {
      const { project_id, directives } = req.body;
      if (!project_id) return res.status(400).json({ error: "Manca project_id" });
      if (await own(project_id, { allowMissing: true })) return;
      const existing = await db.execute({ sql: "SELECT data FROM project_insights WHERE project_id=? AND user_id=?", args: [project_id, me.id] });
      let current = EMPTY_INSIGHTS;
      if (existing.rows.length) {
        try { current = { ...EMPTY_INSIGHTS, ...JSON.parse(existing.rows[0].data) }; } catch {}
      }
      current.directives = String(directives || "").slice(0, MAX_DIRECTIVES_CHARS);
      current.directives_updated_at = new Date().toISOString();
      await db.execute({
        sql: `INSERT INTO project_insights (project_id, user_id, data, updated_at) VALUES (?,?,?,datetime('now'))
              ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
        args: [project_id, me.id, JSON.stringify(current)],
      });
      return res.status(200).json({ ok: true, data: current });
    }

    if (action === "merge_insights" && req.method === "POST") {
      const { project_id, tips, strengths, weaknesses, calendar_entries, directives, strategy, ad_strategy } = req.body;
      if (!project_id) return res.status(400).json({ error: "Manca project_id" });
      if (await own(project_id, { allowMissing: true })) return;

      const existing = await db.execute({ sql: "SELECT data FROM project_insights WHERE project_id=? AND user_id=?", args: [project_id, me.id] });
      let current = EMPTY_INSIGHTS;
      if (existing.rows.length) {
        try { current = { ...EMPTY_INSIGHTS, ...JSON.parse(existing.rows[0].data) }; } catch {}
      }

      current.tips = dedupAppend(current.tips, tips, 30);
      current.strengths = dedupAppend(current.strengths, strengths, 20);
      current.weaknesses = dedupAppend(current.weaknesses, weaknesses, 20);

      // La strategia è uno SNAPSHOT dell'ultima analisi (non si accumula): formati
      // vincenti, timing, pilastri, stile visivo. La leggono Dashboard e Visual Scout.
      if (strategy && typeof strategy === "object") {
        const s = current.strategy && typeof current.strategy === "object" ? { ...current.strategy } : {};
        for (const k of ["winning_formats", "content_pillars"]) {
          if (Array.isArray(strategy[k]) && strategy[k].length) s[k] = strategy[k].slice(0, 8).map(String);
        }
        for (const k of ["patterns_summary", "timing_summary", "best_slot", "visual_style"]) {
          if (typeof strategy[k] === "string" && strategy[k].trim()) s[k] = strategy[k].trim().slice(0, 400);
        }
        if (Object.keys(s).length) { s.updated_at = new Date().toISOString(); current.strategy = s; }
      }

      // Strategia sponsorizzate — snapshot dell'ultima analisi ads: target
      // consigliato, audience migliori, cosa tagliare. Dashboard + Visual Scout.
      if (ad_strategy && typeof ad_strategy === "object") {
        current.ad_strategy = { ...ad_strategy, updated_at: new Date().toISOString() };
      }

      if (typeof directives === "string" && directives.trim()) {
        current.directives = directives.slice(0, MAX_DIRECTIVES_CHARS);
        current.directives_updated_at = new Date().toISOString();
      }

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
        sql: `INSERT INTO project_insights (project_id, user_id, data, updated_at) VALUES (?,?,?,datetime('now'))
              ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
        args: [project_id, me.id, JSON.stringify(current)],
      });
      return res.status(200).json({ ok: true, data: current });
    }

    if (action === "update_calendar_status" && req.method === "POST") {
      const { project_id, entry_id, status } = req.body;
      if (!project_id || !entry_id) return res.status(400).json({ error: "Mancano project_id o entry_id" });
      if (await own(project_id, { allowMissing: true })) return;
      const existing = await db.execute({ sql: "SELECT data FROM project_insights WHERE project_id=? AND user_id=?", args: [project_id, me.id] });
      if (!existing.rows.length) return res.status(404).json({ error: "Nessun insight per questo progetto" });
      let current = EMPTY_INSIGHTS;
      try { current = { ...EMPTY_INSIGHTS, ...JSON.parse(existing.rows[0].data) }; } catch {}
      current.calendar = (current.calendar || []).map(e => e.id === entry_id ? { ...e, status: status || "generato" } : e);
      await db.execute({
        sql: "UPDATE project_insights SET data=?, updated_at=datetime('now') WHERE project_id=? AND user_id=?",
        args: [JSON.stringify(current), project_id, me.id],
      });
      return res.status(200).json({ ok: true, data: current });
    }

    if (action === "stats" && req.method === "GET") {
      const [projCount, reqCount] = await Promise.all([
        db.execute({ sql: "SELECT COUNT(*) as n FROM projects WHERE user_id=?", args: [me.id] }),
        db.execute({ sql: "SELECT COUNT(*) as n, MAX(created_at) as last FROM requests WHERE user_id=?", args: [me.id] }),
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
