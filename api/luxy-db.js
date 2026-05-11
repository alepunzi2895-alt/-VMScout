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
        )`,
        // Canva Auth
        `CREATE TABLE IF NOT EXISTS luxy_canva_auth (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          expires_in INTEGER NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
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
            ('usp', 'Esperienza 100% personalizzata. Assistenza h24. Zero stress. Il cliente non deve pensare a nulla. Accesso a esperienze normalmente inaccessibili.', 'brand')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('instagram_handle', '@luxy.exp', 'instagram')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('instagram_caption_rules', 'Max 3-4 righe. Prima frase = gancio evocativo. CTA finale: "→ DM per info" o "→ link in bio". Firma: ✦. Emoji max 1-2. Hashtag nel primo commento (mai nel caption).', 'instagram')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('instagram_hashtags_core', '#luxyexperience #ibiza #ibizaluxury #villasibiza #yachtibiza #luxuryconcierge #ibizalifestyle #ibizasunset #luxuryvilla #ibizavibes', 'instagram')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('instagram_posting_times', '18:00-20:00 CET (aperitivo hour) | 22:00-23:00 CET (nightlife). Mai nei giorni feriali mattina.', 'instagram')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('canva_template_post', 'INSERISCI_TEMPLATE_ID_POST_1x1', 'canva')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('canva_template_story', 'INSERISCI_TEMPLATE_ID_STORY_9x16', 'canva')`,
          `INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES
            ('canva_template_reel', 'INSERISCI_TEMPLATE_ID_REEL_COVER', 'canva')`
        ], "write");
      }

      return res.status(200).json({ ok: true, message: "Tabelle create e memoria brand inizializzata" });
    }

    // ─── INIT STRATEGY (idempotente — aggiunge solo chiavi nuove) ────
    if (action === "init_strategy") {
      const entries = [
        ["content_pillar_villa",       "Carosello 5 slide villa reveal (esterno golden hour → piscina → camera → terrazza → CTA). Foto singola pool reflection tramonto. Angoli: 'Questo non era prenotabile online.' / 'Brief alle 10. Villa confermata alle 12. ✦'", "strategy"],
        ["content_pillar_yacht",       "Bow shot prua verso orizzonte (zero testo, solo ✦). Reel B-roll 15-30s: attracco → cocktail → tuffo → sunset, musica deep house. Carosello island hopping Ibiza-Formentera-Espalmador. Angoli: 'Nessuna fila. Solo tu e il mare. ✦' / 'Formentera è un privilegio.'", "strategy"],
        ["content_pillar_nightlife",   "Table setup before doors open (venue vuoto = eleganza pre-apertura). Story sondaggio: 'Pacha o Ushuaia?' / 'Villa afterparty o club?'. Reel arrivo VIP: car → entrance → table (15 sec B-roll). Angoli: 'Lista chiusa. Non per te. ✦' / 'La serata inizia dove gli altri finiscono.'", "strategy"],
        ["content_pillar_concierge",   "Dal messaggio al sogno (WhatsApp fittizio → foto risultato). Preparativi: bouquet in villa, ghiaccio yacht, fiori in camera. Caption: 'Ci pensiamo noi.' / 'Non chiediamo se è possibile. Troviamo come farlo.'", "strategy"],
        ["content_pillar_destination", "Es Vedrà tramonto (caption poetica, no promo). Ses Salines / Cala Comte / Atlantis — angolo insider. Ibiza off season (ottobre-novembre). Formentera: 'Solo per chi sa dove andare. ✦'", "strategy"],
        ["content_pillar_cars",        "Keys on marble (chiavi luxury su superficie, 0 testo, solo ✦). Auto davanti cancello villa al tramonto. Reel consegna auto 10 sec loop. Angoli: 'Ogni dettaglio curato. ✦'", "strategy"],
        ["winning_formats",            "Carosello 3-5 slide: salvataggi +40%, reach doppio. Reel 15-30s no voiceover: copertura massima. Foto singola golden hour 1 riga caption: engagement rate top. Story sondaggio binario: warm lead DM diretti.", "strategy"],
        ["caption_hooks_winning",      "Hook: 'Questo è ciò che ottieni quando ci pensiamo noi.' / 'Ibiza non è una destinazione. È uno stato d\'animo.' / 'Hai già la tua villa per agosto?' / 'Last minute accepted.' / 'Ci pensiamo noi. ✦'", "strategy"],
        ["competitor_benchmark",       "Top Ibiza concierge: @ibizaconciergecompany (73K follower, 2.6K post, same-day booking WhatsApp). Formula vincente: mix servizi diversi + location beauty + lifestyle aspiration. Post frequenza: 1/giorno.", "strategy"],
      ];
      let inserted = 0;
      for (const [key, value, category] of entries) {
        await db.execute({
          sql: "INSERT OR IGNORE INTO luxy_brand_memory (key, value, category) VALUES (?,?,?)",
          args: [key, value, category],
        });
        inserted++;
      }
      return res.status(200).json({ ok: true, message: `Strategia content aggiunta: ${inserted} chiavi`, inserted });
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

    // ─── DELETE POST ─────────────────────────────────────────
    if (action === "delete_post" && req.method === "DELETE") {
      const { id } = req.body;
      await db.execute({ sql: "DELETE FROM luxy_posts WHERE id=?", args: [id] });
      return res.status(200).json({ ok: true });
    }

    // ─── DELETE REQUEST ───────────────────────────────────────
    if (action === "delete_request" && req.method === "DELETE") {
      const { id } = req.body;
      await db.execute({ sql: "DELETE FROM luxy_requests WHERE id=?", args: [id] });
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
