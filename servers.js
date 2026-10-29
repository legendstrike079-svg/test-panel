/* Servers list + create-server wizard */
(async function () {
  const grid = document.getElementById('serverGrid');
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const sortSelect = document.getElementById('sortSelect');
  let catalogue = null;
  let versionCache = {};

  try { await bootstrap({ active: 'servers.html' }); } catch (_) { return; }

  const canCreate = () => ['admin', 'owner'].includes(store.user?.role);
  Layout.title('Servers', 'all instances you can access');
  Layout.actions(canCreate() ? `<button class="btn sm primary" id="createBtn">${ICONS.plus} Create server</button>` : '');
  document.getElementById('createBtn')?.addEventListener('click', openCreate);
  document.getElementById('refreshBtn').onclick = () => load();

  /* layout switch: 1 / 2 / 3 columns, remembered per browser */
  const viewToggle = document.getElementById('viewToggle');
  function setView(n) {
    grid.classList.remove('cards-1', 'cards-2', 'cards-3');
    grid.classList.add(`cards-${n}`);
    viewToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === String(n)));
    try { localStorage.setItem('zenith.serverView', String(n)); } catch (_) {}
  }
  viewToggle.querySelectorAll('button').forEach((b) => b.onclick = () => setView(Number(b.dataset.view)));
  try { setView(Number(localStorage.getItem('zenith.serverView')) || 2); } catch (_) { setView(2); }

  async function load() {
    const params = new URLSearchParams();
    if (searchInput.value) params.set('search', searchInput.value);
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (sortSelect.value) params.set('sort', sortSelect.value);
    params.set('withUsage', 'disk');
    try {
      const data = await API.get(`/servers?${params}`);
      Layout.setServerCount(data.total);
      render(data);
    } catch (err) {
      grid.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`;
    }
  }

  /* Deterministic "mini world" banner: pure inline SVG (works offline and in
     sandboxed previews). Colours come from the server type, shape from its id. */
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
    GAME: ['#fb923c', '#f97316', '#facc15', '#4a2d1c'],
  };
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function bannerArt(s) {
    const seed = hash(s.id + s.name);
    const [a, b, c, sky] = TYPE_COLORS[s.serverType] || ['#8fb8f0', '#7f8ce0', '#f0d9a8', '#2b3550'];
    const rnd = (n) => ((seed >> (n * 3)) % 1000) / 1000;
    const W = 400; const H = 132;
    const clouds = [0, 1].map((i) => {
      const cx = 40 + rnd(i) * (W - 120); const cy = 18 + rnd(i + 4) * 44; const w = 46 + rnd(i + 7) * 62;
      return `<g opacity="${0.24 + rnd(i + 2) * 0.22}"><rect x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" width="${w.toFixed(0)}" height="9" rx="2" fill="#ffffff"/><rect x="${(cx + 12).toFixed(0)}" y="${(cy - 8).toFixed(0)}" width="${(w * 0.5).toFixed(0)}" height="9" rx="2" fill="#ffffff"/></g>`;
    }).join('');
    const hills = [0, 1, 2].map((i) => {
      const y = 78 + i * 17 + rnd(i + 1) * 8;
      return `<polygon points="0,${H} ${W * 0.18},${(y - 22).toFixed(0)} ${W * 0.42},${H} ${W},${H} ${W},${H}" fill="${i === 0 ? a : i === 1 ? b : c}" opacity="${0.42 - i * 0.08}"/>`;
    }).join('');
    const blocks = Array.from({ length: 7 }, (_, i) => {
      const bx = 22 + i * 51 + Math.round(rnd(i + 3) * 14); const by = 96 + Math.round(rnd(i + 5) * 22);
      return `<rect x="${bx}" y="${by}" width="17" height="17" rx="3" fill="${i % 2 ? b : a}" opacity="0.5"/>`;
    }).join('');
    return `<svg class="art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sky-${esc(s.id)}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${sky}" stop-opacity="0.92"/><stop offset="100%" stop-color="#05060c" stop-opacity="0.95"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#sky-${esc(s.id)})"/>
      <g opacity="0.5">${Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${i * 11}" width="${W}" height="1" fill="#ffffff" opacity="0.03"/>`).join('')}</g>
      ${clouds}${hills}${blocks}
    </svg>`;
  }

  const STATUS_LABEL = { running: 'Running', starting: 'Starting', installing: 'Installing', stopping: 'Stopping', offline: 'Offline', crashed: 'Crashed', suspended: 'Suspended' };

  function tile(label, value, { icon = '', cls = '' } = {}) {
    return `<div class="srv-tile ${cls}"><div class="k">${icon}${esc(label)}</div><div class="v" title="${esc(String(value))}">${esc(String(value))}</div></div>`;
  }

  function card(s) {
    const stats = s.stats || {};
    const cpu = Number(stats.cpu || 0);
    const memPretty = stats.memoryPretty || (stats.memoryBytes ? fmt.bytes(stats.memoryBytes) : '0 B');
    const diskPretty = s.disk && s.disk.bytes ? s.disk.pretty : 'not measured';
    const diskLimitMb = s.diskLimit ? s.diskLimit : null;
    const diskWarn = diskLimitMb && s.disk && s.disk.bytes > diskLimitMb * 1048576 * 0.9;
    const host = location.hostname || 'this host';
    const addr = `${s.playit && s.playit.publicAddress ? s.playit.publicAddress : `${host}:${s.port}`}`;
    const typeLabel = s.workloadType === 'game' ? `${s.gameName || 'Dedicated game'} · SteamCMD ${s.gameAppId || ''}` : `${s.serverType} ${s.version || ''}`;
    return `<div class="card srv-card server-card" data-id="${s.id}">
      <div class="srv-banner">
        ${bannerArt(s)}
        <span class="srv-type"><i class="dot" style="background:${(TYPE_COLORS[s.serverType] || ['#8fb8f0'])[0]}"></i>${esc(typeLabel)}</span>
        <span class="srv-pill ${esc(s.status)}"><i></i>${esc(STATUS_LABEL[s.status] || s.status)}</span>
        <div class="banner-title">
          <b><a href="server.html?id=${s.id}">${esc(s.name)}</a></b>
          <span>${esc(s.nodeName || 'Local Node')} · ${s.players || 0}/${s.maxPlayers || 20} online${s.backend ? ` · ${esc(s.backend)}` : ''}</span>
        </div>
      </div>
      <div class="srv-body">
        <div class="srv-tiles">
          ${tile('Node', s.nodeName || 'Local Node', { icon: ICONS.node })}
          ${tile('Address', addr, { icon: ICONS.globe })}
          ${tile('CPU usage', `${cpu.toFixed(1)}%`, { icon: ICONS.analytics, cls: cpu > 80 ? 'warn' : 'blue' })}
          ${tile('Memory', memPretty, { icon: ICONS.chip })}
          ${tile('Storage', diskPretty, { icon: ICONS.folder, cls: diskWarn ? 'warn' : '' })}
          ${tile('Players', `${s.players || 0} / ${s.maxPlayers || 20}`, { icon: ICONS.users2 })}
        </div>
        <div class="srv-foot">
          ${s.perms.console ? (s.status === 'running'
            ? `<button class="btn sm" data-power="restart" data-id="${s.id}" title="Restart">${ICONS.restart}</button>
               <button class="btn sm red" data-power="stop" data-id="${s.id}" title="Stop">${ICONS.stop}</button>`
            : `<button class="btn sm green" data-power="start" data-id="${s.id}" title="Start" ${s.status === 'installing' ? 'disabled' : ''}>${ICONS.play}</button>`) : ''}
          <span class="tiny dim" style="margin-left:2px">${s.uptime ? `up ${fmt.duration(s.uptime)}` : (s.status === 'offline' ? 'stopped' : esc(s.status))}</span>
          <div class="grow"></div>
          ${s.packages ? `<span class="chip">${s.packages} add-on${s.packages === 1 ? '' : 's'}</span>` : ''}
          <a class="btn sm" href="server.html?id=${s.id}">${ICONS.terminal} Console</a>
        </div>
      </div>
    </div>`;
  }

  function render(data) {
    const fleet = document.getElementById('fleetLine');
    if (fleet) {
      const mem = data.servers.reduce((n, s) => n + Number((s.stats && s.stats.memoryBytes) || 0), 0);
      fleet.textContent = data.servers.length
        ? `${data.servers.length} server(s) · ${data.running} running · ${fmt.bytes(mem)} in use right now`
        : '';
    }
    if (!data.servers.length) {
      const message = canCreate()
        ? 'Create a Minecraft server, a supported dedicated game, or an isolated Docker workload to get started.'
        : 'Ask an administrator to create a server and assign you access.';
      grid.innerHTML = `<div style="grid-column:1/-1">${UI.empty('No servers found', message)}</div>`;
      return;
    }
    grid.innerHTML = data.servers.map(card).join('');
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-power]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await API.post(`/servers/${btn.dataset.id}/${btn.dataset.power}`);
      UI.toast(`${btn.dataset.power} requested`, 'success');
      setTimeout(load, 1500);
    } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; }
  });

  let debounce;
  [searchInput, statusFilter, sortSelect].forEach((el) => el.addEventListener('input', () => {
    clearTimeout(debounce); debounce = setTimeout(load, 250);
  }));

  /* ------------------------------ create wizard ------------------------------ */
  function openCreate() {
    if (!canCreate()) {
      UI.toast('Only an administrator can create servers.', 'error');
      return;
    }
    UI.modal({
      title: 'Create a workload',
      narrow: true,
      body: `<div class="workload-chooser"><span class="eyebrow">Provisioning</span><h2>What do you want to create?</h2><p>Choose Minecraft, a supported SteamCMD dedicated game, or an isolated Docker workload. Dedicated games use audited SteamCMD templates. Linux workspaces provide SSHX, while Python and Node.js templates are managed bot runtimes with app logs and a controlled startup file.</p><div class="workload-choice-grid"><button class="workload-choice" data-workload="minecraft"><span class="workload-choice-icon blue">${ICONS.servers}</span><span><b>Minecraft server</b><small>Paper, Fabric, Forge and other supported distributions with an upstream version picker.</small></span><i>${ICONS.play}</i></button><button class="workload-choice" data-workload="game"><span class="workload-choice-icon orange">${ICONS.play}</span><span><b>Dedicated game server</b><small>SteamCMD-backed Rust, ARK, Palworld, CS2, Valheim, Factorio and other audited templates.</small></span><i>${ICONS.play}</i></button><button class="workload-choice" data-workload="container"><span class="workload-choice-icon violet">${ICONS.container}</span><span><b>Docker container</b><small>Ubuntu/Debian workspaces or managed Python/Node.js bot runtimes.</small></span><i>${ICONS.play}</i></button></div></div>`,
      footer: '<button class="btn" data-close>Cancel</button>',
      onMount(root, { close }) {
        root.querySelectorAll('[data-workload]').forEach((button) => button.onclick = () => {
          const kind = button.dataset.workload; close();
          if (kind === 'container') openContainerCreate(); else if (kind === 'game') openGameCreate(); else openMinecraftCreate();
        });
      },
    });
  }

  async function openMinecraftCreate() {
    if (!canCreate()) return UI.toast('Only an administrator can create servers.', 'error');
    try { catalogue = catalogue || await API.get('/system/catalogue'); }
    catch (err) { UI.toast(`Could not load the server catalogue: ${err.message}`, 'error'); return; }

    const isAdmin = ['admin', 'owner'].includes(store.user?.role);
    const stepLabels = ['Details', 'Version', 'Review'];
    const state = {
      step: 1, busy: false, loadingVersions: false, versionError: '',
      name: '', description: '', serverType: 'PAPER', version: '', versions: [],
      memory: catalogue.defaultMemory || 2048, diskLimit: 0, cpuLimit: 0, maxPlayers: 20,
      port: '', ip: '', subdomain: '', ownerId: store.user?.id || '',
      eulaAccepted: false, autoStart: true, install: true, nodeId: 'local', backend: '',
    };
    let nodes = [{ id: 'local', name: 'Local node', local: true, status: 'online', backend: 'process' }];
    let owners = [{ id: store.user?.id || '', username: store.user?.username || 'You', role: store.user?.role || 'user' }];
    try {
      const res = await API.get('/nodes');
      nodes = res.nodes || nodes;
      const available = nodes.filter((n) => n.status !== 'offline');
      state.nodeId = (available.find((n) => n.id === 'local') || available[0] || nodes[0]).id;
    } catch (_) { /* non-admins can still create on the local node */ }
    if (isAdmin) {
      try {
        const res = await API.get('/users');
        owners = (res.users || []).filter((user) => !user.suspended);
      } catch (err) { UI.toast(`Could not load owner accounts: ${err.message}`, 'warn'); }
    }

    UI.modal({
      title: 'New Minecraft server', wide: true,
      body: `<section class="create-wizard" id="createWizard">
        <div class="create-wizard-top"><div><span class="eyebrow">Provisioning</span><h2>Create a server</h2><p>Set the server limits, select the exact upstream version, then confirm the installation.</p></div><span class="wizard-counter" id="wizCounter">Step 1 of 3</span></div>
        <nav class="wizard-steps three" id="wizSteps" aria-label="Server creation steps"></nav>
        <div class="wizard-panel" id="wizBody"></div>
      </section>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="wizPrev">Back</button><button class="btn primary" id="wizNext">Continue</button>`,
      onMount(root, { close }) {
        const body = root.querySelector('#wizBody');
        const next = root.querySelector('#wizNext');
        const prev = root.querySelector('#wizPrev');
        const owner = () => owners.find((user) => user.id === state.ownerId) || owners[0] || { username: 'Unknown user' };
        const node = () => nodes.find((n) => n.id === state.nodeId) || nodes[0] || { name: 'Local node', backend: 'process' };
        const type = () => catalogue.types.find((t) => t.id === state.serverType) || catalogue.types[0];
        const value = (name) => body.querySelector(`[name="${name}"]`);

        prev.onclick = () => { if (!state.busy && state.step > 1) { state.step -= 1; paint(); } };
        next.onclick = () => advance();
        paint();

        function readDetails() {
          const name = value('name');
          const nextType = value('serverType')?.value || state.serverType;
          state.name = name?.value.trim() || state.name;
          state.description = value('description')?.value.trim() || '';
          state.memory = Math.max(256, parseInt(value('memory')?.value, 10) || 2048);
          state.diskLimit = Math.max(0, parseInt(value('diskLimit')?.value, 10) || 0);
          state.cpuLimit = Math.max(0, parseInt(value('cpuLimit')?.value, 10) || 0);
          state.maxPlayers = Math.max(1, parseInt(value('maxPlayers')?.value, 10) || 20);
          state.port = value('port')?.value.trim() || '';
          state.ip = value('ip')?.value.trim() || '';
          state.subdomain = value('subdomain')?.value.trim() || '';
          state.eulaAccepted = Boolean(value('eula')?.checked);
          state.autoStart = Boolean(value('autoStart')?.checked);
          if (value('ownerId')) state.ownerId = value('ownerId').value;
          if (value('nodeId')) state.nodeId = value('nodeId').value;
          if (value('backend')) state.backend = value('backend').value;
          if (nextType !== state.serverType) {
            state.serverType = nextType; state.version = ''; state.versions = []; state.versionError = '';
          }
          if (!state.name) { UI.toast('Give your server a name before continuing', 'error'); name?.focus(); return false; }
          if (state.name.length > 60) { UI.toast('Server name must be 60 characters or fewer', 'error'); return false; }
          if (state.description.length > 500) { UI.toast('Description must be 500 characters or fewer', 'error'); return false; }
          if (!state.eulaAccepted) { UI.toast('Accept the Minecraft EULA before creating a server', 'warn'); return false; }
          return true;
        }

        async function loadVersions(force = false) {
          if (!force && versionCache[state.serverType]) {
            state.versions = versionCache[state.serverType];
            state.version = state.version || state.versions[0]?.id || '';
            return;
          }
          state.versionError = '';
          try {
            const data = await API.get(`/system/versions/${state.serverType}`);
            state.versions = Array.isArray(data.versions) ? data.versions : [];
            versionCache[state.serverType] = state.versions;
            state.version = data.latest || state.versions[0]?.id || '';
            if (!state.version) state.versionError = 'The upstream did not return any selectable versions.';
          } catch (err) {
            state.versions = []; state.version = '';
            state.versionError = `Could not load versions for ${state.serverType}: ${err.message}`;
          }
        }

        async function advance() {
          if (state.busy) return;
          if (state.step === 1 && !readDetails()) return;
          if (state.step === 3) { submit(); return; }
          if (state.step === 2 && !state.version) { UI.toast('Select a server version before reviewing', 'warn'); return; }
          state.busy = true;
          if (state.step === 1) {
            state.step = 2;
            state.loadingVersions = true;
            paint(); // Version is painted before its provider request can resolve.
            await loadVersions();
            state.loadingVersions = false;
          } else state.step = 3;
          state.busy = false;
          paint();
        }

        function stepNav() {
          root.querySelector('#wizCounter').textContent = `Step ${state.step} of ${stepLabels.length}`;
          root.querySelector('#wizSteps').innerHTML = stepLabels.map((label, i) => {
            const number = i + 1;
            const status = number < state.step ? 'done' : number === state.step ? 'active' : '';
            return `<button type="button" class="wizard-step ${status}" data-step="${number}" ${number > state.step || state.busy ? 'disabled' : ''}><i>${number < state.step ? ICONS.check : number}</i><span>${label}</span></button>`;
          }).join('');
          root.querySelectorAll('[data-step]').forEach((button) => button.onclick = () => { if (!state.busy) { state.step = Number(button.dataset.step); paint(); } });
          prev.style.visibility = state.step === 1 ? 'hidden' : '';
          prev.disabled = state.busy;
          next.disabled = state.busy || (state.step === 2 && (state.loadingVersions || !state.version));
          next.textContent = state.step === 1 ? 'Choose version' : state.step === 2 ? 'Review server' : 'Create server';
        }

        function detailPage() {
          const ownerField = isAdmin
            ? `<label class="field">Owner<select name="ownerId">${owners.map((user) => `<option value="${esc(user.id)}" ${user.id === state.ownerId ? 'selected' : ''}>${esc(user.username)} · ${esc(user.role || 'user')}</option>`).join('')}</select><span class="hint">The account that owns this server.</span></label>`
            : `<label class="field">Owner<input value="${esc(owner().username)}" disabled><span class="hint">Servers you create belong to you.</span></label>`;
          const ipField = isAdmin
            ? `<label class="field">IP address <span class="field-optional">Optional</span><input name="ip" value="${esc(state.ip)}" placeholder="Automatic · 0.0.0.0"><span class="hint">Admin-managed bind address; editable later.</span></label>`
            : `<label class="field">IP allocation<input value="Automatic allocation" disabled><span class="hint">An administrator may set a bind IP later.</span></label>`;
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon">${ICONS.servers}</span><div><h3>Server details</h3><p>Set ownership and hard resource limits before choosing the Minecraft version.</p></div></div>
            <div class="create-field-grid">
              <label class="field field-wide">Server name<input name="name" placeholder="Survival SMP" value="${esc(state.name)}" maxlength="60" autofocus><span class="hint">Visible to everyone with access to this server.</span></label>
              <label class="field field-wide">Description <span class="field-optional">Optional</span><textarea name="description" maxlength="500" placeholder="A short description for your players">${esc(state.description)}</textarea><span class="hint">Shown on server cards and in Administration.</span></label>
              <label class="field">Server software<select name="serverType">${catalogue.types.map((software) => `<option value="${esc(software.id)}" ${software.id === state.serverType ? 'selected' : ''}>${esc(software.name)} — ${esc(software.description)}</option>`).join('')}</select><span class="hint">Choose the distribution before versions load.</span></label>
              ${ownerField}
              <label class="field">RAM<input type="number" name="memory" value="${state.memory}" min="256" step="256"><span class="hint">MB memory limit</span></label>
              <label class="field">Disk<input type="number" name="diskLimit" value="${state.diskLimit}" min="0" step="1024"><span class="hint">MB · 0 means no panel limit</span></label>
              <label class="field">CPU<input type="number" name="cpuLimit" value="${state.cpuLimit}" min="0" step="10"><span class="hint">Percent · 0 means no panel limit</span></label>
              <label class="field">Max players<input type="number" name="maxPlayers" value="${state.maxPlayers}" min="1" max="1000"><span class="hint">Player cap</span></label>
              ${ipField}
              <label class="field">Port <span class="field-optional">Optional</span><input type="number" name="port" value="${state.port}" placeholder="Auto allocate" min="1024" max="65535"><span class="hint">Leave blank to allocate automatically.</span></label>
              <label class="field">Subdomain <span class="field-optional">Optional</span><input name="subdomain" value="${esc(state.subdomain)}" placeholder="survival" maxlength="40"><span class="hint">Created when DNS is configured by an admin.</span></label>
              ${nodes.length > 1 ? `<label class="field">Node<select name="nodeId">${nodes.map((n) => `<option value="${esc(n.id)}" ${n.id === state.nodeId ? 'selected' : ''}>${esc(n.name)} · ${esc(n.status || 'unknown')}</option>`).join('')}</select></label>` : ''}
              <label class="field ${nodes.length > 1 ? '' : 'field-wide'}">Runtime<select name="backend"><option value="" ${state.backend ? '' : 'selected'}>Use ${esc(node().name)} default (${esc(node().backend || 'process')})</option><option value="docker" ${state.backend === 'docker' ? 'selected' : ''}>Docker container — isolated and resource-limited</option><option value="process" ${state.backend === 'process' ? 'selected' : ''}>Java process — direct on the node</option></select></label>
            </div>
            <div class="wizard-toggles"><label class="checkbox wizard-check"><input type="checkbox" name="eula" ${state.eulaAccepted ? 'checked' : ''}><span><b>I accept the Minecraft EULA</b><small>Required before the server may start.</small></span></label><label class="checkbox wizard-check"><input type="checkbox" name="autoStart" ${state.autoStart ? 'checked' : ''}><span><b>Start automatically</b><small>Start after installation and restore it after a panel restart.</small></span></label></div>
          </div>`;
        }

        function versionPage() {
          const cards = state.versions.map((version) => `<button type="button" class="version-card ${version.id === state.version ? 'active' : ''}" data-version="${esc(version.id)}"><span>${esc(version.id)}</span>${version.id === state.version ? ICONS.check : ''}</button>`).join('');
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon blue">${ICONS.star}</span><div><h3>Choose ${esc(type()?.name || state.serverType)} version</h3><p>Versions are loaded directly from the selected software provider.</p></div></div>
            <div class="version-toolbar"><span class="badge blue">${esc(state.serverType)}</span>${state.version ? `<span class="tiny dim">Selected <b class="mono">${esc(state.version)}</b></span>` : '<span class="tiny dim">Select a version to continue</span>'}<input type="search" id="versionSearch" placeholder="Filter versions…" ${state.loadingVersions ? 'disabled' : ''}></div>
            <div class="version-list" id="versionList">${state.loadingVersions ? `<div class="version-loading">${UI.spinner(18)}<span>Loading real ${esc(state.serverType)} versions…</span></div>` : state.versionError ? `<div class="version-error"><span>${ICONS.warn}</span><div><b>Versions could not be loaded</b><small>${esc(state.versionError)}</small></div><button class="btn sm" id="retryVersions">Retry</button></div>` : cards || '<div class="empty-version">No versions are available for this software right now.</div>'}</div>
          </div>`;
        }

        function reviewPage() {
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon green">${ICONS.check}</span><div><h3>Ready to provision</h3><p>Review the owner, resource limits, and real software version before creating the server.</p></div></div>
            <div class="review-hero"><div><b>${esc(state.name)}</b><span>${esc(type()?.name || state.serverType)} · ${esc(state.version)} · ${state.memory} MB RAM</span>${state.description ? `<small>${esc(state.description)}</small>` : ''}</div><span class="badge green"><i class="dot green"></i>Ready</span></div>
            <dl class="review-grid"><div><dt>Owner</dt><dd>${esc(owner().username)}</dd></div><div><dt>Software</dt><dd>${esc(type()?.name || state.serverType)}</dd></div><div><dt>Version</dt><dd>${esc(state.version)}</dd></div><div><dt>RAM</dt><dd>${state.memory} MB</dd></div><div><dt>Disk</dt><dd>${state.diskLimit ? `${state.diskLimit} MB` : 'No panel limit'}</dd></div><div><dt>CPU</dt><dd>${state.cpuLimit ? `${state.cpuLimit}%` : 'No panel limit'}</dd></div><div><dt>IP</dt><dd>${esc(state.ip || 'Automatic allocation')}</dd></div><div><dt>Port</dt><dd>${state.port || 'Automatic allocation'}</dd></div><div><dt>Node</dt><dd>${esc(node().name)}</dd></div></dl>
            <label class="checkbox wizard-check install-check"><input type="checkbox" name="install" ${state.install ? 'checked' : ''}><span><b>Install server files now</b><small>Downloads the selected jar and matching Java runtime. Progress continues in the console.</small></span></label>
          </div>`;
        }

        function bindPage() {
          body.querySelectorAll('[data-version]').forEach((button) => button.onclick = () => {
            state.version = button.dataset.version;
            body.querySelectorAll('[data-version]').forEach((item) => item.classList.toggle('active', item === button));
            next.disabled = false;
          });
          body.querySelector('#versionSearch')?.addEventListener('input', (event) => {
            const query = event.target.value.toLowerCase();
            body.querySelectorAll('[data-version]').forEach((item) => { item.hidden = !item.dataset.version.toLowerCase().includes(query); });
          });
          body.querySelector('#retryVersions')?.addEventListener('click', async () => {
            if (state.loadingVersions) return;
            state.loadingVersions = true; paint(); await loadVersions(true); state.loadingVersions = false; paint();
          });
        }

        function paint() { stepNav(); body.innerHTML = state.step === 1 ? detailPage() : state.step === 2 ? versionPage() : reviewPage(); bindPage(); }

        async function submit() {
          if (state.busy) return;
          state.install = Boolean(value('install')?.checked ?? state.install);
          state.busy = true; next.disabled = true; next.innerHTML = `${UI.spinner(14)} Creating…`;
          try {
            const res = await API.post('/servers', {
              name: state.name, description: state.description, ownerId: state.ownerId,
              serverType: state.serverType, version: state.version, memory: state.memory,
              diskLimit: state.diskLimit, cpuLimit: state.cpuLimit, maxPlayers: state.maxPlayers,
              ip: state.ip || undefined, port: state.port || undefined, eulaAccepted: state.eulaAccepted,
              autoStart: state.autoStart, install: state.install, nodeId: state.nodeId,
              backend: state.backend || undefined, subdomain: state.subdomain || undefined,
            });
            UI.toast(`Server “${res.server.name}” created`, 'success');
            if (res.subdomainError) UI.toast(`Subdomain not created: ${res.subdomainError}`, 'warn');
            close(); location.href = `server.html?id=${res.server.id}`;
          } catch (err) { UI.toast(err.message, 'error'); state.busy = false; paint(); }
        }
      },
    });
  }


  async function openGameCreate() {
    if (!canCreate()) return UI.toast('Only an administrator can create servers.', 'error');
    let templates;
    try { templates = (await API.get('/system/games')).games || []; }
    catch (err) { UI.toast(`Could not load the dedicated-game catalogue: ${err.message}`, 'error'); return; }
    const available = templates.filter((item) => item.availableOnLocalNode);
    if (!available.length) return UI.toast('No Linux dedicated-game templates are available on this node.', 'error');
    let owners = [{ id: store.user?.id || '', username: store.user?.username || 'You', role: store.user?.role || 'owner' }];
    try { owners = ((await API.get('/users')).users || []).filter((user) => !user.suspended); } catch (err) { UI.toast(`Could not load owner accounts: ${err.message}`, 'warn'); }
    const state = { step: 1, busy: false, name: '', description: '', ownerId: store.user?.id || '', gameId: available[0].id, memory: available[0].defaultMemory, diskLimit: available[0].defaultDisk, cpuLimit: 100, maxPlayers: available[0].defaultPlayers, port: '', ip: '', autoStart: false, gamePassword: '', gameToken: '' };
    const labels = ['Details', 'Game', 'Review'];
    UI.modal({
      title: 'New dedicated game server', wide: true,
      body: `<section class="create-wizard game-wizard" id="gameWizard"><div class="create-wizard-top"><div><span class="eyebrow">SteamCMD provisioning</span><h2>Create a dedicated game server</h2><p>Choose an audited dedicated-server template. Zenith installs its real Steam app into persistent storage and runs the Linux binary in Docker.</p></div><span class="wizard-counter" id="gameCounter">Step 1 of 3</span></div><nav class="wizard-steps three" id="gameSteps" aria-label="Game server creation steps"></nav><div class="wizard-panel" id="gameBody"></div></section>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="gamePrev">Back</button><button class="btn primary" id="gameNext">Continue</button>`,
      onMount(root, { close }) {
        const body = root.querySelector('#gameBody'); const next = root.querySelector('#gameNext'); const prev = root.querySelector('#gamePrev');
        const selected = () => templates.find((item) => item.id === state.gameId) || available[0];
        const owner = () => owners.find((user) => user.id === state.ownerId) || owners[0] || { username: 'Unknown' };
        const field = (name) => body.querySelector(`[name="${name}"]`);
        prev.onclick = () => { if (!state.busy && state.step > 1) { state.step -= 1; paint(); } };
        next.onclick = () => advance();
        paint();

        function readDetails() {
          const name = field('name');
          state.name = name?.value.trim() || state.name;
          state.description = field('description')?.value.trim() || '';
          state.ownerId = field('ownerId')?.value || state.ownerId;
          state.memory = Math.max(256, parseInt(field('memory')?.value, 10) || state.memory);
          state.diskLimit = Math.max(0, parseInt(field('diskLimit')?.value, 10) || 0);
          state.cpuLimit = Math.max(1, parseInt(field('cpuLimit')?.value, 10) || 100);
          state.maxPlayers = Math.max(1, parseInt(field('maxPlayers')?.value, 10) || selected().defaultPlayers);
          state.port = field('port')?.value.trim() || '';
          state.ip = field('ip')?.value.trim() || '';
          state.autoStart = Boolean(field('autoStart')?.checked);
          if (!state.name) { UI.toast('Give the game server a name before continuing', 'error'); name?.focus(); return false; }
          if (state.name.length > 60 || state.description.length > 500) { UI.toast('Name or description is too long', 'error'); return false; }
          return true;
        }
        function readSecrets() {
          state.gamePassword = field('gamePassword')?.value || state.gamePassword;
          state.gameToken = field('gameToken')?.value || state.gameToken;
          if (selected().password && state.gamePassword.trim().length < 5) { UI.toast(`${selected().name} needs a password with at least five characters`, 'warn'); return false; }
          if (selected().id === 'dont-starve-together' && !state.gameToken.trim()) { UI.toast("Don't Starve Together needs a Klei cluster token", 'warn'); return false; }
          return true;
        }
        function chooseGame(item) {
          if (!item.availableOnLocalNode) return;
          state.gameId = item.id;
          state.memory = item.defaultMemory; state.diskLimit = item.defaultDisk; state.maxPlayers = item.defaultPlayers;
          state.gamePassword = ''; state.gameToken = '';
          paint();
        }
        function nav() {
          root.querySelector('#gameCounter').textContent = `Step ${state.step} of 3`;
          root.querySelector('#gameSteps').innerHTML = labels.map((label, index) => { const no = index + 1; const status = no < state.step ? 'done' : no === state.step ? 'active' : ''; return `<button type="button" class="wizard-step ${status}" data-game-step="${no}" ${no > state.step || state.busy ? 'disabled' : ''}><i>${no < state.step ? ICONS.check : no}</i><span>${label}</span></button>`; }).join('');
          root.querySelectorAll('[data-game-step]').forEach((button) => button.onclick = () => { if (!state.busy) { state.step = Number(button.dataset.gameStep); paint(); } });
          prev.style.visibility = state.step === 1 ? 'hidden' : ''; prev.disabled = state.busy;
          next.disabled = state.busy; next.textContent = state.step === 1 ? 'Choose game' : state.step === 2 ? 'Review game' : 'Create game server';
        }
        function details() {
          const game = selected();
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon blue">${ICONS.play}</span><div><h3>Game server details</h3><p>Dedicated games use the local Docker engine and a real SteamCMD installation job. CPU and RAM are hard container limits.</p></div></div><div class="create-field-grid"><label class="field field-wide">Server name<input name="name" value="${esc(state.name)}" maxlength="60" placeholder="Weekend survival" autofocus></label><label class="field field-wide">Description <span class="field-optional">Optional</span><textarea name="description" maxlength="500" placeholder="What players should know">${esc(state.description)}</textarea></label><label class="field">Owner<select name="ownerId">${owners.map((user) => `<option value="${esc(user.id)}" ${user.id === state.ownerId ? 'selected' : ''}>${esc(user.username)} · ${esc(user.role || 'user')}</option>`).join('')}</select></label><label class="field">RAM (MB)<input type="number" name="memory" min="256" step="256" value="${state.memory}"><span class="hint">${game.defaultMemory} MB recommended</span></label><label class="field">Disk (MB)<input type="number" name="diskLimit" min="0" step="1024" value="${state.diskLimit}"><span class="hint">0 means no panel limit</span></label><label class="field">CPU (%)<input type="number" name="cpuLimit" min="1" step="10" value="${state.cpuLimit}"><span class="hint">Hard Docker cgroup cap</span></label><label class="field">Player slots<input type="number" name="maxPlayers" min="1" max="250" value="${state.maxPlayers}"></label><label class="field">Primary port <span class="field-optional">Optional</span><input type="number" name="port" min="1" max="65535" value="${esc(state.port)}" placeholder="Auto allocate"><span class="hint">Required adjacent game/query ports are reserved automatically.</span></label><label class="field">IP allocation <span class="field-optional">Optional</span><input name="ip" value="${esc(state.ip)}" placeholder="0.0.0.0"></label><label class="checkbox field-wide"><input type="checkbox" name="autoStart" ${state.autoStart ? 'checked' : ''}><span><b>Auto-start after installation</b><small>SteamCMD completes first, then the dedicated-game container starts.</small></span></label></div></div>`;
        }
        function gamesList() {
          const grouped = templates.reduce((map, item) => { (map[item.category] ||= []).push(item); return map; }, {});
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon violet">${ICONS.servers}</span><div><h3>Select a dedicated game</h3><p>Every enabled tile uses an audited SteamCMD app ID and a real Linux launch profile. Windows-only publisher binaries are shown but cannot be faked on this node.</p></div></div>${Object.entries(grouped).map(([category, list]) => `<section class="game-template-group"><b class="tiny dim">${esc(category)}</b><div class="game-template-grid">${list.map((item) => `<button type="button" class="game-template-choice ${state.gameId === item.id ? 'active' : ''} ${item.availableOnLocalNode ? '' : 'unavailable'}" data-game="${esc(item.id)}" ${item.availableOnLocalNode ? '' : 'disabled'}><span><b>${esc(item.name)}</b><small>SteamCMD app ${item.appId} · ${item.defaultMemory} MB RAM</small><em>${esc(item.availableOnLocalNode ? item.note : 'Windows dedicated runtime required — unavailable on this Linux Docker node.')}</em></span><i>${state.gameId === item.id && item.availableOnLocalNode ? ICONS.check : item.availableOnLocalNode ? ICONS.play : ICONS.warn}</i></button>`).join('')}</div></section>`).join('')}</div>`;
        }
        function review() {
          const item = selected();
          const secretFields = `${item.password ? `<label class="field">Server password <input type="password" name="gamePassword" autocomplete="new-password" placeholder="Required by ${esc(item.name)}"><span class="hint">Stored only as a game launch secret and never returned by the API.</span></label>` : ''}${item.token ? `<label class="field">${item.id === 'dont-starve-together' ? 'Klei cluster token' : 'Game Server Login Token'} <input type="password" name="gameToken" autocomplete="new-password" placeholder="${item.id === 'dont-starve-together' ? 'Required to start the cluster' : 'Optional for public listing'}"><span class="hint">Stored only as a game launch secret and never returned by the API.</span></label>` : ''}`;
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon green">${ICONS.check}</span><div><h3>Ready to install</h3><p>Zenith pulls the SteamCMD image, runs <code>app_update ${item.appId} validate</code> in the persistent game directory, then exposes the allocated ports from a real Docker container.</p></div></div><div class="review-hero"><div><b>${esc(state.name)}</b><span>${esc(item.name)} · SteamCMD app ${item.appId} · ${state.memory} MB RAM</span>${state.description ? `<small>${esc(state.description)}</small>` : ''}</div><span class="badge green"><i class="dot green"></i>Ready</span></div><dl class="review-grid"><div><dt>Owner</dt><dd>${esc(owner().username)}</dd></div><div><dt>Game</dt><dd>${esc(item.name)}</dd></div><div><dt>Ports</dt><dd>${item.ports.map((entry) => entry.name).join(', ')}</dd></div><div><dt>RAM</dt><dd>${state.memory} MB</dd></div><div><dt>Disk</dt><dd>${state.diskLimit ? `${state.diskLimit} MB` : 'No panel limit'}</dd></div><div><dt>CPU</dt><dd>${state.cpuLimit}% hard limit</dd></div></dl>${secretFields ? `<div class="field-row mt">${secretFields}</div>` : ''}<div class="banner-note mt"><div><b>Installer output stays honest</b><div class="tiny">SteamCMD and Docker errors stream to Console exactly as returned. Existing game saves/configs are not erased by a later update.</div></div></div></div>`;
        }
        function bind() { body.querySelectorAll('[data-game]').forEach((button) => button.onclick = () => chooseGame(templates.find((item) => item.id === button.dataset.game))); }
        function paint() { nav(); body.innerHTML = state.step === 1 ? details() : state.step === 2 ? gamesList() : review(); bind(); }
        function advance() {
          if (state.busy) return;
          if (state.step === 1 && !readDetails()) return;
          if (state.step === 3) { if (readSecrets()) submit(); return; }
          state.step += 1; paint();
        }
        async function submit() {
          state.busy = true; next.disabled = true; next.innerHTML = `${UI.spinner(14)} Installing…`;
          try {
            const result = await API.post('/servers', { workloadType: 'game', gameId: state.gameId, serverType: 'GAME', name: state.name, description: state.description, ownerId: state.ownerId, memory: state.memory, diskLimit: state.diskLimit, cpuLimit: state.cpuLimit, maxPlayers: state.maxPlayers, port: state.port, ip: state.ip, autoStart: state.autoStart, backend: 'docker', gamePassword: state.gamePassword, gameToken: state.gameToken, install: true });
            UI.toast(`${result.server.name} is installing through SteamCMD`, 'success'); close(); location.href = `server.html?id=${result.server.id}`;
          } catch (err) { UI.toast(err.message, 'error'); state.busy = false; paint(); }
        }
      },
    });
  }

  async function openContainerCreate() {
    if (!canCreate()) return UI.toast('Only an administrator can create servers.', 'error');
    const templates = [
      // Ubuntu/Debian are deliberately the VM-style Linux workspace choices.
      // They remain Docker containers with a shared host kernel, not KVM VMs.
      { id: 'ubuntu-22.04', name: 'Ubuntu 22.04', image: 'ubuntu:22.04', note: 'Linux VM-style hosting workspace · shared Docker kernel', tone: 'orange', family: 'vm' },
      { id: 'ubuntu-20.04', name: 'Ubuntu 20.04', image: 'ubuntu:20.04', note: 'Linux VM-style hosting workspace · shared Docker kernel', tone: 'orange', family: 'vm' },
      { id: 'debian-12', name: 'Debian 12', image: 'debian:12', note: 'Linux VM-style hosting workspace · shared Docker kernel', tone: 'blue', family: 'vm' },
      { id: 'debian-11', name: 'Debian 11', image: 'debian:11', note: 'Linux VM-style hosting workspace · shared Docker kernel', tone: 'blue', family: 'vm' },
      // Language images are application runtimes for bots, not VM templates.
      { id: 'python-3.12', name: 'Python 3.12', image: 'python:3.12-slim', note: 'Bot hosting runtime · Python apps, Discord bots and workers', tone: 'green', family: 'bot' },
      { id: 'node-20', name: 'Node.js 20', image: 'node:20-bookworm-slim', note: 'Bot hosting runtime · Node.js apps, Discord bots and workers', tone: 'green', family: 'bot' },
    ];
    let owners = [{ id: store.user?.id || '', username: store.user?.username || 'You', role: store.user?.role || 'owner' }];
    try {
      const result = await API.get('/users');
      owners = (result.users || []).filter((user) => !user.suspended);
    } catch (err) { UI.toast(`Could not load owner accounts: ${err.message}`, 'error'); return; }

    const labels = ['Details', 'Image', 'Review'];
    const state = { step: 1, busy: false, name: '', description: '', memory: 2048, diskLimit: 0, cpuLimit: 100, ownerId: store.user?.id || owners[0]?.id || '', template: '', botEntryFile: '', botStartupCommand: '', install: true };
    UI.modal({
      title: 'New Docker container', wide: true,
      body: `<section class="create-wizard container-wizard" id="containerWizard"><div class="create-wizard-top"><div><span class="eyebrow">Docker workload</span><h2>Create an isolated container</h2><p>Images are pulled by the local Docker daemon. Linux workspaces receive an SSHX session; Python and Node.js templates are bot runtimes with files, dependency installation, and live application logs.</p></div><span class="wizard-counter" id="containerCounter">Step 1 of 3</span></div><nav class="wizard-steps three" id="containerSteps" aria-label="Container creation steps"></nav><div class="wizard-panel" id="containerBody"></div></section>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="containerPrev">Back</button><button class="btn primary" id="containerNext">Continue</button>`,
      onMount(root, { close }) {
        const body = root.querySelector('#containerBody');
        const next = root.querySelector('#containerNext');
        const prev = root.querySelector('#containerPrev');
        const owner = () => owners.find((user) => user.id === state.ownerId) || owners[0] || { username: 'Unknown user' };
        const image = () => templates.find((template) => template.id === state.template);
        const field = (name) => body.querySelector(`[name="${name}"]`);
        prev.onclick = () => { if (!state.busy && state.step > 1) { state.step -= 1; paint(); } };
        next.onclick = () => advance();
        paint();

        function readDetails() {
          const name = field('name');
          state.name = name?.value.trim() || '';
          state.description = field('description')?.value.trim() || '';
          state.memory = Math.max(256, parseInt(field('memory')?.value, 10) || 2048);
          state.diskLimit = Math.max(0, parseInt(field('diskLimit')?.value, 10) || 0);
          state.cpuLimit = Math.max(1, parseInt(field('cpuLimit')?.value, 10) || 100);
          state.ownerId = field('ownerId')?.value || state.ownerId;
          if (!state.name) { UI.toast('Give this container a name before continuing', 'error'); name?.focus(); return false; }
          if (state.name.length > 60) { UI.toast('Container name must be 60 characters or fewer', 'error'); return false; }
          if (state.description.length > 500) { UI.toast('Description must be 500 characters or fewer', 'error'); return false; }
          return true;
        }
        function advance() {
          if (state.busy) return;
          if (state.step === 1 && !readDetails()) return;
          if (state.step === 2 && !state.template) { UI.toast('Select a container image before continuing', 'warn'); return; }
          if (state.step === 3) { submit(); return; }
          state.step += 1; paint();
        }
        function nav() {
          root.querySelector('#containerCounter').textContent = `Step ${state.step} of ${labels.length}`;
          root.querySelector('#containerSteps').innerHTML = labels.map((label, index) => { const number = index + 1; const status = number < state.step ? 'done' : number === state.step ? 'active' : ''; return `<button type="button" class="wizard-step ${status}" data-container-step="${number}" ${number > state.step || state.busy ? 'disabled' : ''}><i>${number < state.step ? ICONS.check : number}</i><span>${label}</span></button>`; }).join('');
          root.querySelectorAll('[data-container-step]').forEach((button) => button.onclick = () => { if (!state.busy) { state.step = Number(button.dataset.containerStep); paint(); } });
          prev.style.visibility = state.step === 1 ? 'hidden' : '';
          prev.disabled = state.busy;
          next.disabled = state.busy || (state.step === 2 && !state.template);
          next.textContent = state.step === 1 ? 'Choose image' : state.step === 2 ? 'Review container' : 'Create container';
        }
        function details() {
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon violet">${ICONS.container}</span><div><h3>Container details</h3><p>The workload runs only in Docker on the local node. Python and Node.js are source-file bot runtimes; Linux workspace templates keep their separate SSHX access.</p></div></div><div class="create-field-grid"><label class="field field-wide">Container name<input name="name" placeholder="Discord bot" value="${esc(state.name)}" maxlength="60" autofocus><span class="hint">Used in the panel and Docker runtime record.</span></label><label class="field field-wide">Description <span class="field-optional">Optional</span><textarea name="description" maxlength="500" placeholder="What this bot or workload does">${esc(state.description)}</textarea></label><label class="field">Owner<select name="ownerId">${owners.map((user) => `<option value="${esc(user.id)}" ${user.id === state.ownerId ? 'selected' : ''}>${esc(user.username)} · ${esc(user.role || 'user')}</option>`).join('')}</select><span class="hint">Gets access to this container.</span></label><label class="field">RAM<input type="number" name="memory" value="${state.memory}" min="256" step="256"><span class="hint">MB hard Docker memory limit</span></label><label class="field">Disk<input type="number" name="diskLimit" value="${state.diskLimit}" min="0" step="1024"><span class="hint">MB · 0 means no panel limit</span></label><label class="field">CPU<input type="number" name="cpuLimit" value="${state.cpuLimit}" min="1" step="10"><span class="hint">Percent · hard Docker CPU limit</span></label><div class="container-note field-wide"><span>${ICONS.folder}</span><div><b>Persistent files at <code>/data</code></b><small>The Files tab maps to this directory. It survives container restarts and is included in panel backups.</small></div></div></div></div>`;
        }
        function images() {
          const imageButton = (template) => `<button type="button" class="container-image-choice ${state.template === template.id ? 'active' : ''}" data-template="${template.id}"><span class="container-image-icon ${template.tone}">${template.family === 'bot' ? ICONS.terminal : ICONS.container}</span><span><b>${esc(template.name)}</b><small>${esc(template.note)}</small><code>${esc(template.image)}</code></span><i>${state.template === template.id ? ICONS.check : ''}</i></button>`;
          const vmTemplates = templates.filter((template) => template.family === 'vm');
          const botTemplates = templates.filter((template) => template.family === 'bot');
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon blue">${ICONS.container}</span><div><h3>Select a hosting runtime</h3><p>Ubuntu and Debian are Linux VM-style Docker workspaces. Python and Node.js are dedicated bot-hosting runtimes. Docker pulls the selected image after creation.</p></div></div><div class="container-image-group"><b class="tiny dim">LINUX VM-STYLE HOSTING</b><div class="container-image-grid">${vmTemplates.map(imageButton).join('')}</div></div><div class="container-image-group mt"><b class="tiny dim">BOT HOSTING</b><div class="container-image-grid">${botTemplates.map(imageButton).join('')}</div></div></div>`;
        }
        function review() {
          const selected = image();
          const bot = selected?.family === 'bot';
          const purpose = bot ? 'Managed bot hosting runtime' : 'Linux VM-style workspace (shared Docker kernel)';
          const defaultEntry = selected?.id === 'python-3.12' ? 'bot.py' : 'index.js';
          if (bot && !state.botEntryFile) state.botEntryFile = defaultEntry;
          if (bot && !state.botStartupCommand) state.botStartupCommand = selected.id === 'python-3.12' ? `python ${state.botEntryFile}` : `node ${state.botEntryFile}`;
          return `<div class="wizard-content"><div class="wizard-intro"><span class="wizard-intro-icon green">${ICONS.check}</span><div><h3>${bot ? 'Configure bot startup' : 'Ready to create'}</h3><p>${bot ? 'Create the bot workspace first, upload its source through Files, then Start. The panel runs only the selected safe source file inside Docker.' : 'Docker will pull the selected image, create the isolated workspace, and start it with a persistent /data directory.'}</p></div></div><div class="review-hero"><div><b>${esc(state.name)}</b><span>${esc(selected?.name || '')} · ${esc(purpose)} · ${state.memory} MB RAM</span>${state.description ? `<small>${esc(state.description)}</small>` : ''}</div><span class="badge green"><i class="dot green"></i>Ready</span></div><dl class="review-grid"><div><dt>Owner</dt><dd>${esc(owner().username)}</dd></div><div><dt>Purpose</dt><dd>${esc(purpose)}</dd></div><div><dt>Image</dt><dd>${esc(selected?.image || '')}</dd></div><div><dt>RAM</dt><dd>${state.memory} MB</dd></div><div><dt>Disk</dt><dd>${state.diskLimit ? `${state.diskLimit} MB` : 'No panel limit'}</dd></div><div><dt>CPU</dt><dd>${state.cpuLimit}% hard cgroup limit</dd></div><div><dt>Console</dt><dd>${bot ? 'Live bot output' : 'Logs + SSHX link'}</dd></div></dl>${bot ? `<div class="bot-startup-grid"><label class="field bot-entry-field">Startup file<input name="botEntryFile" value="${esc(state.botEntryFile)}" maxlength="120" placeholder="${defaultEntry}" autocomplete="off"><span class="hint">${selected.id === 'python-3.12' ? 'Python file ending in .py' : 'Node.js file ending in .js, .cjs, or .mjs'} under /data.</span></label><label class="field bot-entry-field">Startup command<input name="botStartupCommand" value="${esc(state.botStartupCommand)}" maxlength="160" autocomplete="off"><span class="hint">${selected.id === 'python-3.12' ? `Allowed: python ${esc(state.botEntryFile || defaultEntry)}` : `Allowed: node ${esc(state.botEntryFile || defaultEntry)} or npm start`}. Runs inside this bot container, never on the panel host.</span></label></div><div class="container-review-note bot-review-note"><span>${ICONS.folder}</span><div><b>Upload source before starting</b><small>Use Files to upload <code>${esc(state.botEntryFile || defaultEntry)}</code> and <code>${selected.id === 'python-3.12' ? 'requirements.txt' : 'package.json'}</code>. Start installs dependencies inside this bot container and streams its real output here.</small></div></div>` : `<div class="container-review-note"><span>${ICONS.terminal}</span><div><b>SSHX runs inside this workspace</b><small>After preparation, Console displays SSHX’s generated browser-session link for its real terminal.</small></div></div>`}</div>`;
        }
        function bind() { body.querySelectorAll('[data-template]').forEach((button) => button.onclick = () => { const selected = templates.find((template) => template.id === button.dataset.template); state.template = button.dataset.template; if (selected?.family === 'bot') { state.botEntryFile = selected.id === 'python-3.12' ? 'bot.py' : 'index.js'; state.botStartupCommand = selected.id === 'python-3.12' ? 'python bot.py' : 'node index.js'; } paint(); }); }
        function paint() { nav(); body.innerHTML = state.step === 1 ? details() : state.step === 2 ? images() : review(); bind(); }
        async function submit() {
          if (state.busy) return;
          const selected = image();
          const entry = field('botEntryFile');
          if (entry) state.botEntryFile = entry.value.trim();
          const startup = field('botStartupCommand');
          if (startup) state.botStartupCommand = startup.value.trim();
          state.busy = true; next.disabled = true; next.innerHTML = `${UI.spinner(14)} Creating…`;
          try {
            const response = await API.post('/servers', { workloadType: 'container', containerTemplate: state.template, serverType: 'CONTAINER', name: state.name, description: state.description, ownerId: state.ownerId, memory: state.memory, diskLimit: state.diskLimit, cpuLimit: state.cpuLimit, backend: 'docker', botEntryFile: state.botEntryFile || undefined, botStartupCommand: state.botStartupCommand || undefined, install: selected?.family !== 'bot' });
            UI.toast(response.message || (selected?.family === 'bot' ? `Bot workspace “${response.server.name}” is ready for source files` : `Container “${response.server.name}” is being created`), 'success'); close(); location.href = `server.html?id=${response.server.id}`;
          } catch (err) { UI.toast(err.message, 'error'); state.busy = false; paint(); }
        }
      },
    });
  }


  await load();
  if (new URLSearchParams(location.search).get('create') === '1' || location.hash === '#create') {
    history.replaceState(null, '', location.pathname);
    if (canCreate()) openCreate();
  }
})();
