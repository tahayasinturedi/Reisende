'use strict';

/* ── State ── */
const A = {
  token:    localStorage.getItem('admin-token') || '',
  songs:    [],
  events:   [],
  tab:      'songs',
  mode:     null,       // 'song' | 'event'
  editing:  null,       // current item being edited (null = new)
  setlist:  [],         // current setlist in event modal
  dragSrc:  null        // drag-and-drop source element
};

/* ── API ── */
async function api(method, url, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['X-Admin-Token'] = A.token;
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

/* ── Helpers ── */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function slugify(str) {
  const map = {ş:'s',ğ:'g',ı:'i',ö:'o',ü:'u',ç:'c',Ş:'s',Ğ:'g',İ:'i',Ö:'o',Ü:'u',Ç:'c'};
  return str.toLowerCase()
    .replace(/[şğıöüçŞĞİÖÜÇ]/g, m => map[m] ?? m)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function download(filename, data) {
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
  a.download = filename;
  a.click();
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch { reject(new Error('Geçersiz JSON dosyası.')); }
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsText(file);
  });
}

async function importJSON(endpoint, file, label) {
  try {
    const data = await readJsonFile(file);
    const res  = await api('POST', endpoint, data, true);
    await loadAll();
    alert(`${res.count} ${label} başarıyla yüklendi.`);
  } catch (e) {
    alert('Hata: ' + e.message);
  }
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? dateStr : d.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' });
}

/* ── Auth ── */
async function login(password) {
  try {
    const res = await api('POST', '/api/auth', { password });
    A.token = res.token;
    localStorage.setItem('admin-token', A.token);
    showPanel();
  } catch (e) {
    $('login-error').textContent = e.message;
  }
}

function logout() {
  A.token = '';
  localStorage.removeItem('admin-token');
  $('admin-panel').classList.remove('visible');
  $('login-screen').style.display = '';
  $('pw-input').value = '';
  $('login-error').textContent = '';
}

/* ── Boot ── */
async function showPanel() {
  $('login-screen').style.display = 'none';
  $('admin-panel').classList.add('visible');
  await loadAll();
}

async function loadAll() {
  [A.songs, A.events] = await Promise.all([
    api('GET', '/api/songs'),
    api('GET', '/api/events')
  ]);
  renderSongs();
  renderEvents();
}

/* ── Songs ── */
function renderSongs() {
  const tbody = $('songs-tbody');
  if (!A.songs.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.4;padding:2rem;font-style:italic;">Henüz şarkı yok.</td></tr>';
    return;
  }
  tbody.innerHTML = A.songs.map((s, i) => `
    <tr>
      <td class="num-cell">${String(i + 1).padStart(2,'0')}</td>
      <td>${esc(s.title)}</td>
      <td class="meta-cell">${esc(s.genre || '—')}</td>
      <td class="meta-cell">${esc(s.duration || '—')}</td>
      <td class="actions-cell">
        <button class="btn-edit" data-action="edit-song" data-id="${esc(s.id)}">Düzenle</button>
        <button class="btn-delete" data-action="del-song" data-id="${esc(s.id)}">Sil</button>
      </td>
    </tr>`).join('');
}

/* ── Events ── */
function renderEvents() {
  const tbody = $('events-tbody');
  if (!A.events.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.4;padding:2rem;font-style:italic;">Henüz konser yok.</td></tr>';
    return;
  }
  tbody.innerHTML = A.events.map(ev => {
    const past = new Date(ev.date) < new Date();
    return `
      <tr>
        <td class="meta-cell" style="white-space:nowrap">${fmtDate(ev.date)}</td>
        <td>${esc(ev.name)} ${past ? '<span style="font-size:.65rem;opacity:.4;letter-spacing:.08em;text-transform:uppercase;margin-left:.5rem;">Geçti</span>' : ''}</td>
        <td class="meta-cell">${esc(ev.venue)} · ${esc(ev.city)}</td>
        <td class="meta-cell">${(ev.setlist || []).length} şarkı</td>
        <td class="actions-cell">
          <button class="btn-edit" data-action="edit-event" data-id="${esc(ev.id)}">Düzenle</button>
          <button class="btn-delete" data-action="del-event" data-id="${esc(ev.id)}">Sil</button>
        </td>
      </tr>`;
  }).join('');
}

/* ── Song Modal ── */
async function openSongModal(song = null) {
  A.mode    = 'song';
  A.editing = song;

  let lyricsJSON = '';
  if (song) {
    try {
      const raw = await api('GET', `/api/songs/${song.id}/lyrics`);
      lyricsJSON = JSON.stringify(raw, null, 2);
    } catch (_) {}
  }

  $('modal-title').textContent = song ? 'Şarkı Düzenle' : 'Yeni Şarkı';
  $('modal-body').innerHTML = `
    <div class="field-row">
      <div class="field">
        <label>Başlık</label>
        <input id="f-title" type="text" value="${esc(song?.title || '')}" placeholder="Yolcu">
      </div>
      <div class="field">
        <label>ID (slug)</label>
        <input id="f-id" type="text" value="${esc(song?.id || '')}" placeholder="yolcu" ${song ? 'readonly' : ''}>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Tür</label>
        <input id="f-genre" type="text" value="${esc(song?.genre || '')}" placeholder="Folk">
      </div>
      <div class="field">
        <label>Süre</label>
        <input id="f-duration" type="text" value="${esc(song?.duration || '')}" placeholder="3:45">
      </div>
    </div>
    <div class="field">
      <label>Şarkı Sözleri (JSON dizisi)</label>
      <textarea id="f-lyrics" placeholder='[\n  {"tr":"...", "de":"...", "en":"..."},\n  {}\n]'>${esc(lyricsJSON)}</textarea>
      <div class="field-hint">songs.dm şablonunu kullanarak ürettiğiniz JSON'u buraya yapıştırın. Boş bırakabilirsiniz.</div>
      <div class="json-status" id="json-status"></div>
    </div>`;

  /* Auto-generate slug from title */
  if (!song) {
    $('f-title').addEventListener('input', () => {
      $('f-id').value = slugify($('f-title').value);
    });
  }

  /* Live JSON validation */
  $('f-lyrics').addEventListener('input', validateLyrics);

  openModal();
}

function validateLyrics() {
  const val = $('f-lyrics').value.trim();
  const el  = $('json-status');
  if (!val) { el.textContent = ''; return true; }
  try {
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) throw new Error('Dizi olmalı');
    const lines = parsed.filter(l => l && Object.keys(l).length > 0);
    el.textContent = `✓ Geçerli JSON — ${lines.length} satır`;
    el.className = 'json-status ok';
    return true;
  } catch (e) {
    el.textContent = '✗ Geçersiz JSON: ' + e.message;
    el.className = 'json-status err';
    return false;
  }
}

async function saveSong() {
  const title    = $('f-title').value.trim();
  const id       = $('f-id').value.trim();
  const genre    = $('f-genre').value.trim();
  const duration = $('f-duration').value.trim();
  const rawLyrics = $('f-lyrics').value.trim();

  if (!title || !id) { setModalError('Başlık ve ID zorunludur.'); return; }
  if (rawLyrics && !validateLyrics()) { setModalError('Şarkı sözleri geçerli JSON değil.'); return; }

  const meta   = { id, title, ...(genre && { genre }), ...(duration && { duration }) };
  const lyrics = rawLyrics ? JSON.parse(rawLyrics) : undefined;

  try {
    setSaving(true);
    if (A.editing) {
      await api('PUT', `/api/songs/${A.editing.id}`, { meta, lyrics }, true);
    } else {
      await api('POST', '/api/songs', { meta, lyrics }, true);
    }
    closeModal();
    await loadAll();
  } catch (e) {
    setModalError(e.message);
  } finally {
    setSaving(false);
  }
}

async function deleteSong(id) {
  const song = A.songs.find(s => s.id === id);
  if (!confirm(`"${song?.title || id}" silinsin mi?`)) return;
  try {
    await api('DELETE', `/api/songs/${id}`, null, true);
    await loadAll();
  } catch (e) { alert(e.message); }
}

/* ── Event Modal ── */
function openEventModal(ev = null) {
  A.mode    = 'event';
  A.editing = ev;
  A.setlist = [...(ev?.setlist || [])];

  $('modal-title').textContent = ev ? 'Konser Düzenle' : 'Yeni Konser';
  $('modal-body').innerHTML = `
    <div class="field-row">
      <div class="field">
        <label>Konser Adı</label>
        <input id="f-evname" type="text" value="${esc(ev?.name || '')}" placeholder="Sommerfestival Berlin">
      </div>
      <div class="field">
        <label>Tarih</label>
        <input id="f-evdate" type="date" value="${esc(ev?.date || '')}">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Mekan</label>
        <input id="f-evvenue" type="text" value="${esc(ev?.venue || '')}" placeholder="Konzerthaus">
      </div>
      <div class="field">
        <label>Şehir</label>
        <input id="f-evcity" type="text" value="${esc(ev?.city || '')}" placeholder="Berlin, DE">
      </div>
    </div>
    <div>
      <div class="setlist-label">Setlist <span style="opacity:.4;font-size:.75rem;margin-left:.5rem;">(sürükle ile sırala)</span></div>
      <div id="setlist-drag-zone"></div>
      <div class="available-label">Eklemek için tıkla</div>
      <div id="available-songs"></div>
    </div>`;

  renderSetlistEditor();
  openModal();
}

function renderSetlistEditor() {
  const zone = $('setlist-drag-zone');
  const avail = $('available-songs');
  if (!zone || !avail) return;

  if (A.setlist.length === 0) {
    zone.innerHTML = '<div class="setlist-empty">Henüz şarkı eklenmedi</div>';
  } else {
    zone.innerHTML = A.setlist.map((id, i) => {
      const meta = A.songs.find(s => s.id === id) || { id, title: id };
      return `
        <div class="sl-row" draggable="true" data-sl-id="${esc(id)}">
          <span class="drag-handle">⠿</span>
          <span class="sl-num">${String(i + 1).padStart(2,'0')}</span>
          <span class="sl-title">${esc(meta.title)}</span>
          <button class="btn-sl-remove" data-sl-remove="${esc(id)}" title="Kaldır">×</button>
        </div>`;
    }).join('');
    initSetlistDnD();
  }

  const notInSetlist = A.songs.filter(s => !A.setlist.includes(s.id));
  avail.innerHTML = notInSetlist.length
    ? notInSetlist.map(s => `
        <div class="avail-chip" data-sl-add="${esc(s.id)}">
          <span>+</span><span>${esc(s.title)}</span>
        </div>`).join('')
    : '<span style="opacity:.35;font-size:.8125rem;font-style:italic;">Tüm şarkılar setlistte.</span>';
}

function initSetlistDnD() {
  const rows = document.querySelectorAll('.sl-row');
  rows.forEach(row => {
    row.addEventListener('dragstart', e => {
      A.dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.sl-row').forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.sl-row').forEach(r => r.classList.remove('drag-over'));
      if (row !== A.dragSrc) row.classList.add('drag-over');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!A.dragSrc || A.dragSrc === row) return;
      const from = A.setlist.indexOf(A.dragSrc.dataset.slId);
      const to   = A.setlist.indexOf(row.dataset.slId);
      if (from === -1 || to === -1) return;
      A.setlist.splice(to, 0, A.setlist.splice(from, 1)[0]);
      renderSetlistEditor();
    });
  });
}

async function saveEvent() {
  const name  = $('f-evname').value.trim();
  const date  = $('f-evdate').value;
  const venue = $('f-evvenue').value.trim();
  const city  = $('f-evcity').value.trim();

  if (!name || !date) { setModalError('Konser adı ve tarih zorunludur.'); return; }

  const id = A.editing?.id || `${slugify(city.split(',')[0])}-${new Date(date).getFullYear()}`;

  const payload = { id, date, name, venue, city, setlist: A.setlist };

  try {
    setSaving(true);
    if (A.editing) {
      await api('PUT', `/api/events/${A.editing.id}`, payload, true);
    } else {
      await api('POST', '/api/events', payload, true);
    }
    closeModal();
    await loadAll();
  } catch (e) {
    setModalError(e.message);
  } finally {
    setSaving(false);
  }
}

async function deleteEvent(id) {
  const ev = A.events.find(e => e.id === id);
  if (!confirm(`"${ev?.name || id}" silinsin mi?`)) return;
  try {
    await api('DELETE', `/api/events/${id}`, null, true);
    await loadAll();
  } catch (e) { alert(e.message); }
}

/* ── Modal helpers ── */
function openModal() {
  $('modal-error').textContent = '';
  $('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  A.mode = null; A.editing = null; A.setlist = [];
}

function setModalError(msg) { $('modal-error').textContent = msg; }
function setSaving(on) { $('btn-modal-save').disabled = on; }

/* ── Events (DOM) ── */
document.addEventListener('DOMContentLoaded', () => {
  /* Login */
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    await login($('pw-input').value);
  });

  $('btn-logout').addEventListener('click', logout);

  /* Tabs */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      A.tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${A.tab}`).classList.add('active');
    });
  });

  /* Add buttons */
  $('btn-add-song').addEventListener('click', () => openSongModal());
  $('btn-add-event').addEventListener('click', () => openEventModal());

  /* Download buttons */
  $('btn-dl-songs').addEventListener('click', () => download('index.json', A.songs));
  $('btn-dl-events').addEventListener('click', () => download('events.json', A.events));

  /* Upload buttons */
  $('btn-ul-songs').addEventListener('click', () => $('file-songs').click());
  $('btn-ul-events').addEventListener('click', () => $('file-events').click());
  $('file-songs').addEventListener('change', e => {
    if (e.target.files[0]) importJSON('/api/songs/import', e.target.files[0], 'şarkı');
    e.target.value = '';
  });
  $('file-events').addEventListener('change', e => {
    if (e.target.files[0]) importJSON('/api/events/import', e.target.files[0], 'konser');
    e.target.value = '';
  });

  /* Modal buttons */
  $('btn-close-modal').addEventListener('click', closeModal);
  $('btn-modal-cancel').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeModal();
  });

  $('btn-modal-save').addEventListener('click', () => {
    if (A.mode === 'song')  saveSong();
    if (A.mode === 'event') saveEvent();
  });

  /* Table action delegation */
  document.addEventListener('click', e => {
    const action = e.target.dataset.action;
    const id     = e.target.dataset.id;

    if (action === 'edit-song')  openSongModal(A.songs.find(s => s.id === id));
    if (action === 'del-song')   deleteSong(id);
    if (action === 'edit-event') openEventModal(A.events.find(ev => ev.id === id));
    if (action === 'del-event')  deleteEvent(id);

    /* Setlist: remove */
    const removeId = e.target.dataset.slRemove;
    if (removeId) {
      A.setlist = A.setlist.filter(i => i !== removeId);
      renderSetlistEditor();
    }

    /* Setlist: add */
    const addId = e.target.closest('[data-sl-add]')?.dataset.slAdd;
    if (addId && !A.setlist.includes(addId)) {
      A.setlist.push(addId);
      renderSetlistEditor();
    }
  });

  /* Auto-login if token exists */
  if (A.token) {
    api('GET', '/api/songs').then(showPanel).catch(() => {
      A.token = '';
      localStorage.removeItem('admin-token');
    });
  }
});
