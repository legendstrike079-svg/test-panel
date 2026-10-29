'use strict';
/**
 * Builds `preview/theme.html`: a single self-contained page (CSS inlined, inline
 * SVG, no network) that shows the reworked Servers list and the reworked console
 * page with representative data - handy for visual review inside a sandboxed
 * preview pane where external stylesheets and scripts cannot load.
 *
 * Usage: node scripts/theme-preview.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'app.css'), 'utf8');

/* ------------------------------ banner art ------------------------------ */
const TYPE_COLORS = {
  PAPER: ['#7ec8a0', '#5aa9ff', '#f0c674', '#32607a'],
  VANILLA: ['#8fd694', '#6fc3e0', '#e8e2c0', '#3c6b53'],
  PURPUR: ['#c39bf5', '#7f6ad8', '#f3bde4', '#3b2f63'],
  FABRIC: ['#f0d9a8', '#9ad3c6', '#ffb27a', '#4a5b6e'],
  QUILT: ['#c9a8f0', '#f5c9e0', '#8fd694', '#3f3a63'],
  FORGE: ['#d8b48a', '#8a6a4a', '#c9d8e0', '#3a3226'],
  NEOFORGE: ['#f0a868', '#e07850', '#ffd9a8', '#4a3a30'],
  SPIGOT: ['#f0c674', '#d8a04a', '#8fd694', '#3f3a2a'],
  BUNGEECORD: ['#c9b6f0', '#8fa8e0', '#f0d9a8', '#33355c'],
  VELOCITY: ['#8fd6f0', '#5aa9ff', '#c9f0e0', '#28455c'],
};
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function bannerArt(s) {
  const seed = hash(s.id + s.name);
  const [a, b, c, sky] = TYPE_COLORS[s.serverType] || TYPE_COLORS.PAPER;
  const rnd = (n) => ((seed >> (n * 3)) % 1000) / 1000;
  const W = 400; const H = 132;
  const clouds = [0, 1].map((i) => {
    const cx = 40 + rnd(i) * (W - 120); const cy = 18 + rnd(i + 4) * 44; const w = 46 + rnd(i + 7) * 62;
    return `<g opacity="${(0.24 + rnd(i + 2) * 0.22).toFixed(2)}"><rect x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" width="${w.toFixed(0)}" height="9" rx="2" fill="#ffffff"/><rect x="${(cx + 12).toFixed(0)}" y="${(cy - 8).toFixed(0)}" width="${(w * 0.5).toFixed(0)}" height="9" rx="2" fill="#ffffff"/></g>`;
  }).join('');
  const hills = [0, 1, 2].map((i) => {
    const y = 78 + i * 17 + rnd(i + 1) * 8;
    return `<polygon points="0,${H} ${(W * 0.18).toFixed(0)},${(y - 22).toFixed(0)} ${(W * 0.42).toFixed(0)},${H} ${W},${H}" fill="${i === 0 ? a : i === 1 ? b : c}" opacity="${(0.42 - i * 0.08).toFixed(2)}"/>`;
  }).join('');
  const blocks = Array.from({ length: 7 }, (_, i) => {
    const bx = 22 + i * 51 + Math.round(rnd(i + 3) * 14); const by = 96 + Math.round(rnd(i + 5) * 22);
    return `<rect x="${bx}" y="${by}" width="17" height="17" rx="3" fill="${i % 2 ? b : a}" opacity="0.5"/>`;
  }).join('');
  return `<svg class="art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sky-${s.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sky}" stop-opacity="0.92"/><stop offset="100%" stop-color="#05060c" stop-opacity="0.95"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky-${s.id})"/>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${i * 11}" width="${W}" height="1" fill="#ffffff" opacity="0.03"/>`).join('')}
    ${clouds}${hills}${blocks}
  </svg>`;
}

/* ------------------------------ sample data ------------------------------ */
const servers = [
  { id: 'srv_demo_1', name: 'Survival', serverType: 'PAPER', version: '1.21.4', nodeName: 'Local Node', status: 'running', backend: 'docker', port: 25565, players: 7, maxPlayers: 30, memoryPretty: '1.42 GB', cpu: 12.4, disk: '1.86 GB', uptime: '4h 12m', packages: 12, addr: 'play.example.com:25565' },
  { id: 'srv_demo_2', name: 'Modded SMP', serverType: 'NEOFORGE', version: '1.21.1', nodeName: 'Local Node', status: 'starting', backend: 'docker', port: 25566, players: 0, maxPlayers: 20, memoryPretty: '3.04 GB', cpu: 46.8, disk: '6.21 GB', uptime: '', packages: 84, addr: 'play.example.com:25566' },
  { id: 'srv_demo_3', name: 'Creative Plot', serverType: 'FABRIC', version: '1.21.4', nodeName: 'Local Node', status: 'offline', backend: 'process', port: 25567, players: 0, maxPlayers: 40, memoryPretty: '0 B', cpu: 0, disk: '512 MB', uptime: '', packages: 6, addr: 'play.example.com:25567' },
  { id: 'srv_demo_4', name: 'Proxy', serverType: 'VELOCITY', version: '3.4.0', nodeName: 'edge-1', status: 'running', backend: 'process', port: 25577, players: 23, maxPlayers: 500, memoryPretty: '218 MB', cpu: 2.1, disk: '96 MB', uptime: '2d 6h', packages: 3, addr: 'proxy.example.com:25577' },
];

const ICONS = {
  node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17-2.5-2.6-2.5-14.4 0-17z"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19V5M4 19h16"/><path d="M8 19v-6M12.5 19V9M17 19v-4"/></svg>',
  chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M7 7V4M12 7V4M17 7V4"/></svg>',
  disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><path d="M7 8h.01M7 16h.01"/></svg>',
  users2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><path d="M16 5.5a3 3 0 010 5.6M17 13.2a5.5 5.5 0 013.5 5.1"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8L19 12z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M20 12a8 8 0 11-2.7-6"/><path d="M20 4v5h-5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.4M12 18.6V21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M3 12h2.4M18.6 12H21M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M20 12a8 8 0 11-2.7-6"/><path d="M20 4v5h-5"/></svg>',
  container: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 8.5L12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5L12 13l9-4.5M12 13v7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7.5A2 2 0 015 5.5h4l2 2.5h8a2 2 0 012 2v6.5a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 19.5a6.5 6.5 0 0113 0"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="12" r="3.4"/><path d="M11.4 12H21M17 9.5V14M19.5 9.5V14"/></svg>',
  puzzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 4h4v2.2a1.8 1.8 0 103.6 0V4H20v4h-1.8a1.8 1.8 0 100 3.6H20V20h-4.6v-1.8a1.8 1.8 0 10-3.6 0V20H4v-4.6h1.8a1.8 1.8 0 100-3.6H4V4h6z"/></svg>',
  backup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4l2.4 5 5.6.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.6-.8z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>',
  servers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4h9l4 4v12H6z"/><path d="M9 4v5h6V4M9 20v-6h6v6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 5H6v14h9M11 12h9M17 8.5l3.5 3.5L17 15.5"/></svg>',
};

const STATUS_LABEL = { running: 'Running', starting: 'Starting', installing: 'Installing', stopping: 'Stopping', offline: 'Offline', crashed: 'Crashed', suspended: 'Suspended' };

/* ------------------------------ servers page ------------------------------ */
function tile(label, value, { icon = '', cls = '' } = {}) {
  return `<div class="srv-tile ${cls}"><div class="k">${icon}${label}</div><div class="v" title="${value}">${value}</div></div>`;
}
function card(s) {
  const color = (TYPE_COLORS[s.serverType] || TYPE_COLORS.PAPER)[0];
  return `<div class="card srv-card server-card" data-id="${s.id}">
    <div class="srv-banner">
      ${bannerArt(s)}
      <span class="srv-type"><i class="dot" style="background:${color}"></i>${s.serverType} ${s.version}</span>
      <span class="srv-pill ${s.status}"><i></i>${STATUS_LABEL[s.status]}</span>
      <div class="banner-title">
        <b>${s.name}</b>
        <span>${s.nodeName} · ${s.players}/${s.maxPlayers} online · ${s.backend}</span>
      </div>
    </div>
    <div class="srv-body">
      <div class="srv-tiles">
        ${tile('Node', s.nodeName, { icon: ICONS.node })}
        ${tile('Address', s.addr, { icon: ICONS.globe })}
        ${tile('CPU usage', `${s.cpu.toFixed(1)}%`, { icon: ICONS.analytics, cls: s.cpu > 80 ? 'warn' : 'blue' })}
        ${tile('Memory', s.memoryPretty, { icon: ICONS.memory })}
        ${tile('Storage', s.disk, { icon: ICONS.disk })}
        ${tile('Players', `${s.players} / ${s.maxPlayers}`, { icon: ICONS.users2 })}
      </div>
      <div class="srv-foot">
        ${s.status === 'running'
          ? `<button class="btn sm">${ICONS.restart}</button><button class="btn sm red">${ICONS.stop}</button>`
          : `<button class="btn sm green">${ICONS.play}</button>`}
        <span class="tiny dim" style="margin-left:2px">${s.uptime ? `up ${s.uptime}` : 'stopped'}</span>
        <div class="grow"></div>
        ${s.packages ? `<span class="chip">${s.packages} add-ons</span>` : ''}
        <a class="btn sm">${ICONS.terminal} Console</a>
      </div>
    </div>
  </div>`;
}

const sidebarNav = [
  ['Dashboard', ICONS.dashboard], ['Analytics', ICONS.analytics], ['Servers', ICONS.servers], ['Create Server', ICONS.plus],
  ['Nodes', ICONS.node], ['Allocations', ICONS.ports || ICONS.globe], ['Account', ICONS.users2], ['Admin Servers', ICONS.servers],
  ['API Keys', ICONS.key], ['Admin Settings', ICONS.gear],
];

function shell({ title, crumb, rail, activeNav, activeTab, tabs, content }) {
  const nav = (rail ? sidebarNav : []).map(([label, icon]) =>
    `<a href="#" class="${label === activeNav ? 'active' : ''}" title="${label}">${icon}${rail ? '' : `<span>${label}</span>`}</a>`).join('');
  const railTabs = rail ? `<div class="rail-split">
      <div class="rail-divider"></div>
      ${tabs.map(([key, label, icon]) => `<button data-tab="${key}" title="${label}" class="${key === activeTab ? 'active' : ''}">${icon}<span>${label}</span></button>`).join('')}
    </div>` : '';
  return `<div class="shell ${rail ? 'rail' : ''}">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">Z</div>${rail ? '' : `<div class="brand-text"><b>Zenith Panel</b><span>Server Control</span></div>`}</div>
      <nav class="nav">${nav}${railTabs}</nav>
      <div class="nav-foot"><a class="user-chip" href="#"><div class="avatar">A</div>${rail ? '' : `<div class="meta grow"><b>admin</b><span>owner</span></div>`}</a></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="grow"><h1>${title}</h1><div class="crumb">${crumb}</div></div>
        <div class="page-actions"></div>
        <div class="row" style="gap:8px"><span class="badge">14:07</span><button class="btn icon ghost" title="Sign out">${ICONS.logout}</button></div>
      </header>
      <main class="content">${content}</main>
    </div>
  </div>`;
}

const serversScreen = shell({
  title: 'Servers',
  crumb: 'all instances you can access',
  rail: false,
  activeNav: 'Servers',
  content: `
  <div class="row wrap" style="gap:10px;margin-bottom:16px;align-items:center">
    <div class="grow" style="max-width:420px;position:relative">
      <input type="search" placeholder="Search servers..." style="padding-left:34px">
      <span style="position:absolute;left:11px;top:9px;width:15px;height:15px;color:var(--fg-faint)">${ICONS.search}</span>
    </div>
    <select style="max-width:170px"><option>All statuses</option></select>
    <select style="max-width:180px"><option>Sort: name</option></select>
    <div class="grow"></div>
    <div class="view-toggle">
      <button title="List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      <button class="active" title="Two columns"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg></button>
      <button title="Three columns"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="16" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/></svg></button>
    </div>
    <button class="btn sm">Refresh</button>
    <button class="btn sm primary">${ICONS.plus} Create server</button>
  </div>
  <div class="grid cards-2 stagger">${servers.map(card).join('')}</div>
  <div class="row wrap" style="gap:10px;margin-top:16px">
    <span class="tiny dim">4 servers · 2 running · 4.6 GB in use right now</span>
    <div class="grow"></div>
    <span class="tiny dim">Every card shows the numbers the node really reports - no placeholders.</span>
  </div>`,
});

/* ------------------------------ console page ------------------------------ */
const tabs = [
  ['console', 'Console', ICONS.terminal], ['players', 'Players', ICONS.users2], ['files', 'Files', ICONS.folder],
  ['properties', 'Properties', ICONS.edit], ['worlds', 'Worlds', ICONS.star], ['sftp', 'SFTP', ICONS.key],
  ['plugins', 'Modrinth', ICONS.puzzle], ['backups', 'Backups', ICONS.backup], ['network', 'Network', ICONS.globe],
  ['schedules', 'Schedules', ICONS.clock], ['people', 'People', ICONS.users], ['settings', 'Settings', ICONS.gear],
];

function area(vals, { color = 'var(--blue)', height = 96, unit = '%', label = '', w = 600, unitLabel = '' } = {}) {
  const top = Math.max(10, Math.ceil(Math.max(...vals) * 1.15));
  const min = 0;
  const step = w / (vals.length - 1);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(height - 3 - ((v - min) / (top - min)) * (height - 6)).toFixed(1)}`).join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="0" x2="${w}" y1="${(height - f * height).toFixed(1)}" y2="${(height - f * height).toFixed(1)}"/>`).join('');
  const last = vals[vals.length - 1];
  return `<div class="chart-box" style="height:${height}px">
    <div class="chart-axis">${[top, top / 2, min].map((v) => `<span>${Math.round(v)}${unit}</span>`).join('')}</div>
    <svg class="chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img">
      <g class="chart-grid">${grid}</g>
      <path class="chart-fill" d="${line} L${w} ${height} L0 ${height} Z" style="fill:${color}"/>
      <path class="chart-line" d="${line}" style="stroke:${color}"/>
      <circle class="chart-dot" cx="${w}" cy="${(height - 3 - ((last - min) / (top - min)) * (height - 6)).toFixed(1)}" r="3.5" style="fill:${color}"/>
    </svg>
    <div class="chart-mini"><span>14:02</span><span>now</span></div>
  </div>
  <div class="row between mt"><span class="tiny dim">${label}</span><span class="tiny mono">${last.toFixed(1)}${unitLabel || unit}</span></div>`;
}

const cpuVals = [6.2, 7.8, 5.4, 9.1, 12.4, 11.2, 8.6, 10.4, 9.8, 12.1, 14.6, 12.9, 11.4, 12.4];
const memVals = [1180, 1210, 1195, 1260, 1305, 1290, 1340, 1372, 1360, 1402, 1420, 1448, 1436, 1452];
const netVals = [180, 240, 205, 310, 268, 402, 356, 288, 340, 512, 468, 395, 430, 388];

const consoleLines = [
  ['[14:06:31 INFO]', 'Starting minecraft server version 1.21.4'],
  ['[14:06:31 INFO]', 'Loading properties'],
  ['[14:06:31 INFO]', 'This server is running Paper version 1.21.4-232'],
  ['[14:06:32 INFO]', 'Preparing level "world"'],
  ['[14:06:33 INFO]', 'Preparing start region for dimension minecraft:overworld'],
  ['[14:06:36 INFO]', 'Done (4.312s)! For help, type "help"'],
  ['[14:06:41 INFO]', 'Steve joined the game'],
  ['[14:06:44 INFO]', 'Alex joined the game'],
  ['[14:07:02 INFO]', '<Steve> nice, the panel restarted the server automatically'],
  ['[14:07:19 INFO]', 'Saving chunks for level "ServerLevel[world]"/minecraft:overworld'],
];

const consoleScreen = shell({
  title: '',
  crumb: '',
  rail: true,
  activeNav: 'Servers',
  activeTab: 'console',
  tabs,
  content: `
  <div class="page-head">
    <div>
      <h1>Survival</h1>
      <div class="sub">
        <span class="status-line running"><i></i>Running</span>
        <span>PAPER 1.21.4</span><span>·</span>
        <span>${ICONS.node}Local Node</span><span>·</span>
        <span>${ICONS.container}container zenith-srv_demo_1</span><span>·</span>
        <span>${ICONS.memory}2048 MB heap</span><span>·</span>
        <span>Java 21</span>
      </div>
    </div>
    <div class="tools">
      <button class="icon-btn" title="Jump to the command line">${ICONS.search}</button>
      <button class="icon-btn" title="Server settings">${ICONS.gear}</button>
      <button class="icon-btn" title="Panel analytics">${ICONS.analytics}</button>
      <button class="icon-btn" title="Refresh">${ICONS.refresh}</button>
    </div>
  </div>
  <div class="console-grid">
    <div class="stack">
      <div class="card panel-card">
        <div class="panel-head">
          <span class="t">Survival</span>
          <span class="badge tiny green">live (websocket)</span>
          <span class="tiny dim">PAPER 1.21.4 | docker (zenith-srv_demo_1) | play.example.com:25565</span>
          <div class="power-btns">
            <button class="btn green">${ICONS.restart} Restart</button>
            <button class="btn red">${ICONS.stop} Stop</button>
          </div>
          <button class="btn ghost sm icon" title="Clear the view">${ICONS.trash}</button>
          <button class="btn ghost sm icon" title="Jump to the newest line">${ICONS.download}</button>
        </div>
        <div class="terminal-body" style="min-height:320px;max-height:42vh">
          ${consoleLines.map(([t, m]) => `<span class="l"><span class="dim">${t}</span> ${m}</span>`).join('')}
          <span class="l cmd">&gt; say the console theme is done</span>
          <span class="l panel">[panel] Command sent to the container</span>
        </div>
        <div class="console-input">
          <span class="prompt">&raquo;</span>
          <input type="text" placeholder="Type a command..." readonly>
          <button class="btn primary">Send</button>
        </div>
      </div>

      <div class="chart-row">
        <div class="card chart-card">
          <div class="hd"><b>CPU load</b><span class="tiny dim">${ICONS.chip} this server</span></div>
          ${area(cpuVals, { color: 'var(--blue)', unit: '%', label: 'CPU of this server' })}
        </div>
        <div class="card chart-card">
          <div class="hd"><b>Memory</b><span class="tiny dim">${ICONS.memory} heap in use</span></div>
          ${area(memVals, { color: 'var(--green)', unit: '', unitLabel: ' MB', label: 'RSS of the server process' })}
        </div>
        <div class="card chart-card">
          <div class="hd"><b>Network</b><span class="tiny dim">container in/out</span></div>
          ${area(netVals, { color: 'var(--violet)', unit: '', unitLabel: ' KiB/s', label: 'bytes/s' })}
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <h3>Quick commands</h3>
          <div class="chips mt">${['list', 'save-all', 'whitelist list', 'tps', 'time set day', 'weather clear'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
          <div class="tiny dim mt">Click to fill, then press Send.</div>
        </div>
        <div class="card">
          <h3>Last events</h3>
          <div class="tiny">
            <div class="row between" style="padding:4px 0"><span><span class="dim">server.start</span> Started in container</span><span class="dim">5 min ago</span></div>
            <div class="row between" style="padding:4px 0"><span><span class="dim">backup.create</span> world-2026-10-16.zip</span><span class="dim">1 h ago</span></div>
            <div class="row between" style="padding:4px 0"><span><span class="dim">plugin.install</span> EssentialsX 2.20.1</span><span class="dim">3 h ago</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card stat-card blue">
        <div class="ic">${ICONS.globe}</div>
        <div class="meta"><div class="k">Address</div><div class="v">play.example.com:25565</div></div>
        <button class="btn ghost sm icon" title="Copy the join address">${ICONS.save}</button>
      </div>
      <div class="card stat-card green">
        <div class="ic">${ICONS.clock}</div>
        <div class="meta"><div class="k">Uptime</div><div class="v">4h 12m 08s</div></div>
      </div>
      <div class="card stat-card">
        <div class="ic">${ICONS.chip}</div>
        <div class="meta"><div class="k">CPU load</div><div class="v">12.42%</div></div>
      </div>
      <div class="card stat-card">
        <div class="ic">${ICONS.memory}</div>
        <div class="meta"><div class="k">Memory</div><div class="v">1.42 GiB / 2 GiB</div></div>
      </div>
      <div class="card stat-card yellow">
        <div class="ic">${ICONS.disk}</div>
        <div class="meta"><div class="k">Disk</div><div class="v">1.86 GiB / 10 GiB</div></div>
      </div>
      <div class="card stat-card violet">
        <div class="ic">${ICONS.container}</div>
        <div class="meta"><div class="k">Runtime</div><div class="v">container · zenith-srv_demo_1</div></div>
      </div>
      <div class="metric-grid">
        <div class="card"><div class="k">${ICONS.download} Inbound</div><div class="v">124.6 KiB/s</div></div>
        <div class="card"><div class="k">${ICONS.upload} Outbound</div><div class="v">88.2 KiB/s</div></div>
      </div>
      <div class="card">
        <div class="row between"><span class="label tiny dim">Players</span><span class="badge tiny mono">7 / 30</span></div>
        <div class="chips mt">${['Steve', 'Alex', 'Notch', 'Herobrine'].map((p) => `<span class="player-pill">${p}</span>`).join('')}</div>
      </div>
      <div class="card">
        <span class="label tiny dim">Legacy meters</span>
        <div class="stack mt" style="gap:8px">
          <div><div class="row between tiny"><span class="dim">CPU</span><span class="mono">12.4%</span></div><div class="bar"><i style="width:12%"></i></div></div>
          <div><div class="row between tiny"><span class="dim">Memory</span><span class="mono">1.42 GiB / 2 GiB</span></div><div class="bar blue"><i style="width:71%"></i></div></div>
          <div><div class="row between tiny"><span class="dim">Disk</span><span class="mono">1.86 GiB</span></div><div class="bar yellow"><i style="width:19%"></i></div></div>
        </div>
      </div>
    </div>
  </div>`,
});


/* --------------------------- components gallery --------------------------- */
/* The ported JTG component set (public/js/components.js), rendered statically so
   it can be reviewed without a browser session. Same classes as the live panel. */
const componentCards = [
  {
    title: 'LoadingOverlay',
    note: 'blocking overlay + Loading.run()',
    html: `<div class="loading-card"><span class="spinner" style="width:22px;height:22px"></span><div>Installing Paper 1.21.4 (build 232)...</div></div>`,
  },
  {
    title: 'NotificationsDropdown',
    note: 'topbar bell, unread badge, activity feed',
    html: `<div style="position:relative;min-height:210px">
      <div class="row" style="justify-content:flex-end;padding:6px 4px">
        <button class="btn icon ghost" style="position:relative">${ICONS.analytics}
          <span class="badge red tiny" style="position:absolute;top:-4px;right:-4px;padding:0 5px">3</span></button>
      </div>
      <div class="dropdown open" style="right:0;top:36px;max-height:none">
        <div class="row between" style="padding:10px 12px;border-bottom:1px solid var(--line)">
          <b class="tiny">Notifications</b>
          <div class="row" style="gap:6px"><button class="btn ghost sm">Reload</button><button class="btn ghost sm">Mark all read</button></div>
        </div>
        <a class="notif-item"><span class="dot green"></span><span class="grow"><b>server.start</b><span class="tiny dim">Survival SMP · container zenith-srv_9f21 started</span></span><span class="tiny dim mono">2m</span></a>
        <a class="notif-item"><span class="dot red"></span><span class="grow"><b>server.crash</b><span class="tiny dim">Proxy · exit code 1, restarting</span></span><span class="tiny dim mono">18m</span></a>
        <a class="notif-item"><span class="dot blue"></span><span class="grow"><b>plugin.install</b><span class="tiny dim">Survival SMP · EssentialsX 2.20.1</span></span><span class="tiny dim mono">1h</span></a>
      </div></div>`,
  },
  {
    title: 'GlobalSearchModal',
    note: 'Ctrl/⌘+K over servers, nodes and pages',
    html: `<div class="modal" style="width:100%;max-width:420px">
      <div class="modal-head"><h3>Search</h3><button class="btn icon ghost">${ICONS.close}</button></div>
      <div class="modal-body" style="padding:14px 16px">
        <input type="search" value="surv" placeholder="Search servers, nodes, pages...">
        <div class="mt">
          <a class="gs-item active"><span class="gs-group">Servers</span><b>Survival SMP</b><span class="tiny dim">PAPER 1.21.4 · running · Local Node</span></a>
          <a class="gs-item"><span class="gs-group">Servers</span><b>Survival Test</b><span class="tiny dim">FABRIC 1.20.1 · offline · Local Node</span></a>
          <a class="gs-item"><span class="gs-group">Pages</span><b>Servers</b><span class="tiny dim">all instances</span></a>
        </div>
        <div class="tiny dim mt">Tip: press <span class="mono">Ctrl</span> + <span class="mono">K</span> anywhere in the panel.</div>
      </div></div>`,
  },
  {
    title: 'TutorialOverlay',
    note: 'first-run spotlight tour, replayable from Account',
    html: `<div style="position:relative;min-height:230px;background:radial-gradient(circle at 30% 20%, rgba(90,169,255,.10), transparent 60%)">
      <div class="tour-ring" style="left:24px;top:16px;width:120px;height:52px;box-shadow:0 0 0 9999px rgba(2,2,4,.62)"></div>
      <div class="tour-card" style="position:absolute;left:24px;top:86px;width:300px">
        <div class="tiny dim">Step 2 of 6</div>
        <h3 style="margin:4px 0 6px">Your servers</h3>
        <div class="tiny" style="color:var(--fg-dim)">Everything you own. Create a new one from Create Server - the panel downloads the jar and a matching Java runtime for you.</div>
        <div class="row between mt"><button class="btn ghost sm">Skip</button>
          <div class="row" style="gap:6px"><button class="btn sm">Back</button><button class="btn primary sm">Next</button></div></div>
      </div></div>`,
  },
  {
    title: 'SearchableDropdown · CategorizedVersionDropdown',
    note: 'filterable select, grouped builds',
    html: `<div style="min-height:250px">
      <div class="sd" data-value="1.21.4"><button class="sd-btn">1.21.4<span class="sd-caret">${ICONS.plus}</span></button>
        <div class="sd-panel open">
          <input type="search" class="sd-search" placeholder="Filter...">
          <div class="sd-list">
            <div class="sd-group">Stable releases</div>
            <button class="sd-item active"><span>1.21.4</span><span class="tiny dim">current</span></button>
            <button class="sd-item"><span>1.21.3</span></button>
            <button class="sd-item"><span>1.20.6</span></button>
            <div class="sd-group">Snapshots &amp; pre-releases</div>
            <button class="sd-item"><span>26.4-snapshot-4</span></button>
            <button class="sd-item"><span>1.21.5-pre2</span></button>
          </div></div></div></div>`,
  },
  {
    title: 'ImageCropper',
    note: 'canvas square crop → PATCH /api/auth/profile',
    html: `<div class="crop-stage"><canvas width="240" height="240" style="width:240px;height:240px;background:repeating-conic-gradient(#16161c 0% 25%,#0d0d12 0% 50%) 50% / 18px 18px"></canvas></div>
      <div class="row mt" style="gap:10px"><span class="tiny dim">Zoom</span><input type="range" min="1" max="3" value="1.2" class="grow"><button class="btn sm">Reset</button></div>`,
  },
  {
    title: 'ModrinthVersionModal',
    note: 'build picker used by the Plugins and Mods tabs',
    html: `<div class="row between" style="gap:10px"><select style="max-width:140px"><option>All channels</option></select><input type="search" placeholder="filter by game version..." style="max-width:180px"><div class="grow"></div><span class="badge tiny">3 builds</span></div>
      <div class="mt">
        <div class="row between" style="padding:9px 4px;border-bottom:1px solid var(--line-subtle)">
          <div class="stack" style="gap:3px"><div class="row" style="gap:8px"><b class="mono">2.20.1</b><span class="badge tiny green">release</span><span class="tiny dim">paper, spigot</span></div>
            <div class="tiny dim">for 1.21.4, 1.21.3 · 412k downloads · 3 weeks ago</div></div>
          <button class="btn sm primary">${ICONS.download} Install</button></div>
        <div class="row between" style="padding:9px 4px;border-bottom:1px solid var(--line-subtle)">
          <div class="stack" style="gap:3px"><div class="row" style="gap:8px"><b class="mono">2.20.0</b><span class="badge tiny yellow">beta</span><span class="tiny dim">paper</span></div>
            <div class="tiny dim">for 1.21.4 · 88k downloads · 2 months ago</div></div>
          <button class="btn sm primary">${ICONS.download} Install</button></div>
      </div>`,
  },
  {
    title: 'SystemUpdateListener · UpdateWatch',
    note: 'only claims an update when a feed really differs',
    html: `<div class="banner-note">${ICONS.info}<div class="grow"><b>A newer panel version is available (1.1.0)</b><div class="tiny dim">Run the update command on the host to upgrade.</div></div><button class="btn sm">How to update</button></div>
      <div class="tiny dim mt">With no feed configured the same API answers honestly: <span class="mono">"No update feed configured - set UPDATE_FEED_URL in .env"</span>.</div>`,
  },
  {
    title: 'Plugins / Mods tabs',
    note: 'one renderer, ids scoped per mode',
    html: `<div class="tabs" style="margin-bottom:14px"><button class="active">Installed</button><button>Browse Modrinth</button></div>
      <div class="row between"><div class="row" style="gap:8px"><input type="search" placeholder="filter installed..." style="max-width:200px"><button class="btn sm">${ICONS.refresh} Check for updates</button></div><span class="badge tiny">4 plugins</span></div>
      <div class="card flush mt"><div class="row" style="gap:10px;padding:10px"><img class="plugin-icon" style="width:30px;height:30px" alt="">
        <div class="grow"><div style="font-weight:600">EssentialsX</div><div class="tiny dim mono">EssentialsX-2.20.1.jar</div></div>
        <span class="badge green">enabled</span><button class="btn sm ghost">update</button><button class="btn sm ghost">${ICONS.trash}</button></div></div>`,
  },
];

const componentsScreen = `
<div class="pv-wrap">
  <div class="page-head"><h1>Shared components</h1><div class="sub">public/js/components.js - loaded on every page after app.js, no framework, no build step</div></div>
  <div class="pv-grid">
    ${componentCards.map((c) => `
      <div class="pv-card">
        <div class="pv-head"><b>${c.title}</b><span class="tiny dim">${c.note}</span></div>
        <div class="pv-frame">${c.html}</div>
      </div>`).join('')}
  </div>
  <div class="tiny dim pv-note">Every component above is wired to the real API in the panel: the bell reads <span class="mono">/api/system/activity</span>,
  search reads <span class="mono">/api/servers</span> + <span class="mono">/api/nodes</span>, the cropper saves to
  <span class="mono">PATCH /api/auth/profile</span>, the build picker installs through <span class="mono">POST /api/modrinth/servers/:id/packages</span>.</div>
</div>`;

/* ------------------------------ write it out ------------------------------ */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zenith Panel - theme preview</title>
<style>
${css}
.preview-tabs { position: sticky; top: 0; z-index: 60; display: flex; gap: 8px; padding: 12px 20px; background: rgba(3,3,5,.92);
  backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.preview-tabs button { background: none; border: 1px solid var(--line); color: var(--fg-dim); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size: 13px; }
.preview-tabs button.active { color: #06060a; background: #fff; border-color: #fff; }
.preview-note { padding: 10px 20px; color: var(--fg-faint); font-size: 12.5px; }
.screen { display: none; }
.screen.active { display: block; }
.pv-wrap { padding: 18px 22px 40px; }
.pv-note { padding: 4px 2px 0; max-width: 900px; }
.pv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
.pv-card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); overflow: hidden; }
.pv-head { display: flex; flex-direction: column; gap: 2px; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.pv-frame { position: relative; padding: 14px; min-height: 250px; background: var(--bg); overflow: hidden; }
.pv-frame .overlay, .pv-frame .loading-overlay, .pv-frame .tour-box { position: absolute; }
.pv-frame .tour-ring { box-shadow: 0 0 0 9999px rgba(2,2,4,.62); }
.pv-frame .modal { width: 100%; }
.pv-frame .crop-stage { padding: 10px; }
</style>
</head>
<body>
<div class="preview-tabs">
  <button class="active" data-screen="servers">Servers page</button>
  <button data-screen="console">Server console page</button>
  <button data-screen="components">Shared components</button>
  <span class="tiny dim" style="align-self:center;margin-left:8px">static preview with sample data - inline CSS/SVG only, so it renders in a sandboxed iframe</span>
</div>
<div class="screen active" id="screen-servers">${serversScreen}</div>
<div class="screen" id="screen-console">${consoleScreen}</div>
<div class="screen" id="screen-components">${componentsScreen}</div>
<script>
  document.querySelectorAll('.preview-tabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.preview-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + b.dataset.screen));
  });
</script>
</body>
</html>`;

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview', 'theme.html'), html);
console.log(`wrote preview/theme.html (${(html.length / 1024).toFixed(1)} KB)`);
