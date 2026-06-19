'use strict';

/* ── State ── */
const state = {
  lang: 'de',
  route: '/',
  songView: 'list',
  lyricsMode: 'parallel',
  transLang: 'de',
  strings: {},
  songsManifest: null,
  eventsData: null,
  loadedSongs: {}
};

/* ── Constants ── */
const TRANS_LANGS = ['de', 'fr', 'en', 'it', 'ar', 'ku', 'ukr', 'he', 'tib'];
const TRANS_LANG_NAMES = {
  de:  'Deutsch',
  fr:  'Français',
  en:  'English',
  it:  'Italiano',
  ar:  'العربية',
  ku:  'Kurdî',
  ukr: 'Українська',
  he:  'עברית',
  tib: 'བོད་སྐད'
};
const RTL_LANGS = new Set(['ar', 'he']);

/* ── Helpers ── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function t(key) {
  return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), state.strings) ?? key;
}

/* ── Language ── */
async function loadLanguage(lang) {
  try {
    const res = await fetch(`locales/${lang}.json`);
    if (!res.ok) throw new Error(res.status);
    state.strings = await res.json();
    state.lang = lang;
    document.documentElement.lang = lang;
    localStorage.setItem('reisende-lang', lang);
  } catch (e) {
    console.warn('Could not load locale:', lang, e);
  }
}

function applyI18n() {
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('.lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === state.lang));
  updateNavActive();
}

/* ── Router ── */
function getPath() {
  const hash = window.location.hash.replace(/^#\/?/, '') || '';
  return '/' + hash;
}

function navigate(path) {
  window.location.hash = path.startsWith('/') ? path : '/' + path;
}

async function handleRoute() {
  const path  = getPath();
  state.route = path;
  const parts = path.split('/').filter(Boolean);
  const page  = parts[0] || '';

  const main = $('#main-content');
  main.classList.remove('fade-up');

  if (page === 'song' && parts[1]) {
    const fromEventId = parts[2] === 'from' ? parts[3] : null;
    await renderSongDetail(parts[1], fromEventId);
  } else if (page === 'events' && parts[1]) {
    await renderEventDetail(parts[1]);
  } else if (page === 'events') {
    await renderEvents();
  } else if (page === 'repertoire') {
    await renderRepertoire();
  } else if (page === 'about') {
    await renderAbout();
  } else if (page === 'contact') {
    renderContact();
  } else {
    await renderHome();
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  requestAnimationFrame(() => main.classList.add('fade-up'));
  updateNavActive();
}

function updateNavActive() {
  const parts = getPath().split('/').filter(Boolean);
  const page  = parts[0] || 'home';

  $$('.main-nav a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href')?.replace(/^#\/?/, '') || 'home';
    const current = href || 'home';
    a.classList.toggle('active', page === current || (!page && current === 'home'));
  });
}

/* ── Data Loaders ── */
async function loadSongsManifest() {
  if (state.songsManifest) return state.songsManifest;
  const res = await fetch('/api/songs');
  state.songsManifest = await res.json();
  return state.songsManifest;
}

async function loadSong(id) {
  if (state.loadedSongs[id]) return state.loadedSongs[id];
  const res = await fetch(`/api/songs/${id}/lyrics`);
  const data = await res.json();
  state.loadedSongs[id] = data;
  return data;
}

async function loadEvents() {
  if (state.eventsData) return state.eventsData;
  const res = await fetch('/api/events');
  state.eventsData = await res.json();
  return state.eventsData;
}

/* Parse flat line array into verse groups (empty objects = breaks) */
function parseVerses(lines) {
  const verses = [];
  let current  = [];
  for (const line of lines) {
    if (!line || Object.keys(line).length === 0) {
      if (current.length) { verses.push(current); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length) verses.push(current);
  return verses;
}

/* ── Pages ── */
async function renderHome() {
  let nextEvent = null;
  let photos = [];
  try {
    const today = new Date().toISOString().split('T')[0];
    const [events, photosData] = await Promise.all([
      loadEvents(),
      fetch('/api/photos').then(r => r.json()).catch(() => [])
    ]);
    nextEvent = events
      .filter(ev => ev.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
    photos = Array.isArray(photosData) ? photosData : [];
  } catch (_) {}

  const localeMap = { de: 'de-DE', tr: 'tr-TR', fr: 'fr-FR', en: 'en-GB', it: 'it-IT' };
  const locale    = localeMap[state.lang] || 'de-DE';

  const eventBox = nextEvent ? `
    <a href="#/events/${nextEvent.id}" class="hero-next-event">
      <span class="hero-next-date">${new Date(nextEvent.date).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      <span class="hero-next-name">${esc(nextEvent.name)}</span>
    </a>` : '';

  const photoItems = photos.map(p =>
    `<button class="photo-strip-item" data-photo-id="${esc(p.id)}"><img src="${p.data}" alt=""></button>`
  ).join('');

  const photoStrip = photos.length
    ? `<div class="photo-strip"><div class="photo-track">${photoItems}${photoItems}</div></div>`
    : '';

  $('#main-content').innerHTML = `
    <section class="hero page">
      <div class="hero-content">
        <p class="hero-label" data-i18n="home.label">${esc(t('home.label'))}</p>
        <h1 class="hero-title">Reisende</h1>
        <p class="hero-subtitle" data-i18n="home.subtitle">${esc(t('home.subtitle'))}</p>
        <div class="hero-actions">
          ${eventBox}
          <a href="#/repertoire" class="hero-cta" data-i18n="home.cta">${esc(t('home.cta'))}</a>
        </div>
      </div>
    </section>
    ${photoStrip}`;

  const photoItems_nav = photos.map(p => ({ src: p.data, alt: '' }));
  $$('.photo-strip-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = photos.findIndex(p => p.id === btn.dataset.photoId);
      if (idx !== -1) openLightbox(photos[idx].data, '', photoItems_nav, idx);
    });
  });
}

async function renderEvents() {
  let events = [];
  try { events = await loadEvents(); } catch (_) {}

  const localeMap = { de: 'de-DE', tr: 'tr-TR', fr: 'fr-FR', en: 'en-GB', it: 'it-IT' };
  const locale = localeMap[state.lang] || 'de-DE';

  const today = new Date().toISOString().split('T')[0];
  const upcoming = events.filter(ev => ev.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past     = events.filter(ev => ev.date <  today).sort((a, b) => b.date.localeCompare(a.date));
  const sorted   = [...upcoming, ...past];

  const items = sorted.length
    ? sorted.map(ev => {
        const d    = new Date(ev.date);
        const past = d < new Date();
        const day  = String(d.getDate()).padStart(2, '0');
        const mon  = d.toLocaleDateString(locale, { month: 'short' }).toUpperCase();
        const yr   = d.getFullYear();
        return `
          <div class="event-card" data-event-id="${esc(ev.id)}" role="button" tabindex="0" aria-label="${esc(ev.name)}">
            <div class="event-date">
              <div class="event-day">${day}</div>
              <div class="event-month-year">${mon} ${yr}</div>
            </div>
            <div class="event-info">
              <div class="event-name">${esc(ev.name)}</div>
              <div class="event-venue">${esc(ev.venue)} · ${esc(ev.city)}</div>
            </div>
            <div class="event-actions">
              <span class="badge ${past ? 'badge-past' : 'badge-upcoming'}">${esc(t(past ? 'events.past' : 'events.upcoming'))}</span>
              ${ev.poster ? `<button class="btn-see-poster" data-poster="${ev.poster}" data-name="${esc(ev.name)}">${esc(t('events.seePoster'))}</button>` : ''}
              <span class="event-arrow">→</span>
            </div>
          </div>`;
      }).join('')
    : `<p class="no-events" data-i18n="events.empty">${esc(t('events.empty'))}</p>`;

  $('#main-content').innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <h1 data-i18n="nav.events">${esc(t('nav.events'))}</h1>
          <p data-i18n="events.subtitle">${esc(t('events.subtitle'))}</p>
        </div>
        <div class="events-list">${items}</div>
      </div>
    </div>`;

  $$('[data-event-id]').forEach(el => {
    const go = () => navigate(`/events/${el.dataset.eventId}`);
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  $$('.btn-see-poster').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openLightbox(btn.dataset.poster, btn.dataset.name);
    });
  });
}

async function renderEventDetail(id) {
  let events = [], manifest = [];
  try { [events, manifest] = await Promise.all([loadEvents(), loadSongsManifest()]); } catch (_) {}

  const ev = events.find(e => e.id === id);
  if (!ev) {
    $('#main-content').innerHTML = `<div class="container" style="padding-top:4rem;text-align:center;opacity:.4;font-family:var(--font-heading);font-size:1.25rem;font-style:italic;">${esc(t('events.notFound'))}</div>`;
    return;
  }

  const localeMap = { de: 'de-DE', tr: 'tr-TR', fr: 'fr-FR', en: 'en-GB', it: 'it-IT' };
  const locale    = localeMap[state.lang] || 'de-DE';
  const d         = new Date(ev.date);
  const past      = d < new Date();
  const dateStr   = d.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });

  /* Build setlist using songs manifest for titles */
  const setlistHTML = (ev.setlist || []).map((songId, i) => {
    const meta = manifest.find(s => s.id === songId) || { id: songId, title: songId };
    return `
      <div class="setlist-item" data-song-id="${esc(meta.id)}" role="button" tabindex="0" aria-label="${esc(meta.title)}">
        <span class="setlist-number">${String(i + 1).padStart(2, '0')}</span>
        <div class="setlist-info">
          <span class="setlist-title">${esc(meta.title)}</span>
          ${meta.genre ? `<span class="setlist-genre">${esc(meta.genre)}</span>` : ''}
        </div>
        <span class="setlist-arrow">→</span>
      </div>`;
  }).join('');

  $('#main-content').innerHTML = `
    <div class="page event-detail">
      <div class="container">
        <a href="#/events" class="song-back">← <span data-i18n="events.backToEvents">${esc(t('events.backToEvents'))}</span></a>
        <div class="event-detail-header${ev.poster ? ' has-poster' : ''}">
          <div class="event-detail-text">
            <div class="event-detail-meta">
              <span class="badge ${past ? 'badge-past' : 'badge-upcoming'}">${esc(t(past ? 'events.past' : 'events.upcoming'))}</span>
              <span class="event-detail-date">${dateStr}</span>
            </div>
            <h1 class="event-detail-title">${esc(ev.name)}</h1>
            <p class="event-detail-venue">${esc(ev.venue)} · ${esc(ev.city)}</p>
          </div>
          ${ev.poster ? `<button class="btn-see-poster" id="btn-poster">${esc(t('events.seePoster'))}</button>` : ''}
        </div>

        <div class="setlist-section">
          <div class="setlist-header">
            <h2 class="setlist-heading" data-i18n="events.setlistTitle">${esc(t('events.setlistTitle'))}</h2>
            <p class="setlist-hint" data-i18n="events.setlistHint">${esc(t('events.setlistHint'))}</p>
          </div>
          <div class="setlist-list">${setlistHTML}</div>
        </div>
      </div>
    </div>`;

  $$('[data-song-id]').forEach(el => {
    const go = () => navigate(`/song/${el.dataset.songId}/from/${id}`);
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  const posterBtn = $('#btn-poster');
  if (posterBtn && ev.poster) {
    posterBtn.addEventListener('click', () => openLightbox(ev.poster, ev.name));
  }

  updateNavActive();
}

function openLightbox(src, alt, items = null, startIndex = 0) {
  const hasNav = items && items.length > 1;
  let idx = startIndex;

  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `
    <div class="lightbox-backdrop"></div>
    ${hasNav ? '<button class="lightbox-prev" aria-label="Önceki">&#8249;</button>' : ''}
    <div class="lightbox-inner">
      <button class="lightbox-close" aria-label="Kapat">×</button>
      <img src="${src}" alt="${esc(alt)}">
    </div>
    ${hasNav ? '<button class="lightbox-next" aria-label="Sonraki">&#8250;</button>' : ''}`;
  document.body.appendChild(lb);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => lb.classList.add('open'));

  const imgEl = lb.querySelector('img');

  function goTo(newIdx) {
    idx = ((newIdx % items.length) + items.length) % items.length;
    imgEl.src = items[idx].src;
    imgEl.alt = esc(items[idx].alt || '');
  }

  let onKey;
  const close = () => {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    lb.addEventListener('transitionend', () => lb.remove(), { once: true });
  };
  onKey = e => {
    if (e.key === 'Escape') close();
    if (hasNav && e.key === 'ArrowLeft')  goTo(idx - 1);
    if (hasNav && e.key === 'ArrowRight') goTo(idx + 1);
  };

  lb.querySelector('.lightbox-close').addEventListener('click', close);
  lb.querySelector('.lightbox-backdrop').addEventListener('click', close);
  if (hasNav) {
    lb.querySelector('.lightbox-prev').addEventListener('click', e => { e.stopPropagation(); goTo(idx - 1); });
    lb.querySelector('.lightbox-next').addEventListener('click', e => { e.stopPropagation(); goTo(idx + 1); });
  }
  document.addEventListener('keydown', onKey);
}

async function renderRepertoire() {
  let songs = [];
  try { songs = await loadSongsManifest(); } catch (_) {}

  const isList = state.songView === 'list';

  const songItems = isList
    ? `<div class="song-list">${songs.map((s, i) => `
        <div class="song-list-item" data-song-id="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(s.title)}">
          <span class="song-number">${String(i + 1).padStart(2, '0')}</span>
          <div class="song-list-info">
            <span class="song-title">${esc(s.title)}</span>
            ${s.genre ? `<span class="song-genre">${esc(s.genre)}</span>` : ''}
          </div>
          <span class="song-duration">${esc(s.duration || '')}</span>
        </div>`).join('')}</div>`
    : `<div class="song-grid">${songs.map((s, i) => `
        <div class="song-grid-item" data-song-id="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(s.title)}">
          <div class="song-grid-number">${String(i + 1).padStart(2, '0')}</div>
          <div class="song-grid-title">${esc(s.title)}</div>
          <div class="song-grid-meta">${esc(s.genre || '')}${s.duration ? ' · ' + esc(s.duration) : ''}</div>
        </div>`).join('')}</div>`;

  $('#main-content').innerHTML = `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <h1 data-i18n="nav.repertoire">${esc(t('nav.repertoire'))}</h1>
          <p data-i18n="repertoire.subtitle">${esc(t('repertoire.subtitle'))}</p>
        </div>
        <div class="repertoire-controls">
          <span class="repertoire-count">${songs.length} ${esc(t('repertoire.songs'))}</span>
          <div class="view-toggle" role="group" aria-label="View">
            <button class="view-btn${isList ? ' active' : ''}" id="btn-list" data-i18n-title="repertoire.listView" title="${esc(t('repertoire.listView'))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <circle cx="3" cy="6" r="0.5" fill="currentColor"/><circle cx="3" cy="12" r="0.5" fill="currentColor"/>
                <circle cx="3" cy="18" r="0.5" fill="currentColor"/>
              </svg>
              <span data-i18n="repertoire.listView">${esc(t('repertoire.listView'))}</span>
            </button>
            <button class="view-btn${!isList ? ' active' : ''}" id="btn-grid" data-i18n-title="repertoire.gridView" title="${esc(t('repertoire.gridView'))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span data-i18n="repertoire.gridView">${esc(t('repertoire.gridView'))}</span>
            </button>
          </div>
        </div>
        ${songItems}
      </div>
    </div>`;

  $('#btn-list')?.addEventListener('click', () => { state.songView = 'list'; renderRepertoire(); });
  $('#btn-grid')?.addEventListener('click', () => { state.songView = 'grid'; renderRepertoire(); });

  $$('[data-song-id]').forEach(el => {
    const go = () => navigate(`/song/${el.dataset.songId}`);
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

async function renderAbout() {
  let photos = [];
  try {
    photos = await fetch('/api/photos').then(r => r.json()).catch(() => []);
    if (!Array.isArray(photos)) photos = [];
  } catch (_) {}

  const photoGridHTML = photos.length ? `
    <div class="about-photo-grid">
      ${photos.map(p => `<button class="about-photo-item" data-photo-id="${esc(p.id)}"><img src="${p.data}" alt=""></button>`).join('')}
    </div>` : '';

  $('#main-content').innerHTML = `
    <div class="page about-page">
      <div class="container">
        <div class="page-header">
          <h1 data-i18n="nav.about">${esc(t('nav.about'))}</h1>
          <p data-i18n="about.tagline">${esc(t('about.tagline'))}</p>
        </div>
        <div class="about-grid">
          <div class="about-text">
            <p data-i18n="about.intro1">${esc(t('about.intro1'))}</p>
            <p data-i18n="about.intro2">${esc(t('about.intro2'))}</p>
            <p data-i18n="about.intro3">${esc(t('about.intro3'))}</p>
            <p data-i18n="about.intro4">${esc(t('about.intro4'))}</p>
            <p data-i18n="about.intro5">${esc(t('about.intro5'))}</p>
          </div>
          <div class="members-section">
            <div class="member-card">
              <div class="member-name">Uğur</div>
              <div class="member-role" data-i18n="about.member1Role">${esc(t('about.member1Role'))}</div>
            </div>
            <div class="member-card">
              <div class="member-name">Taha</div>
              <div class="member-role" data-i18n="about.member2Role">${esc(t('about.member2Role'))}</div>
            </div>
            <div class="member-card">
              <div class="member-name">Hilal</div>
              <div class="member-role" data-i18n="about.member3Role">${esc(t('about.member3Role'))}</div>
            </div>
          </div>
        </div>
        ${photoGridHTML}
        <div class="contact-section">
          <h2 data-i18n="about.contactTitle">${esc(t('about.contactTitle'))}</h2>
          <div class="contact-grid">
            <div class="contact-item">
              <span class="contact-label" data-i18n="about.bookingLabel">${esc(t('about.bookingLabel'))}</span>
              <span class="contact-value"><a href="mailto:tyasinturedi@gmail.com">tyasinturedi@gmail.com</a></span>
            </div>
            <div class="contact-item">
              <span class="contact-label" data-i18n="about.pressLabel">${esc(t('about.pressLabel'))}</span>
              <span class="contact-value"><a href="mailto:tyasinturedi@gmail.com">tyasinturedi@gmail.com</a></span>
            </div>
            <div class="contact-item">
              <span class="contact-label" data-i18n="about.instagramLabel">${esc(t('about.instagramLabel'))}</span>
              <span class="contact-value"><a href="https://instagram.com" target="_blank" rel="noopener noreferrer">@reisende.musik</a></span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  if (photos.length) {
    const navItems = photos.map(p => ({ src: p.data, alt: '' }));
    $$('.about-photo-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = photos.findIndex(p => p.id === btn.dataset.photoId);
        if (idx !== -1) openLightbox(photos[idx].data, '', navItems, idx);
      });
    });
  }
}

/* ── Contact ── */
function renderContact() {
  $('#main-content').innerHTML = `
    <div class="page contact-page">
      <div class="container">
        <div class="page-header">
          <h1 data-i18n="nav.contact">${esc(t('nav.contact'))}</h1>
          <p data-i18n="contact.intro">${esc(t('contact.intro'))}</p>
        </div>
        <div class="contact-page-grid">
          <div class="contact-page-info">
            <div class="contact-item">
              <span class="contact-label" data-i18n="about.bookingLabel">${esc(t('about.bookingLabel'))}</span>
              <span class="contact-value"><a href="mailto:tyasinturedi@gmail.com">tyasinturedi@gmail.com</a></span>
            </div>
          </div>
          <form class="contact-form" id="contact-form" novalidate>
            <div class="contact-field">
              <label for="cf-name" data-i18n="contact.name">${esc(t('contact.name'))}</label>
              <input id="cf-name" type="text" autocomplete="name" required>
            </div>
            <div class="contact-field">
              <label for="cf-email" data-i18n="contact.email">${esc(t('contact.email'))}</label>
              <input id="cf-email" type="email" autocomplete="email" required>
            </div>
            <div class="contact-field">
              <label for="cf-message" data-i18n="contact.message">${esc(t('contact.message'))}</label>
              <textarea id="cf-message" rows="5" required></textarea>
            </div>
            <div class="contact-form-footer">
              <span class="contact-form-status" id="cf-status"></span>
              <button type="submit" class="contact-send-btn" data-i18n="contact.send">${esc(t('contact.send'))}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  $('#contact-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name    = $('#cf-name').value.trim();
    const email   = $('#cf-email').value.trim();
    const message = $('#cf-message').value.trim();
    if (!name || !email || !message) return;

    const btn    = e.target.querySelector('button[type=submit]');
    const status = $('#cf-status');
    btn.disabled = true;

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message })
      });
      if (!res.ok) throw new Error();
      status.textContent = t('contact.success');
      status.className   = 'contact-form-status ok';
      e.target.reset();
    } catch {
      status.textContent = t('contact.error');
      status.className   = 'contact-form-status err';
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── Song Detail ── */
async function renderSongDetail(id, fromEventId = null) {
  let song = null;
  let manifest = [];
  try {
    [song, manifest] = await Promise.all([loadSong(id), loadSongsManifest()]);
  } catch (_) {}

  if (!song) {
    $('#main-content').innerHTML = `<div class="container" style="padding-top:4rem;text-align:center;opacity:.4;font-family:var(--font-heading);font-size:1.25rem;font-style:italic;">${esc(t('song.notFound'))}</div>`;
    return;
  }

  const meta = manifest.find(s => s.id === id) || {};

  /* Determine best translation language */
  if (state.transLang === state.lang && state.transLang === 'tr') state.transLang = 'de';
  if (!TRANS_LANGS.includes(state.transLang)) state.transLang = 'de';
  if (state.transLang === 'tr') {
    state.transLang = TRANS_LANGS.find(l => l !== 'tr') || 'de';
  }

  const isParallel = state.lyricsMode === 'parallel';

  $('#main-content').innerHTML = `
    <div class="page song-detail">
      <div class="container">
        <a href="${fromEventId ? `#/events/${fromEventId}` : '#/repertoire'}" class="song-back">← <span data-i18n="${fromEventId ? 'song.backToEvent' : 'song.back'}">${esc(t(fromEventId ? 'song.backToEvent' : 'song.back'))}</span></a>
        <div class="song-detail-header">
          <div>
            <h1 class="song-detail-title">${esc(meta.title || id)}</h1>
            <div class="song-detail-meta">
              ${meta.genre  ? `<span>${esc(meta.genre)}</span>`    : ''}
              ${meta.duration ? `<span>${esc(meta.duration)}</span>` : ''}
            </div>
          </div>
          <div class="lyrics-mode-switcher">
            <button class="mode-btn${isParallel ? ' active' : ''}" id="btn-parallel" data-i18n="song.modeParallel">${esc(t('song.modeParallel'))}</button>
            <button class="mode-btn${!isParallel ? ' active' : ''}" id="btn-interleaved" data-i18n="song.modeInterleaved">${esc(t('song.modeInterleaved'))}</button>
          </div>
        </div>
        <div id="lyrics-area">${buildLyricsHTML(song, state.lyricsMode, state.transLang)}</div>
      </div>
    </div>`;

  $('#btn-parallel')?.addEventListener('click', () => switchMode(song, 'parallel'));
  $('#btn-interleaved')?.addEventListener('click', () => switchMode(song, 'interleaved'));
  bindSelects(song);
}

function switchMode(song, mode) {
  state.lyricsMode = mode;
  const cur = getCurrentTransLang();
  $('#lyrics-area').innerHTML = buildLyricsHTML(song, mode, cur);
  $$('.mode-btn').forEach(b => b.classList.remove('active'));
  $(`#btn-${mode}`)?.classList.add('active');
  bindSelects(song);
}

function getCurrentTransLang() {
  return ($('#sel-parallel') || $('#sel-interleaved'))?.value || state.transLang;
}

function bindSelects(song) {
  const handler = e => {
    state.transLang = e.target.value;
    $('#lyrics-area').innerHTML = buildLyricsHTML(song, state.lyricsMode, state.transLang);
    bindSelects(song);
  };
  $('#sel-parallel')?.addEventListener('change', handler);
  $('#sel-interleaved')?.addEventListener('change', handler);
}

function langOptions(song, selected) {
  const sample = song[0] || {};
  return TRANS_LANGS
    .filter(l => l !== 'tr' && sample[l] !== undefined)
    .map(l => `<option value="${l}"${l === selected ? ' selected' : ''}>${TRANS_LANG_NAMES[l]}</option>`)
    .join('');
}

/* ── Lyrics Builders ── */
function buildLyricsHTML(lines, mode, transLang) {
  return mode === 'parallel'
    ? buildParallel(lines, transLang)
    : buildInterleaved(lines, transLang);
}

function buildParallel(lines, transLang) {
  const verses  = parseVerses(lines);
  const rtl     = RTL_LANGS.has(transLang) ? ' data-rtl="true"' : '';
  const opts    = langOptions(lines, transLang);

  const versesHTML = verses.map(verse => `
    <div class="verse-parallel"${rtl}>${verse.map(line => `
      <div class="line-pair">
        <div class="line-orig">${esc(line.tr)}</div>
        <div class="line-trans">${esc(line[transLang] || '')}</div>
      </div>`).join('')}
    </div>`).join('');

  return `
    <div class="lyrics-parallel-wrapper">
      <div class="lyrics-column-headers">
        <div>
          <div class="col-header-label">Türkçe</div>
        </div>
        <div>
          <div class="col-header-label" data-i18n="song.selectLang">${esc(t('song.selectLang'))}</div>
          <select class="lyrics-lang-select" id="sel-parallel">${opts}</select>
        </div>
      </div>
      <div class="lyrics-parallel-verses">${versesHTML}</div>
    </div>`;
}

function buildInterleaved(lines, transLang) {
  const verses = parseVerses(lines);
  const rtl    = RTL_LANGS.has(transLang) ? ' data-rtl="true"' : '';
  const opts   = langOptions(lines, transLang);

  const versesHTML = verses.map(verse => `
    <div class="verse-interleaved"${rtl}>${verse.map(line => `
      <div class="line-group">
        <div class="line-orig">${esc(line.tr)}</div>
        <div class="line-trans">${esc(line[transLang] || '')}</div>
      </div>`).join('')}
    </div>`).join('');

  return `
    <div class="lyrics-interleaved-wrapper">
      <div class="interleaved-header">
        <span class="interleaved-lang-label" data-i18n="song.selectLang">${esc(t('song.selectLang'))}</span>
        <div class="interleaved-select-wrap">
          <select class="lyrics-lang-select" id="sel-interleaved">${opts}</select>
        </div>
      </div>
      <div class="lyrics-verses-interleaved">${versesHTML}</div>
    </div>`;
}

/* ── Init ── */
function initHeader() {
  $$('.lang-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      if (lang === state.lang) return;
      await loadLanguage(lang);
      applyI18n();
      handleRoute();
    });
  });
}

async function init() {
  const saved = localStorage.getItem('reisende-lang') || 'de';
  await loadLanguage(saved);
  initHeader();
  window.addEventListener('hashchange', handleRoute);
  applyI18n();
  await handleRoute();
}

document.addEventListener('DOMContentLoaded', init);
