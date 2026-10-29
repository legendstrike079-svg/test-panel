#!/usr/bin/env node
'use strict';
/**
 * Zenith Panel - headless UI test (optional).
 *
 * Renders every panel page (and every server/admin tab) in jsdom against a
 * running panel, clicks the real buttons and fails on any JavaScript error.
 * jsdom is NOT a dependency of the panel, install it on demand:
 *
 *   npm install --no-save jsdom
 *   node scripts/uitest.js --url http://localhost:8080 --user admin --pass secret
 *
 * Exit code 0 = all checks passed, 1 = failures, 2 = harness error.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  return fallback;
};
const BASE = (flag('url', process.env.ZENITH_URL || 'http://localhost:8080')).replace(/\/$/, '');
const USER = flag('user', process.env.ZENITH_USER || 'admin');
const PASS = flag('pass', process.env.ZENITH_PASS || '');
const PUB = path.join(__dirname, '..', 'public');

let JSDOM;
let VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (_) {
  try {
    ({ JSDOM, VirtualConsole } = require(path.join(process.cwd(), 'node_modules', 'jsdom')));
  } catch (_) {
    console.error('jsdom is required for the UI test:  npm install --no-save jsdom');
    process.exit(2);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`); }
};

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}) - pass --user/--pass`);
  return (await res.json()).token;
}

async function render(page, { script, serverId, token, wait = 2000 } = {}) {
  const html = fs.readFileSync(path.join(PUB, page), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  // jsdom cannot navigate between documents - pages that bounce (register
  // redirects when a session exists) would otherwise look like JS errors.
  vc.on('jsdomError', (e) => {
    if (/Not implemented: navigation/.test(e.message || '')) return;
    errors.push(`jsdom: ${e.message}`);
  });
  vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));
  const dom = new JSDOM(html, {
    url: `${BASE}/${page}${serverId ? `?id=${serverId}` : ''}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.fetch = (url, opts) => fetch(String(url).startsWith('http') ? url : `${BASE}${url}`, opts);
  window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} };
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.animate = () => ({ cancel() {} });
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
  window.localStorage.setItem('zenith_token', token);
  window.eval(fs.readFileSync(path.join(PUB, 'js/app.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(PUB, 'js/components.js'), 'utf8'));
  await sleep(120);
  window.eval(fs.readFileSync(path.join(PUB, 'js', script), 'utf8'));
  await sleep(wait);
  return { dom, window, errors, text: () => window.document.body.textContent.replace(/\s+/g, ' ') };
}

(async () => {
  const token = await login();
  const list = await (await fetch(`${BASE}/api/servers`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const serverId = list.servers[0] && list.servers[0].id;
  console.log(`Zenith UI test  ${BASE}  (${serverId || 'no server'})\n`);

  { /* dashboard */
    const { window, errors, text } = await render('dashboard.html', { script: 'dashboard.js', token, wait: 2500 });
    const t = text();
    check('dashboard: private fleet stat cards', /Accessible servers/.test(t) && /Players online/.test(t) && /RAM assigned/.test(t));
    check('dashboard: never embeds a console automatically', !/live output/.test(t) && !window.document.getElementById('dashTerminal'));
    check('dashboard: lists the user fleet with explicit console actions', /Your server list/.test(t) && window.document.querySelectorAll('a[href^="server.html?id="]').length >= 1);
    check('dashboard: no js errors', errors.length === 0, errors.join(' | '));
    void window;
  }

  { /* analytics */
    const { window, errors, text } = await render('analytics.html', { script: 'analytics.js', token, wait: 2500 });
    check('analytics: summary + charts', /CPU average/.test(text()) && window.document.querySelectorAll('#charts svg.chart').length >= 4);
    check('analytics: donut + activity', Boolean(window.document.querySelector('#fleetBody svg.donut')) && window.document.querySelectorAll('#activityBody .row').length >= 1);
    check('analytics: no js errors', errors.length === 0, errors.join(' | '));
  }

  { /* allocations */
    const { window, errors, text } = await render('allocations.html', { script: 'allocations.js', token, wait: 2000 });
    check('allocations: ports grid', /Ports tracked/.test(text()) && window.document.querySelectorAll('.alloc-port').length > 10);
    check('allocations: no js errors', errors.length === 0, errors.join(' | '));
  }

  { /* servers + create wizard */
    const { window, errors } = await render('servers.html', { script: 'servers.js', token, wait: 2000 });
    check('servers: list renders', window.document.querySelectorAll('.server-card, #serverGrid .card').length >= 1);
    window.document.getElementById('createBtn').click();
    await sleep(180);
    check('servers: admin sees Minecraft and Docker workload choices', Boolean(window.document.querySelector('[data-workload="minecraft"]') && window.document.querySelector('[data-workload="container"]')));
    window.document.querySelector('[data-workload="minecraft"]')?.click();
    await sleep(300);
    check('servers: Minecraft wizard opens with subdomain field', Boolean(window.document.querySelector('[name=subdomain]')));
    check('servers: wizard exposes the runtime choice', Boolean(window.document.querySelector('[name=backend]')));
    check('servers: no js errors', errors.length === 0, errors.join(' | '));
  }

  { /* server detail: every tab */
    const { window, errors } = await render('server.html', { script: 'server.js', token, serverId, wait: 2600 });
    const tabs = [...window.document.querySelectorAll('#serverTabs button')].map((b) => b.dataset.tab);
    check('server: tabs include players', tabs.includes('players'), tabs.join(','));
    const expect = {
      properties: /server\.properties|No server\.properties yet/i,
      worlds: /Worlds|No worlds on disk yet/i,
      sftp: /SFTP|sftp/i,
      players: /Online players|Nobody is online/i,
      network: /Join address \(subdomain\)/,
      settings: /Ports on this server/,
      backups: /backup/i,
      plugins: /Modrinth|Search/i,
      files: /folder|upload|root/i,
      schedules: /cron/i,
      people: /Subusers|Owner/i,
    };
    for (const [tab, re] of Object.entries(expect)) {
      const btn = window.document.querySelector(`#serverTabs button[data-tab="${tab}"]`);
      if (!btn) { check(`server: tab ${tab}`, false, 'missing'); continue; }
      btn.click();
      await sleep(tab === 'files' || tab === 'plugins' ? 1600 : 1200);
      const t = window.document.getElementById(`tab-${tab}`).textContent.replace(/\s+/g, ' ');
      check(`server: tab ${tab} renders`, re.test(t), t.slice(0, 110));
    }
    check('server: no js errors', errors.length === 0, errors.join(' | '));
  }

  { /* plugins vs mods tabs follow the server software */
    const { window, errors } = await render('server.html', { script: 'server.js', token, serverId, wait: 2600 });
    const list = await (await fetch(`${BASE}/api/servers`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const current = list.servers.find((x) => x.id === serverId) || {};
    const isModded = ['FABRIC', 'QUILT', 'FORGE', 'NEOFORGE'].includes(String(current.serverType || '').toUpperCase());
    const tabs = [...window.document.querySelectorAll('#serverTabs button')].map((b) => b.dataset.tab);
    check('server: plugin tab is shown for plugin software', isModded ? !tabs.includes('plugins') : tabs.includes('plugins'), tabs.join(','));
    check('server: mod tab follows the loader', isModded ? tabs.includes('mods') : !tabs.includes('mods'), tabs.join(','));
    const btn = window.document.querySelector(`#serverTabs button[data-tab="${isModded ? 'mods' : 'plugins'}"]`);
    if (btn) {
      btn.click();
      await sleep(2200);
      const suffix = isModded ? 'mod' : 'plugin';
      check(`server: ${suffix} manager renders its own ids`, Boolean(window.document.getElementById(`installedList-${suffix}`)));
      check(`server: ${suffix} manager has the build picker wiring`, Boolean(window.document.getElementById(`modSearchBtn-${suffix}`)));
    }
    check('server: no js errors with the mod manager', errors.length === 0, errors.join(' | '));
  }

  { /* components shared by every page */
    const { window, errors } = await render('dashboard.html', { script: 'dashboard.js', token, wait: 2200 });
    const doc = window.document;
    check('components: search + notifications live in the topbar', Boolean(doc.getElementById('gsBtn') && doc.getElementById('notifBtn')));
    check('components: notification badge element', Boolean(doc.getElementById('notifBadge')));
    doc.getElementById('gsBtn').click();
    await sleep(500);
    const input = doc.getElementById('gsInput');
    check('components: global search modal opens', Boolean(input));
    if (input) {
      input.value = 'servers';
      input.dispatchEvent(new window.Event('input'));
      await sleep(200);
      check('components: search returns page hits', doc.querySelectorAll('#gsResults .gs-item').length >= 1);
      const closer = doc.querySelector('.overlay.open [data-close]');
      if (closer) closer.click();
    }
    await sleep(200);
    window.Tutorial.start(0);
    await sleep(250);
    check('components: tutorial overlay renders a step', Boolean(doc.querySelector('#tourBox .tour-card')));
    window.Tutorial.stop();
    check('components: cropper/modal/dropdown exports', Boolean(window.Cropper && window.ModrinthVersionModal && window.searchableDropdown && window.versionGroups));
    check('components: no js errors', errors.length === 0, errors.join(' | '));
  }

  { /* admin */
    const { window, errors } = await render('admin.html', { script: 'admin.js', token, wait: 2200 });
    for (const tab of ['users', 'servers', 'settings', 'integrations', 'allocations', 'java', 'activity']) {
      const btn = window.document.querySelector(`[data-atab="${tab}"]`);
      if (!btn) { check(`admin: tab ${tab}`, false, 'missing'); continue; }
      btn.click();
      await sleep(tab === 'integrations' ? 2200 : 1500);
      const t = window.document.body.textContent.replace(/\s+/g, ' ');
      const expect = {
        users: /Panel users/, servers: /server/i, settings: /Panel settings/,
        integrations: /Subdomains \(DNS\)/, allocations: /Ports tracked/, java: /Java/i, activity: /activity/i,
      }[tab];
      check(`admin: tab ${tab} renders`, expect.test(t), t.slice(0, 120));
      if (tab === 'integrations') {
        check('admin: discord card + command list', /Discord bot/.test(t) && window.document.querySelectorAll('.cmd-ref div').length >= 10);
      }
    }
    check('admin: no js errors', errors.length === 0, errors.join(' | '));
  }

  { /* account + nodes */
    const acc = await render('account.html', { script: 'account.js', token, wait: 1800 });
    check('account: renders API keys card', /API keys/.test(acc.text()));
    check('account: no js errors', acc.errors.length === 0, acc.errors.join(' | '));
    const nodes = await render('nodes.html', { script: 'nodes.js', token, wait: 2000 });
    check('nodes: renders', /node/i.test(nodes.text()));
    check('nodes: shows the server runtime per node', /containers|processes/i.test(nodes.text()));
    check('nodes: docker card or the explicit unavailable notice', /Docker engine|Docker is not available/i.test(nodes.text()),
      nodes.text().replace(/\s+/g, ' ').slice(0, 110));
    check('nodes: health check button for admins', Boolean(nodes.window.document.querySelector('[data-health-node]')) || /Health check/.test(nodes.text()));
    check('nodes: no js errors', nodes.errors.length === 0, nodes.errors.join(' | '));

    const keys = await render('apikeys.html', { script: 'apikeys.js', token, wait: 1800 });
    check('apikeys: renders the keys table', /API key|Your keys/i.test(keys.text()));
    check('apikeys: shows a quick start snippet', /api\/servers/i.test(keys.text()));
    check('apikeys: no js errors', keys.errors.length === 0, keys.errors.join(' | '));

    const reg = await render('register.html', { script: 'register.js', token: '', wait: 1200 });
    check('register: explains that registration is closed (or shows the form)',
      /Registration is closed|Create account/i.test(reg.text()), reg.text().replace(/\s+/g, ' ').slice(0, 110));
    check('register: no js errors', reg.errors.length === 0, reg.errors.join(' | '));
  }

  console.log(failures ? `\n${failures} UI check(s) failed\n` : '\nAll UI checks passed.\n');
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error('HARNESS ERROR', err); process.exit(2); });
