'use strict';
require('dotenv').config();

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.ADMIN_PASSWORD;

if (!PASS) console.warn('[WARN] ADMIN_PASSWORD ayarlanmamış — admin paneli devre dışı.');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').split('?')[0],
  ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

/* ── DB init + seed ── */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS songs (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      genre      TEXT,
      duration   TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lyrics (
      song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
      data    JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      date       TEXT NOT NULL,
      name       TEXT NOT NULL,
      venue      TEXT,
      city       TEXT,
      setlist    JSONB DEFAULT '[]',
      poster     TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE events ADD COLUMN IF NOT EXISTS poster TEXT;
    CREATE TABLE IF NOT EXISTS photos (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  /* Seed from JSON files if DB is empty */
  const { rows: existing } = await pool.query('SELECT COUNT(*) FROM songs');
  if (existing[0].count === '0') {
    const indexPath = path.join(__dirname, 'lyrics', 'index.json');
    if (fs.existsSync(indexPath)) {
      const songs = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const s of songs) {
        await pool.query(
          'INSERT INTO songs (id, title, genre, duration) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [s.id, s.title, s.genre || null, s.duration || null]
        );
        const lyricsPath = path.join(__dirname, 'lyrics', `${s.id}.json`);
        if (fs.existsSync(lyricsPath)) {
          const data = fs.readFileSync(lyricsPath, 'utf8');
          await pool.query(
            'INSERT INTO lyrics (song_id, data) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [s.id, data]
          );
        }
      }
      console.log(`[DB] ${songs.length} şarkı aktarıldı.`);
    }
  }

  const { rows: exEv } = await pool.query('SELECT COUNT(*) FROM events');
  if (exEv[0].count === '0') {
    const evPath = path.join(__dirname, 'data', 'events.json');
    if (fs.existsSync(evPath)) {
      const events = JSON.parse(fs.readFileSync(evPath, 'utf8'));
      for (const ev of events) {
        await pool.query(
          'INSERT INTO events (id, date, name, venue, city, setlist) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [ev.id, ev.date, ev.name, ev.venue || null, ev.city || null, JSON.stringify(ev.setlist || [])]
        );
      }
      console.log(`[DB] ${events.length} konser aktarıldı.`);
    }
  }

  console.log('[DB] Hazır.');
}

/* ── Auth ── */
const token = () => PASS
  ? crypto.createHash('sha256').update(PASS).digest('hex')
  : null;

function guard(req, res, next) {
  if (!PASS)                                    return res.status(503).json({ error: 'Şifre ayarlanmamış.' });
  if (req.headers['x-admin-token'] !== token()) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  next();
}

app.post('/api/auth', (req, res) => {
  if (!PASS)                      return res.status(503).json({ ok: false, error: 'Şifre ayarlanmamış.' });
  if (req.body.password !== PASS) return res.status(401).json({ ok: false, error: 'Yanlış şifre.' });
  res.json({ ok: true, token: token() });
});

/* ── Songs ── */
app.get('/api/songs', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, genre, duration FROM songs ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/songs/import', guard, async (req, res, next) => {
  const songs = req.body;
  if (!Array.isArray(songs)) return res.status(400).json({ error: 'Dizi bekleniyor.' });
  try {
    for (const s of songs) {
      await pool.query(
        `INSERT INTO songs (id, title, genre, duration)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET title=$2, genre=$3, duration=$4`,
        [s.id, s.title, s.genre || null, s.duration || null]
      );
    }
    res.json({ ok: true, count: songs.length });
  } catch (e) { next(e); }
});

app.post('/api/events/import', guard, async (req, res, next) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.status(400).json({ error: 'Dizi bekleniyor.' });
  try {
    for (const ev of events) {
      await pool.query(
        `INSERT INTO events (id, date, name, venue, city, setlist, poster)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET date=$2, name=$3, venue=$4, city=$5, setlist=$6, poster=$7`,
        [ev.id, ev.date, ev.name, ev.venue || null, ev.city || null, JSON.stringify(ev.setlist || []), ev.poster || null]
      );
    }
    res.json({ ok: true, count: events.length });
  } catch (e) { next(e); }
});

app.get('/api/songs/:id/lyrics', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT data FROM lyrics WHERE song_id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Şarkı sözleri bulunamadı.' });
    res.json(rows[0].data);
  } catch (e) { next(e); }
});

app.post('/api/songs', guard, async (req, res, next) => {
  const { meta, lyrics } = req.body;
  try {
    await pool.query(
      'INSERT INTO songs (id, title, genre, duration) VALUES ($1,$2,$3,$4)',
      [meta.id, meta.title, meta.genre || null, meta.duration || null]
    );
    if (lyrics) {
      await pool.query(
        'INSERT INTO lyrics (song_id, data) VALUES ($1,$2) ON CONFLICT (song_id) DO UPDATE SET data=$2',
        [meta.id, JSON.stringify(lyrics)]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu ID zaten var.' });
    next(e);
  }
});

app.put('/api/songs/:id', guard, async (req, res, next) => {
  const { meta, lyrics } = req.body;
  try {
    const { rowCount } = await pool.query(
      'UPDATE songs SET title=$1, genre=$2, duration=$3 WHERE id=$4',
      [meta.title, meta.genre || null, meta.duration || null, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Bulunamadı.' });
    if (lyrics) {
      await pool.query(
        'INSERT INTO lyrics (song_id, data) VALUES ($1,$2) ON CONFLICT (song_id) DO UPDATE SET data=$2',
        [req.params.id, JSON.stringify(lyrics)]
      );
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/songs/:id', guard, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM songs WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Events ── */
app.get('/api/events', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, date, name, venue, city, setlist, poster FROM events ORDER BY date ASC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/events', guard, async (req, res, next) => {
  const { id, date, name, venue, city, setlist, poster } = req.body;
  try {
    await pool.query(
      'INSERT INTO events (id, date, name, venue, city, setlist, poster) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, date, name, venue || null, city || null, JSON.stringify(setlist || []), poster || null]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu ID zaten var.' });
    next(e);
  }
});

app.put('/api/events/:id', guard, async (req, res, next) => {
  const { id, date, name, venue, city, setlist, poster } = req.body;
  try {
    const { rowCount } = await pool.query(
      'UPDATE events SET id=$1, date=$2, name=$3, venue=$4, city=$5, setlist=$6, poster=$7 WHERE id=$8',
      [id, date, name, venue || null, city || null, JSON.stringify(setlist || []), poster ?? null, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Bulunamadı.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/events/:id', guard, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM events WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Photos ── */
app.get('/api/photos', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, data, sort_order FROM photos ORDER BY sort_order ASC, created_at ASC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/photos', guard, async (req, res, next) => {
  const { id, data, sort_order } = req.body;
  try {
    await pool.query(
      'INSERT INTO photos (id, data, sort_order) VALUES ($1,$2,$3)',
      [id, data, sort_order ?? 0]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu ID zaten var.' });
    next(e);
  }
});

app.put('/api/photos/reorder', guard, async (req, res, next) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Dizi bekleniyor.' });
  try {
    for (const item of items) {
      await pool.query('UPDATE photos SET sort_order=$1 WHERE id=$2', [item.sort_order, item.id]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/photos/:id', guard, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM photos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Contact ── */
app.post('/api/contact', async (req, res, next) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Tüm alanlar zorunludur.' });
  try {
    await pool.query(
      'INSERT INTO messages (name, email, message) VALUES ($1,$2,$3)',
      [name.trim(), email.trim(), message.trim()]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/messages', guard, async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

app.delete('/api/messages/:id', guard, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM messages WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Error handler ── */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası.' });
});

/* ── Start ── */
initDB()
  .then(() => app.listen(PORT, () =>
    console.log(`Reisende çalışıyor → http://localhost:${PORT}`)
  ))
  .catch(err => {
    console.error('[DB] Bağlantı hatası:', err.message);
    process.exit(1);
  });
