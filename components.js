/* ==========================================================================
   Zenith Panel - shared UI components
   Ported from the JTG panel's component set (React -> vanilla JS):
     LoadingOverlay, NotificationsDropdown, GlobalSearchModal, TutorialOverlay,
     ImageCropper, SystemUpdateListener, SearchableDropdown,
     CategorizedVersionDropdown, ModrinthVersionModal.
   Loaded after js/app.js on every page.
   ========================================================================== */

/* ------------------------------ LoadingOverlay ------------------------------ */
const Loading = {
  el: null,
  show(text = 'Working...') {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'loading-overlay';
      this.el.innerHTML = `<div class="loading-card"><span class="spinner" style="width:22px;height:22px"></span><div id="loadingText">${esc(text)}</div></div>`;
      document.body.appendChild(this.el);
    }
    this.el.querySelector('#loadingText').textContent = text;
    this.el.classList.add('open');
  },
  text(t) { if (this.el) this.el.querySelector('#loadingText').textContent = t; },
  hide() { if (this.el) this.el.classList.remove('open'); },
  /** Wrap an async action so the overlay is always closed, even on errors. */
  async run(text, fn) {
    this.show(text);
    try { return await fn((t) => this.text(t)); } finally { this.hide(); }
  },
};

/* --------------------------- NotificationsDropdown -------------------------- */
const Notifications = {
  items: [],
  open: false,
  seen: Number(localStorage.getItem('zenith.notifSeen') || 0),

  async load() {
    try {
      const data = await API.get('/system/activity?limit=20');
      this.items = (data.activity || []).map((a) => ({
        at: a.at, action: a.action, actor: a.actor, detail: a.detail, serverName: a.serverName, serverId: a.serverId,
        level: /fail|error|delete|crash|suspend/i.test(a.action) ? 'red' : /start|install|create/i.test(a.action) ? 'green' : 'blue',
      }));
    } catch (_) { this.items = []; }
    this.paint();
    return this.items;
  },

  count() { return this.items.filter((i) => new Date(i.at).getTime() > this.seen).length; },

  paint() {
    const badge = document.getElementById('notifBadge');
    if (badge) {
      const n = this.count();
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.style.display = n ? '' : 'none';
    }
    const list = document.getElementById('notifList');
    if (!list) return;
    list.innerHTML = this.items.length
      ? this.items.map((i) => `
        <a class="notif-item" href="${i.serverId ? `server.html?id=${esc(i.serverId)}` : 'analytics.html'}">
          <span class="dot ${i.level}"></span>
          <span class="grow">
            <b>${esc(i.action)}</b>
            <span class="tiny dim">${esc([i.serverName, i.detail].filter(Boolean).join(' · ')).slice(0, 120)}</span>
          </span>
          <span class="tiny dim mono">${fmt.timeAgo(i.at)}</span>
        </a>`).join('')
      : UI.empty('No activity yet', 'Panel events show up here as they happen.');
  },

  mount() {
    const host = document.getElementById('notifHost');
    if (!host || host.dataset.ready) return;
    host.dataset.ready = '1';
    host.innerHTML = `
      <button class="btn icon ghost" id="notifBtn" title="Notifications">
        ${ICONS.analytics}
        <span class="badge red tiny" id="notifBadge" style="display:none;position:absolute;top:-4px;right:-4px;padding:0 5px">0</span>
      </button>
      <div class="dropdown" id="notifPanel">
        <div class="row between" style="padding:10px 12px;border-bottom:1px solid var(--line)">
          <b class="tiny">Notifications</b>
          <div class="row" style="gap:6px">
            <button class="btn ghost sm" id="notifReload">Reload</button>
            <button class="btn ghost sm" id="notifMark">Mark all read</button>
          </div>
        </div>
        <div id="notifList">${UI.skeleton(4)}</div>
      </div>`;
    host.querySelector('#notifBtn').onclick = (e) => {
      e.stopPropagation();
      const panel = host.querySelector('#notifPanel');
      this.open = !panel.classList.contains('open');
      panel.classList.toggle('open', this.open);
      if (this.open) this.load();
    };
    host.querySelector('#notifReload').onclick = (e) => { e.stopPropagation(); this.load(); };
    host.querySelector('#notifMark').onclick = (e) => {
      e.stopPropagation();
      this.seen = Date.now();
      localStorage.setItem('zenith.notifSeen', String(this.seen));
      this.paint();
    };
    host.querySelector('#notifPanel').onclick = (e) => e.stopPropagation();
    document.addEventListener('click', () => {
      this.open = false;
      const panel = host.querySelector('#notifPanel');
      if (panel) panel.classList.remove('open');
    });
    this.load();
    setInterval(() => this.load(), 60000);
  },
};

/* ---------------------------- GlobalSearchModal ----------------------------- */
const GlobalSearch = {
  index: [],

  async build() {
    const pages = [
      ['Dashboard', 'dashboard.html', 'overview, host load, quick console'], ['Analytics', 'analytics.html', 'charts, history, metrics'],
      ['Servers', 'servers.html', 'all instances'],
      ...(['admin', 'owner'].includes(store.user?.role) ? [['Create Server', 'servers.html#create', 'administrator provisioning']] : []),
      ['Nodes', 'nodes.html', 'hosts, docker, health'], ['Allocations', 'allocations.html', 'ports'],
      ['Account', 'account.html', 'profile, password, api keys'], ['API Keys', 'apikeys.html', 'tokens, curl, sftp'],
      ['Admin Servers', 'admin.html#servers', 'manage every server'], ['Admin Settings', 'admin.html', 'panel settings, users'],
    ].map(([title, href, sub]) => ({ group: 'Pages', title, sub, href }));
    let servers = [];
    try {
      const data = await API.get('/servers');
      servers = data.servers.map((s) => ({
        group: 'Servers', title: s.name, sub: `${s.serverType} ${s.version || ''} · ${s.status} · ${s.nodeName || 'local'}`,
        href: `server.html?id=${s.id}`, status: s.status,
      }));
    } catch (_) {}
    let nodes = [];
    try { nodes = (await API.get('/nodes')).nodes.map((n) => ({ group: 'Nodes', title: n.name, sub: `${n.fqdn || 'local'} · ${n.status}`, href: 'nodes.html' })); } catch (_) {}
    this.index = [...servers, ...nodes, ...pages];
    return this.index;
  },

  filter(q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return this.index.slice(0, 12);
    return this.index.filter((i) => `${i.title} ${i.sub} ${i.group}`.toLowerCase().includes(needle)).slice(0, 20);
  },

  openModal() {
    const m = UI.modal({
      title: 'Search',
      narrow: true,
      body: `
        <input type="search" id="gsInput" placeholder="Search servers, nodes, pages..." autocomplete="off">
        <div id="gsResults" class="mt"></div>
        <div class="tiny dim mt">Tip: press <span class="mono">Ctrl</span> + <span class="mono">K</span> anywhere in the panel.</div>`,
      footer: `<button class="btn" data-close>Close</button>`,
      onMount(root, { close }) {
        const input = root.querySelector('#gsInput');
        const list = root.querySelector('#gsResults');
        const paint = () => {
          const items = GlobalSearch.filter(input.value);
          list.innerHTML = items.length
            ? items.map((i, n) => `
              <a class="gs-item ${n === 0 ? 'active' : ''}" href="${i.href}">
                <span class="gs-group">${esc(i.group)}</span>
                <b>${esc(i.title)}</b>
                <span class="tiny dim">${esc(i.sub || '')}</span>
              </a>`).join('')
            : `<div class="tiny dim">nothing matched "${esc(input.value)}"</div>`;
        };
        input.addEventListener('input', paint);
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          const first = list.querySelector('a');
          if (first) location.href = first.getAttribute('href');
          close();
        });
        paint();
        setTimeout(() => input.focus(), 30);
      },
    });
    return m;
  },

  mount(hostId) {
    const host = document.getElementById(hostId || 'searchHost');
    if (!host) return;
    host.innerHTML = `<button class="btn icon ghost" id="gsBtn" title="Search (Ctrl+K)">${ICONS.search}</button>`;
    host.querySelector('#gsBtn').onclick = () => this.openModal();
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.openModal(); }
    });
    void this.build();
  },
};

/* ------------------------------ TutorialOverlay ----------------------------- */
const Tutorial = {
  steps: [
    { sel: '.nav', title: 'This is your panel', text: 'Servers, Nodes, Allocations, API Keys and the admin pages live here. The badge shows how many servers you can see.' },
    { sel: '[data-pill="servers"]', title: 'Your servers', text: 'Everything you own or can access. Administrators provision new servers and may assign you access.' },
    { sel: '#serverGrid, .content', title: 'Server cards', text: 'Each card shows the node, address, CPU, memory, storage and players straight from the host.' },
    { sel: '#pageActions', title: 'Page actions', text: 'Context actions for the page you are on (create, refresh, admin tools).' },
    { sel: '#notifHost', title: 'Notifications', text: 'Panel events - starts, crashes, installs, backups - arrive here.' },
    { sel: '.user-chip', title: 'Account', text: 'Profile, password, API keys and your tutorial can be replayed from the Account page.' },
  ],
  index: 0,

  start(from = 0) {
    this.index = from;
    localStorage.setItem('zenith.tutorialSeen', '1');
    this.paint();
  },

  paint() {
    const step = this.steps[this.index];
    if (!step) return this.stop();
    let target = document.querySelector(step.sel);
    if (!target) target = document.querySelector('.content');
    const r = target.getBoundingClientRect();
    let old = document.getElementById('tourBox');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'tourBox';
    box.className = 'tour-box';
    box.innerHTML = `
      <div class="tour-ring" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>
      <div class="tour-card" style="left:${Math.min(Math.max(16, r.left), window.innerWidth - 360)}px;top:${Math.min(r.bottom + 14, window.innerHeight - 190)}px">
        <div class="tiny dim">Step ${this.index + 1} of ${this.steps.length}</div>
        <h3 style="margin:4px 0 6px">${esc(step.title)}</h3>
        <div class="tiny" style="color:var(--fg-dim)">${esc(step.text)}</div>
        <div class="row between mt">
          <button class="btn ghost sm" id="tourSkip">Skip</button>
          <div class="row" style="gap:6px">
            ${this.index > 0 ? '<button class="btn sm" id="tourPrev">Back</button>' : ''}
            <button class="btn primary sm" id="tourNext">${this.index === this.steps.length - 1 ? 'Finish' : 'Next'}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.querySelector('#tourSkip').onclick = () => this.stop();
    const next = box.querySelector('#tourNext');
    next.onclick = () => { if (this.index === this.steps.length - 1) this.stop(); else { this.index += 1; this.paint(); } };
    const prev = box.querySelector('#tourPrev');
    if (prev) prev.onclick = () => { this.index -= 1; this.paint(); };
    const onResize = () => { window.removeEventListener('resize', onResize); this.paint(); };
    window.addEventListener('resize', onResize);
  },

  stop() {
    const box = document.getElementById('tourBox');
    if (box) box.remove();
    localStorage.setItem('zenith.tutorialSeen', '1');
  },

  maybeAutoStart() {
    if (localStorage.getItem('zenith.tutorialSeen')) return;
    if (!/dashboard|servers/.test(location.pathname)) return;
    setTimeout(() => this.start(0), 1200);
  },
};

/* -------------------------------- ImageCropper ------------------------------ */
/**
 * Square cropper for avatars: pick a file, drag/zoom in a canvas, get a
 * data-URL back. Pure canvas + pointer events, no dependency.
 */
const Cropper = {
  open({ size = 256, title = 'Crop image', onDone } = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) return UI.toast('Please pick an image under 6 MB', 'error');
      const reader = new FileReader();
      reader.onload = () => this.editor({ src: reader.result, size, title, onDone });
      reader.readAsDataURL(file);
    };
    input.click();
  },

  editor({ src, size, title, onDone }) {
    UI.modal({
      title,
      narrow: true,
      body: `
        <div class="crop-stage"><canvas id="cropCanvas" width="280" height="280"></canvas></div>
        <div class="row mt" style="gap:10px">
          <span class="tiny dim">Zoom</span>
          <input type="range" id="cropZoom" min="1" max="3" step="0.02" value="1" class="grow">
          <button class="btn sm" id="cropReset">Reset</button>
        </div>
        <div class="tiny dim mt">Drag the image to choose the part you want to keep - the result is a square PNG.</div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="cropUse">Use this image</button>`,
      onMount(root, { close }) {
        const canvas = root.querySelector('#cropCanvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        let zoom = 1; let ox = 0; let oy = 0; let dragging = null;
        const draw = () => {
          const w = canvas.width; const h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          const scale = Math.max(w / img.width, h / img.height) * zoom;
          const dw = img.width * scale; const dh = img.height * scale;
          const x = (w - dw) / 2 + ox; const y = (h - dh) / 2 + oy;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, x, y, dw, dh);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        };
        const clamp = () => {
          const w = canvas.width; const h = canvas.height;
          const scale = Math.max(w / img.width, h / img.height) * zoom;
          const maxX = Math.max(0, (img.width * scale - w) / 2);
          const maxY = Math.max(0, (img.height * scale - h) / 2);
          ox = Math.min(maxX, Math.max(-maxX, ox));
          oy = Math.min(maxY, Math.max(-maxY, oy));
        };
        img.onload = () => {
          const zoomEl = root.querySelector('#cropZoom');
          zoomEl.oninput = () => { zoom = Number(zoomEl.value); clamp(); draw(); };
          root.querySelector('#cropReset').onclick = () => { zoom = 1; ox = 0; oy = 0; zoomEl.value = '1'; draw(); };
          canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX - ox, y: e.clientY - oy }; canvas.setPointerCapture(e.pointerId); });
          canvas.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            ox = e.clientX - dragging.x; oy = e.clientY - dragging.y; clamp(); draw();
          });
          canvas.addEventListener('pointerup', () => { dragging = null; });
          draw();
        };
        img.onerror = () => UI.toast('That file could not be read as an image', 'error');
        img.src = src;

        root.querySelector('#cropUse').onclick = () => {
          const out = document.createElement('canvas');
          out.width = size; out.height = size;
          const octx = out.getContext('2d');
          const scale = Math.max(canvas.width / img.width, canvas.height / img.height) * zoom;
          const dw = img.width * scale; const dh = img.height * scale;
          const dx = (canvas.width - dw) / 2 + ox; const dy = (canvas.height - dh) / 2 + oy;
          const k = size / canvas.width;
          octx.imageSmoothingQuality = 'high';
          octx.drawImage(img, dx * k, dy * k, dw * k, dh * k);
          const dataUrl = out.toDataURL('image/png');
          close();
          if (onDone) onDone(dataUrl);
        };
      },
    });
  },
};

/* --------------------------- SystemUpdateListener --------------------------- */
const UpdateWatch = {
  latest: null,
  mount() {
    this.check();
    setInterval(() => this.check(), 6 * 60 * 60 * 1000); // every 6h
  },
  async check() {
    try {
      const data = await API.get('/system/update');
      this.latest = data;
      if (data.available) this.banner(data);
      const el = document.getElementById('updateBadge');
      if (el) {
        el.style.display = data.available ? '' : 'none';
        el.textContent = data.latestVersion || 'update';
      }
    } catch (_) {}
  },
  banner(data) {
    if (document.getElementById('updateBanner')) return;
    const box = document.createElement('div');
    box.id = 'updateBanner';
    box.className = 'banner-note';
    box.style.margin = '10px 22px 0';
    box.innerHTML = `${ICONS.info}<div class="grow"><b>A newer panel version is available (${esc(data.latestVersion || '?')})</b>
      <div class="tiny dim">${esc(data.notes || 'Run the update command on the host to upgrade.')}</div></div>
      <button class="btn sm" id="updateHow">How to update</button>`;
    const main = document.querySelector('.main');
    if (!main) return;
    main.insertBefore(box, main.querySelector('.content'));
    box.querySelector('#updateHow').onclick = () => UI.modal({
      title: 'Update this panel',
      narrow: true,
      body: `<p class="muted" style="margin:0">From the panel directory on the host:</p>
        <div class="dns-record mt">bash install.sh --update</div>
        <div class="tiny dim mt">That pulls the source, reinstalls dependencies and restarts the service. Your data, servers and backups are untouched.</div>`,
      footer: '<button class="btn primary" data-close>Got it</button>',
    });
  },
};

/* ---------------------------- dropdown components --------------------------- */
/**
 * Searchable single-select. Returns the element; call `el.value` for the value.
 * `options`: [{ value, label, hint }] - or { group: 'Name', items: [...] } groups
 * (that is the "categorized" variant JTG uses for versions).
 */
function searchableDropdown({ id, options = [], value = '', placeholder = 'Select...', onChange }) {
  const flat = [];
  for (const o of options) {
    if (o && o.group) for (const item of o.items) flat.push({ ...item, group: o.group });
    else flat.push(o);
  }
  const wrap = document.createElement('div');
  wrap.className = 'sd';
  wrap.dataset.value = value;
  const label = (flat.find((o) => o.value === value) || {}).label || placeholder;
  wrap.innerHTML = `
    <button type="button" class="sd-btn" id="${id || ''}">${esc(label)}<span class="sd-caret">${ICONS.plus}</span></button>
    <div class="sd-panel">
      <input type="search" class="sd-search" placeholder="Filter...">
      <div class="sd-list"></div>
    </div>`;
  const panel = wrap.querySelector('.sd-panel');
  const list = wrap.querySelector('.sd-list');
  const btn = wrap.querySelector('.sd-btn');
  const paint = (q = '') => {
    const needle = q.trim().toLowerCase();
    const items = flat.filter((o) => !needle || `${o.label} ${o.value} ${o.group || ''}`.toLowerCase().includes(needle));
    let lastGroup = null;
    list.innerHTML = items.length ? items.map((o, i) => {
      const head = o.group && o.group !== lastGroup ? `<div class="sd-group">${esc(o.group)}</div>` : '';
      lastGroup = o.group || lastGroup;
      return `${head}<button type="button" data-val="${esc(o.value)}" class="sd-item ${o.value === wrap.dataset.value ? 'active' : ''}" data-i="${i}">
        <span>${esc(o.label)}</span>${o.hint ? `<span class="tiny dim">${esc(o.hint)}</span>` : ''}</button>`;
    }).join('') : '<div class="tiny dim" style="padding:8px 10px">nothing matched</div>';
    list.querySelectorAll('[data-val]').forEach((b) => b.onclick = () => {
      wrap.dataset.value = b.dataset.val;
      const picked = flat.find((o) => o.value === b.dataset.val) || {};
      btn.textContent = picked.label || placeholder;
      panel.classList.remove('open');
      if (onChange) onChange(picked.value, picked);
    });
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll('.sd-panel.open').forEach((p) => { if (p !== panel) p.classList.remove('open'); });
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      const s = wrap.querySelector('.sd-search');
      s.value = ''; paint(''); setTimeout(() => s.focus(), 20);
    }
  };
  wrap.querySelector('.sd-search').oninput = (e) => paint(e.target.value);
  document.addEventListener('click', () => panel.classList.remove('open'));
  panel.onclick = (e) => e.stopPropagation();
  paint();
  return wrap;
}

/** Versions grouped into Stable / Pre-release / Other - JTG's categorized list. */
function versionGroups(versions = [], current = '') {
  const stable = []; const pre = []; const other = [];
  for (const v of versions) {
    const id = typeof v === 'string' ? v : v.id;
    const entry = { value: id, label: id, hint: id === current ? 'current' : '' };
    if (/snapshot|pre|rc|alpha|beta/i.test(id)) pre.push(entry);
    else if (/^\d+(\.\d+)*$/.test(id)) stable.push(entry);
    else other.push(entry);
  }
  return [
    { group: 'Stable releases', items: stable },
    { group: 'Snapshots & pre-releases', items: pre },
    ...(other.length ? [{ group: 'Other', items: other }] : []),
  ].filter((g) => g.items.length);
}

/* --------------------------- ModrinthVersionModal --------------------------- */
/**
 * Pick a build of a Modrinth project before installing it.
 * @param {object} project - { projectId, title, slug, icon }
 * @param {string} serverId
 * @param {Function} onInstalled
 */
const ModrinthVersionModal = {
  async open(project, serverId, onInstalled, { type = '' } = {}) {
    let versions = [];
    const m = UI.modal({
      title: `Install ${project.title || project.slug || project.projectId}`,
      body: `<div class="row between" style="gap:10px">
          <select id="mvChannel" style="max-width:170px">
            <option value="">All channels</option>
            <option value="release">Release</option>
            <option value="beta">Beta</option>
            <option value="alpha">Alpha</option>
          </select>
          <input type="search" id="mvFilter" placeholder="filter by game version..." style="max-width:220px">
          <div class="grow"></div>
          <span class="badge tiny" id="mvCount">loading...</span>
        </div>
        <div id="mvList" class="mt">${UI.spinner(16)} <span class="dim tiny">asking Modrinth for builds...</span></div>`,
      wide: true,
      footer: `<button class="btn" data-close>Cancel</button>`,
      onMount(root, { close }) {
        const listEl = root.querySelector('#mvList');
        const paint = () => {
          const channel = root.querySelector('#mvChannel').value;
          const needle = root.querySelector('#mvFilter').value.trim().toLowerCase();
          const shown = versions.filter((v) => (!channel || v.channel === channel)
            && (!needle || (v.gameVersions || []).some((g) => g.toLowerCase().includes(needle))));
          root.querySelector('#mvCount').textContent = `${shown.length} build(s)`;
          listEl.innerHTML = shown.length ? shown.slice(0, 60).map((v) => `
            <div class="row between" style="padding:9px 4px;border-bottom:1px solid var(--line-subtle)">
              <div class="stack" style="gap:3px">
                <div class="row" style="gap:8px"><b class="mono">${esc(v.versionNumber)}</b>
                  <span class="badge tiny ${v.channel === 'release' ? 'green' : v.channel === 'beta' ? 'yellow' : ''}">${esc(v.channel)}</span>
                  <span class="tiny dim">${esc((v.loaders || []).join(', '))}</span></div>
                <div class="tiny dim">for ${esc((v.gameVersions || []).slice(0, 6).join(', '))} · ${v.downloads || 0} downloads · ${fmt.timeAgo(v.datePublished)}</div>
                ${v.changelog ? `<div class="tiny dim" style="max-height:34px;overflow:hidden">${esc(String(v.changelog).replace(/[#*`>]/g, '').slice(0, 160))}</div>` : ''}
              </div>
              <button class="btn sm primary" data-install="${esc(v.id)}">${ICONS.download} Install</button>
            </div>`).join('') : `<div class="tiny dim">No build matches those filters.</div>`;
          listEl.querySelectorAll('[data-install]').forEach((b) => b.onclick = async () => {
            const versionId = b.dataset.install;
            b.disabled = true; b.innerHTML = `${UI.spinner(13)} Installing...`;
            try {
              const res = await API.post(`/modrinth/servers/${serverId}/packages`, {
                projectId: project.projectId, versionId, projectType: type || undefined,
              });
              UI.toast(res.message || 'Installed', 'success');
              close();
              if (onInstalled) onInstalled(res);
            } catch (err) {
              UI.toast(err.message, 'error');
              b.disabled = false; b.innerHTML = `${ICONS.download} Install`;
            }
          });
        };
        (async () => {
          try {
            const data = await API.get(`/modrinth/versions/${encodeURIComponent(project.projectId)}`);
            versions = data.versions || [];
            paint();
          } catch (err) {
            listEl.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>Modrinth did not answer: ${esc(err.message)}</div></div>`;
          }
        })();
        root.querySelector('#mvChannel').onchange = paint;
        root.querySelector('#mvFilter').oninput = paint;
      },
    });
    return m;
  },
};

/* --------------------------------- mount all -------------------------------- */
function mountComponents() {
  // header slots (created by Layout.render for every page)
  const topRight = document.querySelector('.topbar .row[style*="gap:8px"]');
  if (topRight && !document.getElementById('searchHost')) {
    const searchHost = document.createElement('span');
    searchHost.id = 'searchHost';
    const notifHost = document.createElement('span');
    notifHost.id = 'notifHost';
    notifHost.style.position = 'relative';
    topRight.insertBefore(searchHost, topRight.firstChild);
    topRight.insertBefore(notifHost, searchHost.nextSibling);
  }
  GlobalSearch.mount('searchHost');
  Notifications.mount();
  UpdateWatch.mount();
  Tutorial.maybeAutoStart();
  const replay = document.getElementById('replayTutorial');
  if (replay) replay.onclick = () => Tutorial.start(0);
}

document.addEventListener('zenith:ready', mountComponents);
window.addEventListener('DOMContentLoaded', () => setTimeout(mountComponents, 600));

window.Loading = Loading;
window.Notifications = Notifications;
window.GlobalSearch = GlobalSearch;
window.Tutorial = Tutorial;
window.Cropper = Cropper;
window.UpdateWatch = UpdateWatch;
window.searchableDropdown = searchableDropdown;
window.versionGroups = versionGroups;
window.ModrinthVersionModal = ModrinthVersionModal;
