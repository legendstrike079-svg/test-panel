/* ==========================================================================
   Zenith Panel - frontend core
   Vanilla ES modules-free JS: API client, layout renderer, UI kit, WS client.
   No external assets (works offline / behind firewalls).
   ========================================================================== */

const API_BASE = '/api';
const store = {
  get token() { return localStorage.getItem('zenith_token') || ''; },
  set token(v) { v ? localStorage.setItem('zenith_token', v) : localStorage.removeItem('zenith_token'); },
  user: null,
  settings: {},
  servers: [],
};

/* ============================== appearance ============================== */
// Brand settings are deliberately token-based: changing a theme never needs a
// stylesheet rebuild and every panel page, including the unauthenticated login,
// receives the same accessible colour system.
const APPEARANCE_THEMES = {
  midnight: { bg: '#10141d', elevated: '#131722', card: '#181d29', hover: '#1d2432', line: '#262d3d', strong: '#354158', fg: '#f4f7fb', muted: '#a8b3c7', faint: '#6f7b91' },
  obsidian: { bg: '#0b0f16', elevated: '#10151f', card: '#151c28', hover: '#1a2331', line: '#253044', strong: '#37465d', fg: '#f5f7fb', muted: '#aab6c8', faint: '#728097' },
  graphite: { bg: '#16181d', elevated: '#1b1e25', card: '#21252e', hover: '#292e39', line: '#343a48', strong: '#475166', fg: '#f8fafc', muted: '#b1b9c7', faint: '#778093' },
  ocean: { bg: '#0d1726', elevated: '#101d30', card: '#15243a', hover: '#1b2c45', line: '#2a3d59', strong: '#40597b', fg: '#edf6ff', muted: '#a8bdd6', faint: '#7189a7' },
};
const HEX_RE = /^#[0-9a-f]{6}$/i;
const PANEL_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
// Shipped branding is the safe fallback. Settings only persist a custom image
// override, so Reset can always return to this bundled panel default.
const DEFAULT_PANEL_LOGO = 'assets/zenith-panel-logo.webp';
const panelLogoSource = (value) => PANEL_IMAGE_RE.test(String(value || '')) ? String(value) : DEFAULT_PANEL_LOGO;
window.panelLogoSource = panelLogoSource;
const appearanceOpacity = (value, fallback = 28) => {
  const opacity = Number(value);
  return Number.isFinite(opacity) ? Math.min(100, Math.max(0, Math.round(opacity))) : fallback;
};
const hexRgb = (hex, alpha) => {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return `rgba(59,130,246,${alpha})`;
  const value = parseInt(raw, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
};
function applyAppearance(settings = {}) {
  const key = APPEARANCE_THEMES[settings.theme] ? settings.theme : 'midnight';
  const t = APPEARANCE_THEMES[key];
  const root = document.documentElement;
  root.dataset.theme = key;
  root.style.setProperty('--bg', t.bg);
  root.style.setProperty('--bg-elevated', t.elevated);
  root.style.setProperty('--card', t.card);
  root.style.setProperty('--card-hover', t.hover);
  root.style.setProperty('--line', t.line);
  root.style.setProperty('--line-strong', t.strong);
  root.style.setProperty('--fg', t.fg);
  root.style.setProperty('--fg-dim', t.muted);
  root.style.setProperty('--fg-faint', t.faint);
  const accent = HEX_RE.test(String(settings.accentColor || '')) ? settings.accentColor : '#3b82f6';
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--blue', accent);
  root.style.setProperty('--blue-dim', hexRgb(accent, .15));
  // Keep legacy CSS tokens for previews, then mount the actual backdrop layer
  // below so every route—including login/register and server pages—shares it.
  const background = PANEL_IMAGE_RE.test(String(settings.panelBackground || '')) ? String(settings.panelBackground) : '';
  const backgroundOpacity = appearanceOpacity(settings.panelBackgroundOpacity, 28) / 100;
  root.style.setProperty('--panel-bg-image', background ? `url("${background}")` : 'none');
  root.style.setProperty('--panel-bg-opacity', String(backgroundOpacity));

  // A real fixed element is more reliable than a negative-z-index body pseudo
  // element. In particular, embedded browsers and server/detail layouts used
  // different stacking contexts, causing the saved backdrop to disappear on
  // some pages. This one layer is mounted for every route using app.js.
  let layer = document.getElementById('panel-global-backdrop');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'panel-global-backdrop';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  layer.style.backgroundImage = background ? `url("${background}")` : 'none';
  layer.style.opacity = String(backgroundOpacity);
  layer.hidden = !background;
  root.dataset.panelBackground = background ? 'true' : 'false';
}
window.applyAppearance = applyAppearance;
window.APPEARANCE_THEMES = APPEARANCE_THEMES;

/* ================================ api ================================ */
const API = {
  async request(path, { method = 'GET', body, raw, headers = {} } = {}) {
    const opts = { method, headers: { ...headers } };
    if (store.token) opts.headers.Authorization = `Bearer ${store.token}`;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (res.status === 401 && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
      store.token = '';
      location.href = 'index.html?expired=1';
      throw new Error('Session expired');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return raw ? res : data;
  },
  get(p, h) { return API.request(p, { headers: h }); },
  post(p, body) { return API.request(p, { method: 'POST', body }); },
  patch(p, body) { return API.request(p, { method: 'PATCH', body }); },
  put(p, body) { return API.request(p, { method: 'PUT', body }); },
  del(p) { return API.request(p, { method: 'DELETE' }); },
};

/* ================================ icons ================================ */
const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/></svg>',
  servers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7l4 4-4 4M12 17h7"/><rect x="3" y="3" width="18" height="18" rx="2.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7.5A2.5 2.5 0 015.5 5h3l2 2.5h7A2.5 2.5 0 0120 10v6.5A2.5 2.5 0 0117.5 19h-12A2.5 2.5 0 013 16.5z"/></svg>',
  puzzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 4a2 2 0 114 0v1h3a1 1 0 011 1v3h1a2 2 0 110 4h-1v3a1 1 0 01-1 1h-3v-1a2 2 0 10-4 0v1H7a1 1 0 01-1-1v-3H5a2 2 0 110-4h1V6a1 1 0 011-1h3z"/></svg>',
  backup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5"/><path d="M12 8v4l2.5 2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2 2 2 0 11-4 0 1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004 15a2 2 0 110-4 1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0011 4.1a2 2 0 114 0 1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0020 11a2 2 0 110 4z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M17 11a3 3 0 100-6M21 19c0-2.4-1.6-4.2-4-4.8"/></svg>',
  node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="6" rx="1.6"/><rect x="4" y="14" width="16" height="6" rx="1.6"/><path d="M8 7h.01M8 17h.01"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l7-7 2 2-2 2 2 2-3 3-2-2-2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 11-2.6-5.9M20 4v5h-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 16V5m0 0l-4 4m4-4l4 4M4 19h16"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v11m0 0l4-4m-4 4l-4-4M4 20h16"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11a8 8 0 10-1.6 6M20 6v5h-5"/></svg>',
  chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7V5M12 7V5M17 7V5M7 20v-3M12 20v-3M17 20v-3"/></svg>',
  disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  users2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M17 11a3 3 0 100-6M21 19c0-2.4-1.6-4.2-4-4.8"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 3h11l3 3v15H5z"/><path d="M9 3v6h6V3M9 21v-6h6v6"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V4M4 20h16"/><path d="M8 17v-6M12 17V7M16 17v-4M20 17V9"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 20s-7-4.3-7-9.2A4.2 4.2 0 0112 8a4.2 4.2 0 017 2.8C19 15.7 12 20 12 20z"/></svg>',
  food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 8c-3 0-5 2-5 5.5S9.5 21 12 21s5-4 5-7.5S15 8 12 8z"/><path d="M12 8V5"/><path d="M12 5c1.6 0 2.6-1 3-2-1.7-.3-2.8.4-3 2z"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 13h18M12 8v13"/><path d="M12 8S10.5 4 8.5 4a2 2 0 000 4zM12 8s1.5-4 3.5-4a2 2 0 010 4z"/></svg>',
  gamepad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4M16 11h.01M18.5 13h.01"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h10a3 3 0 10-3-3M3 12h14a3 3 0 11-3 3M3 16h7"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 21V4a1 1 0 011-1h9a1 1 0 011 1v17M4 21h16"/><path d="M13 12h.01"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  skull: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3a7 7 0 00-7 7v3l-1 3 3 .5V19h10v-2.5l3-.5-1-3v-3a7 7 0 00-7-7z"/><path d="M9 11h.01M15 11h.01M12 15v2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 21s6-5.7 6-10.4A6 6 0 006 10.6C6 15.3 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  ports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 3v6M12 3v6M17 3v6"/><path d="M5 9h14v3a7 7 0 01-7 7 7 7 0 01-7-7z"/><path d="M12 19v3"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.3 5.6A16 16 0 0015 4.3l-.3.6a12 12 0 00-5.4 0L9 4.3a16 16 0 00-4.3 1.3C2.2 9.4 1.6 13 1.9 16.5a16 16 0 004.9 2.4l1-1.6a10 10 0 01-1.6-.8l.4-.3a11 11 0 009.6 0l.4.3a10 10 0 01-1.6.8l1 1.6a16 16 0 004.9-2.4c.4-4-.6-7.6-2.6-10.9zM8.9 14.4c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm6.2 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 8l-4 4 4 4M6 12h9"/></svg>',
  docker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h13a2 2 0 002-2V8H5a2 2 0 00-2 2z"/><path d="M7 8V5h3v3M11 8V5h3v3"/><path d="M3 12v3a5 5 0 005 5h6a6 6 0 006-6v-1"/></svg>',
  container: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
  health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 3 10 2-5h7"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18 10a2.8 2.8 0 00-4-4L4 16z"/><path d="M13.5 6.5 17.5 10.5"/></svg>',
  wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 16 8M14 6l4 4"/><path d="M18 3v3M21.5 5.5h-3M19 12v2.5M20.5 13h-3M6 4v2.5M7.5 5.2h-3"/></svg>',
};

/* ================================ helpers ================================ */
const fmt = {
  bytes(bytes, digits = 1) {
    bytes = Number(bytes) || 0;
    if (bytes <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${u[i]}`;
  },
  duration(ms) {
    ms = Number(ms) || 0;
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
  },
  timeAgo(iso) {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 2592000000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(iso).toLocaleDateString();
  },
  date(iso) { return iso ? new Date(iso).toLocaleString() : '-'; },
  num(n) { return (Number(n) || 0).toLocaleString(); },
};
window.fmt = fmt;

/** Route external images (Modrinth icons, Minecraft avatars) through the panel. */
function iconSrc(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname;
    if (['cdn.modrinth.com', 'minotar.net', 'mc-heads.net', 'api.mineatar.io'].some((h) => host === h || host.endsWith(`.${h}`))) {
      const t = encodeURIComponent(store.token || '');
      return `/api/system/proxy/image?url=${encodeURIComponent(url)}${t ? `&token=${t}` : ''}`;
    }
  } catch (_) {}
  return url;
}
window.iconSrc = iconSrc;

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
window.esc = esc;

const STATUS_META = {
  running: { label: 'Running', cls: 'green', dot: 'green' },
  starting: { label: 'Starting', cls: 'yellow', dot: 'yellow' },
  stopping: { label: 'Stopping', cls: 'yellow', dot: 'yellow' },
  installing: { label: 'Installing', cls: 'blue', dot: 'blue' },
  offline: { label: 'Offline', cls: '', dot: '' },
  crashed: { label: 'Crashed', cls: 'red', dot: 'red' },
  suspended: { label: 'Suspended', cls: 'red', dot: 'red' },
};
function statusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.offline;
  return `<span class="badge ${meta.cls}"><i class="dot ${meta.dot}"></i>${meta.label}</span>`;
}
window.statusBadge = statusBadge;


/* ============================ players + skins ============================ */
/**
 * Minecraft avatar, proxied through the panel so it loads even when the browser
 * cannot reach the skin host directly. mc-heads renders the real 3D head; if the
 * player has no skin (or the proxy is offline) we fall back to their initial.
 */
function playerHead(name, { size = 40, body = false, online = false, title = '' } = {}) {
  const safe = String(name || '?').replace(/[^A-Za-z0-9_]/g, '') || 'steve';
  const px = Math.max(16, Math.min(96, Number(size) || 40));
  const src = iconSrc(`https://mc-heads.net/${body ? 'body' : 'head'}/${safe}/${px * 2}`);
  const initial = esc(String(name || '?').slice(0, 1).toUpperCase());
  return `<span class="phead ${online ? 'online' : ''}" style="width:${px}px;height:${px}px" title="${esc(title || name || '')}">
      <img src="${src}" alt="${esc(name || '')}" loading="lazy" onerror="this.parentElement.classList.add('fallback')">
      <i class="ph-fallback">${initial}</i>
    </span>`;
}
window.playerHead = playerHead;

/** Icon per player action id (falls back to a checkmark). */
const ACTION_ICONS = {
  op: 'shield', deop: 'shield', heal: 'heart', feed: 'food', give: 'gift', gamemode: 'gamepad',
  xp: 'star', fly: 'wind', clear: 'trash', kick: 'door', ban: 'ban', unban: 'check',
  whitelistAdd: 'plus', whitelistRemove: 'minus', tp: 'pin', kill: 'skull', playtime: 'clock',
};
const ARG_HINTS = {
  item: { placeholder: 'minecraft:diamond', label: 'Item id' },
  count: { placeholder: '1', label: 'Amount', type: 'number' },
  mode: { label: 'Gamemode', options: ['survival', 'creative', 'adventure', 'spectator'] },
  levels: { placeholder: '30', label: 'Levels', type: 'number' },
  reason: { placeholder: 'Reason shown to the player', label: 'Reason' },
};

const Players = {
  icon(id) { return ICONS[ACTION_ICONS[id]] || ICONS.check; },

  /** GET /servers/:id/players -> { players, count, max, status, actions } */
  fetch(serverId) { return API.get(`/servers/${serverId}/players`); },

  /** Fire an action, toast the result. */
  async run(serverId, name, action, args = {}) {
    try {
      const res = await API.post(`/servers/${serverId}/players/${encodeURIComponent(name)}/action`, { action, ...args });
      UI.toast(res.message || `${action} sent`, 'success', name);
      return res;
    } catch (err) {
      UI.toast(err.message, 'error', name);
      throw err;
    }
  },

  /**
   * Render the online list (with one-click actions) into a container.
   * @param {HTMLElement} el target element
   * @param {object} opts { serverId, players, max, status, actions, onDone }
   */
  mount(el, { serverId, players = [], max = 20, status = '', actions = [], emptyText = 'Nobody is online right now' } = {}) {
    if (!el) return;
    if (status && status !== 'running') {
      el.innerHTML = UI.empty(`${status === 'starting' ? 'The server is still starting' : 'The server is offline'}`, 'Player actions need a running server.');
      return;
    }
    if (!players.length) {
      el.innerHTML = `${UI.empty(emptyText, 'Names appear here as soon as they join, or press Refresh to ask the server.')}
        <div class="mt"><button class="btn sm" data-prefresh>${ICONS.refresh} Ask server for the player list</button>
        <button class="btn sm" data-poffline>${ICONS.users2} Act on a player by name</button></div>`;
    } else {
      el.innerHTML = `<div class="plist">
        ${players.map((p) => `
          <div class="player-row" data-player="${esc(p.name)}">
            ${playerHead(p.name, { size: 40, online: true })}
            <div class="grow" style="min-width:80px">
              <b>${esc(p.name)}</b>
              <div class="tiny dim">${p.joinedAt ? `online ${fmt.duration(Date.now() - p.joinedAt)}` : 'online'}</div>
            </div>
            <div class="row wrap" style="gap:6px">
              <button class="btn sm green" data-pact="heal" title="Full health">${ICONS.heart}<span class="pact-label">Full health</span></button>
              <button class="btn sm" data-pact="feed" title="Full hunger">${ICONS.food}<span class="pact-label">Full hunger</span></button>
              <button class="btn sm" data-pact="op" title="Make operator">${ICONS.shield}<span class="pact-label">Op</span></button>
              <button class="btn sm icon" data-pmore title="All actions">${ICONS.menu}</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="row wrap mt between">
        <span class="tiny dim">${players.length} / ${max} online</span>
        <div class="row wrap" style="gap:6px">
          <button class="btn sm" data-prefresh>${ICONS.refresh} Refresh</button>
          <button class="btn sm" data-poffline>${ICONS.users2} Act on a player by name</button>
        </div>
      </div>`;
    }

    el.querySelectorAll('[data-pact]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try { await Players.run(serverId, b.closest('[data-player]').dataset.player, b.dataset.pact); } finally { b.disabled = false; }
      };
    });
    el.querySelectorAll('[data-pmore]').forEach((b) => {
      b.onclick = () => Players.openActions(serverId, b.closest('[data-player]').dataset.player, actions);
    });
    el.querySelectorAll('[data-prefresh]').forEach((b) => {
      b.onclick = async () => {
        try { await API.post(`/servers/${serverId}/players/refresh`); UI.toast('Asked the server for its player list', 'info'); }
        catch (err) { UI.toast(err.message, 'error'); }
      };
    });
    el.querySelectorAll('[data-poffline]').forEach((b) => {
      b.onclick = () => Players.openActions(serverId, '', actions);
    });
  },

  /** Full action sheet for one player (empty name = ask for the name first). */
  openActions(serverId, playerName, actions = []) {
    if (!actions.length) { UI.toast('The action list is still loading', 'warn'); return; }
    const quick = actions.filter((a) => !a.args.length && !a.info);
    const info = actions.filter((a) => a.info);
    const withArgs = actions.filter((a) => a.args.length);
    const nameField = playerName ? '' : `<label class="field">Player name<input id="actName" placeholder="Notch" autocomplete="off"></label>`;
    const argCard = (a) => `
      <div class="card inset" style="padding:12px">
        <div class="row between"><b>${esc(a.label)}</b><span class="tiny dim">${a.args.join(', ')}</span></div>
        <div class="row wrap mt" style="gap:6px">
          ${a.args.map((argName) => {
            const hint = ARG_HINTS[argName] || { label: argName, placeholder: argName };
            if (hint.options) {
              return `<select data-arg="${argName}" style="max-width:150px">${hint.options.map((o) => `<option>${o}</option>`).join('')}</select>`;
            }
            return `<input data-arg="${argName}" type="${hint.type || 'text'}" placeholder="${esc(hint.placeholder || '')}" title="${esc(hint.label)}" style="max-width:190px">`;
          }).join('')}
          <button class="btn sm primary" data-run="${a.id}">Run</button>
        </div>
      </div>`;

    const modal = UI.modal({
      title: playerName ? `Actions - ${playerName}` : 'Run an action on a player',
      wide: true,
      body: `
        <div class="row" style="gap:12px;align-items:center">
          ${playerName ? playerHead(playerName, { size: 48 }) : playerHead('steve', { size: 48 })}
          <div class="grow">
            ${playerName ? `<b style="font-size:16px">${esc(playerName)}</b><div class="tiny dim">pick an action below</div>`
              : `<div class="tiny dim">Works for online players and for offline ones where Minecraft allows it (op, whitelist, pardon).</div>`}
          </div>
        </div>
        ${nameField}
        <div class="divider"></div>
        <div class="row wrap" style="gap:7px">
          ${quick.map((a) => `<button class="btn sm ${a.danger ? 'red' : ''}" data-run="${a.id}">${Players.icon(a.id)}${esc(a.label)}</button>`).join('')}
          ${info.map((a) => `<button class="btn sm" data-run="${a.id}">${Players.icon(a.id)}${esc(a.label)}</button>`).join('')}
        </div>
        <div class="divider"></div>
        <div class="grid cols-2" style="gap:10px">${withArgs.map(argCard).join('')}</div>
        <div class="tiny dim mt">Every action is validated in the panel and sent to the server console - the same thing as typing the command yourself.</div>`,
      onMount(root, { close }) {
        const ask = () => {
          const input = root.querySelector('#actName');
          if (!input) return playerName;
          const value = input.value.trim();
          if (!value) { UI.toast('Type a player name first', 'warn'); input.focus(); return null; }
          return value;
        };
        root.querySelectorAll('[data-run]').forEach((btn) => {
          btn.onclick = async () => {
            const who = ask();
            if (!who) return;
            const card = btn.closest('.card');
            const args = {};
            if (card) card.querySelectorAll('[data-arg]').forEach((f) => { args[f.dataset.arg] = f.value; });
            btn.disabled = true;
            try { await Players.run(serverId, who, btn.dataset.run, args); close(); }
            catch (_) { btn.disabled = false; }
          };
        });
      },
    });
    const nameInput = modal.element.querySelector('#actName');
    if (nameInput) nameInput.focus();
  },
};
window.Players = Players;

/* ============================= static charts ============================= */
/**
 * Dependency-free SVG charts: they always render (no CDN, no canvas) which also
 * means they work inside sandboxed previews.
 */
const Chart = {
  _vals(series, key) { return (series || []).map((s) => Number(s[key]) || 0); },

  _path(vals, width, height, min, max, pad = 3) {
    const span = Math.max(1e-6, max - min);
    const step = vals.length > 1 ? width / (vals.length - 1) : width;
    return vals.map((v, i) => {
      const x = i * step;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  },

  /** Big area chart with grid + axis labels. */
  area(series, { key = 'cpu', color = 'var(--green)', height = 170, unit = '%', max = null, min = 0, label = '' } = {}) {
    const vals = Chart._vals(series, key);
    const w = 600;
    if (!vals.length) return `<div class="chart-empty">${UI.empty('Collecting data…', 'Graphs fill in as the panel samples the host every 5 seconds.')}</div>`;
    const top = max != null ? max : Math.max(10, Math.ceil(Math.max(...vals) * 1.15));
    const line = Chart._path(vals, w, height, min, top);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="0" x2="${w}" y1="${(height - f * height).toFixed(1)}" y2="${(height - f * height).toFixed(1)}"/>`).join('');
    const last = vals[vals.length - 1];
    const lastX = (vals.length > 1 ? w : w);
    const lastY = height - 3 - ((last - min) / Math.max(1e-6, top - min)) * (height - 6);
    const first = series[0];
    return `<div class="chart-box" style="height:${height}px">
      <div class="chart-axis">${[top, top / 2, min].map((v) => `<span>${Math.round(v)}${unit}</span>`).join('')}</div>
      <svg class="chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label || key)} graph">
        <g class="chart-grid">${grid}</g>
        <path class="chart-fill" d="${line} L${w} ${height} L0 ${height} Z" style="fill:${color}"/>
        <path class="chart-line" d="${line}" style="stroke:${color}"/>
        <circle class="chart-dot" cx="${lastX}" cy="${lastY.toFixed(1)}" r="3.5" style="fill:${color}"/>
      </svg>
      <div class="chart-mini"><span>${first && first.at ? new Date(first.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span><span>now</span></div>
    </div>
    <div class="row between mt"><span class="tiny dim">${esc(label)}</span><span class="tiny mono">${last.toFixed(1)}${unit}</span></div>`;
  },

  /** Tiny inline line used in tables. */
  spark(series, { key = 'cpu', color = 'var(--green)', width = 120, height = 30, max = null, min = 0 } = {}) {
    const vals = Chart._vals(series, key);
    if (!vals.length) return '<span class="tiny dim">-</span>';
    const top = max != null ? max : Math.max(1, Math.max(...vals));
    const line = Chart._path(vals, width, height, min, top, 2);
    return `<svg class="chart spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path class="chart-fill" d="${line} L${width} ${height} L0 ${height} Z" style="fill:${color}"/>
      <path class="chart-line" d="${line}" style="stroke:${color}"/></svg>`;
  },

  /** Donut for status/usage splits. */
  donut(items, { size = 150, thickness = 16, center = '', sub = '' } = {}) {
    const list = (items || []).filter((i) => Number(i.value) > 0);
    const total = list.reduce((n, i) => n + Number(i.value), 0);
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = (total ? list : []).map((i) => {
      const frac = Number(i.value) / total;
      const dash = `${(frac * c).toFixed(2)} ${(c - frac * c).toFixed(2)}`;
      const el = `<circle class="donut-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${i.color || 'var(--green)'}"
        stroke-width="${thickness}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset * c).toFixed(2)}"/>`;
      offset += frac;
      return el;
    }).join('');
    return `<div class="donut-wrap" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" class="donut">
        <circle class="donut-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${thickness}"/>
        ${arcs}
      </svg>
      <div class="donut-center"><b>${esc(center)}</b><span>${esc(sub)}</span></div>
    </div>`;
  },

  legend(items) {
    return `<div class="legend">${(items || []).map((i) => `
      <div class="legend-row"><i style="background:${i.color}"></i><span class="grow">${esc(i.label)}</span><b>${esc(i.text != null ? i.text : i.value)}</b></div>`).join('')}</div>`;
  },
};
window.Chart = Chart;

/* ================================ UI kit ================================ */
const UI = {
  toast(message, type = 'info', title = '') {
    let wrap = document.querySelector('.toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toasts'; document.body.appendChild(wrap); }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? ICONS.check : type === 'error' ? ICONS.warn : ICONS.info;
    el.innerHTML = `<span style="width:16px;height:16px;color:${type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : 'var(--blue)'}">${icon}</span>
      <div class="grow">${title ? `<b>${esc(title)}</b>` : ''}${esc(message)}</div>
      <span class="close">${ICONS.close}</span>`;
    el.querySelector('.close').onclick = () => el.remove();
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all .25s'; setTimeout(() => el.remove(), 260); }, type === 'error' ? 7000 : 4200);
  },
  modal({ title, body, footer = '', wide = false, narrow = false, onMount }) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay open';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="btn ghost icon close">${ICONS.close}</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 140); };
    overlay.querySelectorAll('.close, [data-close]').forEach((b) => (b.onclick = close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    if (onMount) onMount(overlay.querySelector('.modal'), { close });
    return { element: overlay, close };
  },
  confirm(message, { title = 'Are you sure?', confirmText = 'Confirm', danger = true } = {}) {
    return new Promise((resolve) => {
      const m = UI.modal({
        title, narrow: true,
        body: `<p class="muted" style="margin:0">${esc(message)}</p>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'red' : 'primary'}" data-ok>${esc(confirmText)}</button>`,
        onMount(root, { close }) {
          root.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
          root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
        },
      });
      m.element.addEventListener('click', (e) => { if (e.target === m.element) resolve(false); });
    });
  },
  async guard(fn, { loading = 'Working...' } = {}) {
    try { return await fn(); }
    catch (err) { UI.toast(err.message || String(err), 'error'); throw err; }
  },
  spinner(size = 15) { return `<span class="spinner" style="width:${size}px;height:${size}px"></span>`; },
  skeleton(rows = 3) { return `<div class="col">${Array.from({ length: rows }, () => '<div class="skeleton" style="height:16px"></div>').join('')}</div>`; },
  empty(text, sub = '') {
    return `<div class="empty">${ICONS.info}<div><div style="color:var(--fg-dim)">${esc(text)}</div>${sub ? `<div class="tiny dim mt">${esc(sub)}</div>` : ''}</div></div>`;
  },
  copyBtn(text, label = 'Copy') {
    return `<button class="btn sm" data-copy="${esc(text)}">${ICONS.folder && ''}${label}</button>`;
  },
};
window.UI = UI;
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy).then(() => UI.toast('Copied to clipboard', 'success'));
});

/* ================================ layout ================================ */
const Layout = {
  nav() {
    const isAdmin = ['admin', 'owner'].includes(store.user?.role);
    return [
      { section: 'Panel' },
      { href: 'dashboard.html', label: 'Dashboard', icon: ICONS.dashboard },
      { href: 'analytics.html', label: 'Analytics', icon: ICONS.analytics },
      { href: 'servers.html', label: 'Servers', icon: ICONS.servers, pill: 'servers' },
      ...(isAdmin ? [{ href: 'servers.html#create', label: 'Create Server', icon: ICONS.plus }] : []),
      { section: 'Hosting' },
      { href: 'nodes.html', label: 'Nodes', icon: ICONS.node },
      { href: 'allocations.html', label: 'Allocations', icon: ICONS.ports },
      { section: 'Account' },
      { href: 'account.html', label: 'Account', icon: ICONS.users2 },
      ...(isAdmin ? [
        { section: 'Administration' },
        { href: 'admin.html#servers', label: 'Admin Servers', icon: ICONS.servers },
        { href: 'apikeys.html', label: 'API Keys', icon: ICONS.key },
        { href: 'admin.html', label: 'Admin Settings', icon: ICONS.gear },
      ] : []),
    ];
  },
  render(active) {
    const user = store.user || {};
    const initial = (user.username || '?').slice(0, 1).toUpperCase();
    const nav = Layout.nav().map((item) => {
      if (item.section) return `<div class="nav-section">${item.section}</div>`;
      const on = item.href === active ? 'active' : '';
      const pill = item.pill ? `<span class="pill" data-pill="${item.pill}"></span>` : '';
      return `<a href="${item.href}" class="${on}">${item.icon}<span>${item.label}</span>${pill}</a>`;
    }).join('');

    const sidebar = document.querySelector('.sidebar');
    sidebar.innerHTML = `
      <div class="brand">
        <div class="brand-mark"><img src="${esc(panelLogoSource(store.settings.panelLogo))}" alt="${esc(store.settings.panelName || 'Zenith Panel')} logo"></div>
        <div class="brand-text"><b>${esc(store.settings.panelName || 'Zenith Panel')}</b><span>Server Control</span></div>
      </div>
      <nav class="nav" aria-label="Global navigation">${nav}</nav>
      <div class="nav-foot">
        <a class="user-chip" href="account.html">
          <div class="avatar user-avatar">${user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : initial}</div>
          <div class="meta grow"><b>${esc(user.username || '')}</b><span>${esc(user.role || '')}</span></div>
          <span style="width:15px;color:var(--fg-faint)">${ICONS.logout}</span>
        </a>
      </div>`;

    // One scrim controls both the global rail and the contextual server drawer.
    // It is intentionally owned by the layout so every page gets the same mobile behavior.
    const shell = sidebar.closest('.shell');
    if (shell && !shell.querySelector('.nav-scrim')) {
      const scrim = document.createElement('button');
      scrim.className = 'nav-scrim';
      scrim.type = 'button';
      scrim.tabIndex = -1;
      scrim.setAttribute('aria-label', 'Close navigation');
      scrim.onclick = () => this.closeMobileNav();
      shell.insertBefore(scrim, shell.querySelector('.main'));
    }
    sidebar.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => this.closeMobileNav()));

    const topbar = document.querySelector('.topbar');
    if (topbar && !topbar.dataset.ready) {
      topbar.dataset.ready = '1';
      topbar.innerHTML = `
        <div class="grow"><h1 id="pageTitle"></h1><div class="crumb" id="pageCrumb"></div></div>
        <div class="page-actions" id="pageActions"></div>
        <div class="row" style="gap:8px">
          <span id="searchHost"></span>
          <span id="notifHost"></span>
          <span class="badge" id="clockBadge" title="Panel time">--:--</span>
          <button class="btn ghost topbar-exit" id="logoutBtn" title="Exit panel and sign out">${ICONS.logout}<span>Exit</span></button>
        </div>`;
      topbar.querySelector('#logoutBtn').onclick = () => {
        UI.confirm('Sign out of the panel?', { confirmText: 'Sign out', danger: false }).then((yes) => {
          if (!yes) return;
          store.token = '';
          location.href = 'index.html';
        });
      };
      const clock = () => {
        const el = document.getElementById('clockBadge');
        if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      clock();
      setInterval(clock, 20000);
    }
  },
  title(title, crumb = '') {
    const t = document.getElementById('pageTitle');
    const c = document.getElementById('pageCrumb');
    if (t) t.textContent = title;
    if (c) c.textContent = crumb;
  },
  actions(html) {
    const el = document.getElementById('pageActions');
    if (el) el.innerHTML = html;
  },
  setServerCount(n) {
    const pill = document.querySelector('[data-pill="servers"]');
    if (pill) pill.textContent = n;
  },
  toggleMobileNav(force) {
    const shell = document.querySelector('.shell');
    if (!shell) return;
    const open = typeof force === 'boolean' ? force : !shell.classList.contains('mobile-nav-open');
    shell.classList.toggle('mobile-nav-open', open);
    shell.querySelector('.sidebar')?.classList.toggle('open', open);
    shell.querySelector('.server-sidebar')?.classList.toggle('open', open);
    const button = document.getElementById('menuBtn');
    if (button) button.setAttribute('aria-expanded', String(open));
  },
  closeMobileNav() { this.toggleMobileNav(false); },
};

/* ================================ auth ================================ */
async function bootstrap({ active, requireAuth = true } = {}) {
  if (!store.token) {
    if (requireAuth) {
      location.replace('index.html');
      throw new Error('Not signed in');
    }
    return null;
  }
  try {
    const data = await API.get('/auth/me');
    store.user = data.user;
    store.settings = data.settings || {};
    applyAppearance(store.settings);
    Layout.render(active);
    Layout.setServerCount(data.servers);
    document.dispatchEvent(new CustomEvent('zenith:ready', { detail: data }));
    return data;
  } catch (err) {
    if (requireAuth && err.status === 401) { location.replace('index.html'); }
    throw err;
  }
}
window.bootstrap = bootstrap;
window.store = store;
window.Layout = Layout;
window.API = API;
window.ICONS = ICONS;

/* ========================= external sign-in buttons ========================= */
// Firebase's official compatibility SDK is loaded only when an owner enables
// Google sign-in. No provider script or credential is contacted otherwise.
const loadedScripts = new Map();
function loadExternalScript(source) {
  if (loadedScripts.has(source)) return loadedScripts.get(source);
  const task = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = source; tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`Could not load ${source}`));
    document.head.appendChild(tag);
  });
  loadedScripts.set(source, task);
  return task;
}
async function signInWithFirebaseGoogle(config) {
  await loadExternalScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  await loadExternalScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js');
  if (!window.firebase || !window.firebase.initializeApp) throw new Error('Firebase web SDK did not initialise');
  const name = 'zenith-google-sign-in';
  const app = (window.firebase.apps || []).find((item) => item.name === name) || window.firebase.initializeApp(config, name);
  const provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await app.auth().signInWithPopup(provider);
  const idToken = await result.user.getIdToken(true);
  // The browser Firebase session is only a vehicle for the ID token. Zenith's
  // server verifies the token and issues its own panel session afterwards.
  await app.auth().signOut().catch(() => {});
  return API.post('/auth/firebase/google', { idToken });
}
const OAuthLogin = {
  mount(target, providers, { onSuccess, onError } = {}) {
    if (!target) return;
    const google = providers && providers.google;
    const discord = providers && providers.discord;
    if (!google || !google.enabled) {
      if (!discord || !discord.enabled) { target.innerHTML = ''; return; }
    }
    target.innerHTML = `<div class="auth-oauth-divider"><span>or continue with</span></div><div class="auth-oauth-buttons">
      ${google && google.enabled ? `<button class="btn auth-provider-btn google" type="button" data-oauth="google"><span class="auth-provider-mark" aria-hidden="true">G</span><span>Google</span></button>` : ''}
      ${discord && discord.enabled ? `<button class="btn auth-provider-btn discord" type="button" data-oauth="discord"><span class="auth-provider-mark" aria-hidden="true">◉</span><span>Discord</span></button>` : ''}
    </div><p class="auth-oauth-note">Your panel administrator controls whether a new account may be created through these providers.</p>`;
    target.querySelector('[data-oauth="google"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.innerHTML = `${UI.spinner(13)} <span>Connecting to Google…</span>`;
      try {
        const result = await signInWithFirebaseGoogle(google.firebase);
        if (onSuccess) onSuccess(result);
      } catch (err) {
        if (onError) onError(err);
        button.disabled = false; button.innerHTML = '<span class="auth-provider-mark" aria-hidden="true">G</span><span>Google</span>';
      }
    });
    target.querySelector('[data-oauth="discord"]')?.addEventListener('click', () => { location.href = '/api/auth/discord/start'; });
  },
  async completeDiscordRedirect({ onSuccess, onError } = {}) {
    const query = new URLSearchParams(location.search);
    const error = query.get('oauth_error');
    const code = query.get('oauth');
    if (!error && !code) return false;
    history.replaceState({}, document.title, `${location.pathname}${location.hash}`);
    if (error) { if (onError) onError(new Error(error)); return true; }
    try {
      const result = await API.post('/auth/oauth/complete', { code });
      if (onSuccess) onSuccess(result);
    } catch (err) { if (onError) onError(err); }
    return true;
  },
};
window.OAuthLogin = OAuthLogin;

/* ================================ sockets ================================ */
/**
 * Console socket with automatic reconnect + HTTP polling fallback
 * (some reverse proxies block websockets).
 */
class ConsoleSocket {
  constructor(serverId, { onEvent, onState } = {}) {
    this.serverId = serverId;
    this.onEvent = onEvent || (() => {});
    this.onState = onState || (() => {});
    this.seq = 0;
    this.attempts = 0;
    this.mode = 'connecting';
    this.closed = false;
    this.pollTimer = null;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(store.token)}`;
    let socket;
    try { socket = new WebSocket(url); } catch { return this.startPolling(); }
    this.socket = socket;

    const timeout = setTimeout(() => {
      if (this.mode !== 'open') { try { socket.close(); } catch (_) {} this.startPolling(); }
    }, 4000);

    socket.onopen = () => {
      clearTimeout(timeout);
      this.mode = 'open';
      this.attempts = 0;
      this.stopPolling();
      this.onState('open');
      socket.send(JSON.stringify({ type: 'subscribe', serverId: this.serverId, since: 0 }));
      this.ping = setInterval(() => { try { socket.send(JSON.stringify({ type: 'ping' })); } catch (_) {} }, 25000);
    };
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'log' && msg.seq) this.seq = Math.max(this.seq, msg.seq);
      this.onEvent(msg);
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      clearInterval(this.ping);
      if (this.closed) return;
      this.mode = 'closed';
      this.onState('closed');
      this.attempts += 1;
      if (this.attempts >= 3) return this.startPolling();
      setTimeout(() => this.connect(), Math.min(1500 * this.attempts, 8000));
    };
    socket.onerror = () => {};
  }
  command(command) {
    if (this.mode === 'open') this.socket.send(JSON.stringify({ type: 'command', serverId: this.serverId, command }));
    else API.post(`/servers/${this.serverId}/command`, { command }).catch((e) => UI.toast(e.message, 'error'));
  }
  power(action) {
    if (this.mode === 'open') this.socket.send(JSON.stringify({ type: 'power', serverId: this.serverId, action }));
    else API.post(`/servers/${this.serverId}/${action}`).catch((e) => UI.toast(e.message, 'error'));
  }
  startPolling() {
    if (this.pollTimer || this.closed) return;
    this.mode = 'polling';
    this.onState('polling');
    const tick = async () => {
      try {
        const data = await API.get(`/servers/${this.serverId}/logs?since=${this.seq}`);
        if (data.lines && data.lines.length) {
          this.seq = data.seq;
          this.onEvent({ type: 'log', data: data.lines.map((l) => l.line).join('\n'), seq: data.seq, polled: true });
        }
        this.onEvent({ type: 'stats', data: { ...data.stats, status: data.status }, polled: true });
        this.onEvent({ type: 'players', data: data.players, polled: true });
        if (data.installProgress) this.onEvent({ type: 'install', data: data.installProgress, polled: true });
      } catch (_) { /* keep trying */ }
    };
    tick();
    this.pollTimer = setInterval(tick, 1500);
  }
  stopPolling() { if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; } }
  close() {
    this.closed = true;
    this.stopPolling();
    try { this.socket && this.socket.close(); } catch (_) {}
  }
}
window.ConsoleSocket = ConsoleSocket;

/* ================================ console renderer ================================ */
function classifyLine(line) {
  if (/^\s*>/.test(line) || /\[panel\]|\[Zenith\]|\[installer\]|\[migration\]|\[playit\]|\[modrinth\]|\[backup\]|\[java\]/i.test(line)) return 'panel';
  if (/\b(ERROR|SEVERE|FATAL|Exception|Caused by)\b/.test(line)) return 'error';
  if (/\b(WARN|WARNING)\b/.test(line)) return 'warn';
  if (/joined the game/.test(line)) return 'join';
  if (/left the game/.test(line)) return 'leave';
  if (/\bINFO\b/.test(line)) return 'info';
  return '';
}
class ConsoleView {
  constructor(el, { max = 3000 } = {}) {
    this.el = el;
    this.max = max;
    this.lines = 0;
  }
  append(text) {
    if (!text) return;
    const atBottom = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 40;
    const frag = document.createDocumentFragment();
    for (const raw of String(text).split('\n')) {
      if (raw === '' ) continue;
      const span = document.createElement('span');
      const cls = classifyLine(raw);
      span.className = `l ${cls}`;
      span.textContent = raw;
      frag.appendChild(span);
      this.lines += 1;
    }
    this.el.appendChild(frag);
    while (this.el.childElementCount > this.max) this.el.removeChild(this.el.firstChild);
    if (atBottom) this.el.scrollTop = this.el.scrollHeight;
  }
  clear() { this.el.innerHTML = ''; this.lines = 0; }
}
window.ConsoleView = ConsoleView;
