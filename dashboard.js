/* Dashboard: a private fleet overview. It never embeds or automatically opens
   a server console; the user explicitly chooses Open console for a server. */
(async function () {
  try { await bootstrap({ active: 'dashboard.html' }); } catch (_) { return; }

  const root = document.getElementById('dashContent');
  let servers = [];
  let refreshing = false;

  const status = (value) => statusBadge(value || 'offline');
  const canCreate = () => ['admin', 'owner'].includes(store.user?.role);
  const limits = (server) => `${server.memory || 0} MB RAM${server.diskLimit ? ` · ${server.diskLimit} MB disk` : ''}${server.cpuLimit ? ` · ${server.cpuLimit}% CPU` : ''}`;
  const power = (server) => {
    if (!server.perms?.console) return '';
    if (['installing', 'starting', 'stopping'].includes(server.status)) return `<button class="btn sm" disabled>${UI.spinner(12)} Working…</button>`;
    return server.status === 'running'
      ? `<button class="btn sm" data-dashboard-power="restart" data-server-id="${server.id}">${ICONS.restart} Restart</button><button class="btn sm red" data-dashboard-power="stop" data-server-id="${server.id}">${ICONS.stop} Stop</button>`
      : `<button class="btn sm green" data-dashboard-power="start" data-server-id="${server.id}">${ICONS.play} Start</button>`;
  };

  function render() {
    const online = servers.filter((server) => ['running', 'starting'].includes(server.status)).length;
    const players = servers.reduce((total, server) => total + Number(server.players || 0), 0);
    const assignedRam = servers.reduce((total, server) => total + Number(server.memory || 0), 0);
    root.innerHTML = `
      <section class="fleet-overview">
        <div class="fleet-overview-copy"><span class="eyebrow">Your fleet</span><h2>Your servers</h2><p>Only servers you own or have been given access to are shown here. Opening a console is always an explicit action.</p></div>
        ${canCreate() ? `<a class="btn primary" href="servers.html#create">${ICONS.plus} Create server</a>` : ''}
      </section>
      <section class="fleet-stats" aria-label="Your server totals">
        <article class="card fleet-stat"><span>${ICONS.servers}</span><div><small>Accessible servers</small><b>${servers.length}</b></div></article>
        <article class="card fleet-stat"><span class="green">${ICONS.play}</span><div><small>Running</small><b>${online}</b></div></article>
        <article class="card fleet-stat"><span class="blue">${ICONS.users2}</span><div><small>Players online</small><b>${players}</b></div></article>
        <article class="card fleet-stat"><span class="violet">${ICONS.memory}</span><div><small>RAM assigned</small><b>${fmt.bytes(assignedRam * 1024 * 1024)}</b></div></article>
      </section>
      <section class="fleet-list-card card">
        <div class="card-head"><div><h3>Your server list</h3><p class="tiny dim">Server actions are scoped to your access. No other account’s private server is listed.</p></div><span class="badge blue">${servers.length} total</span></div>
        <div class="fleet-server-grid" id="fleetServerGrid">${serverGrid()}</div>
      </section>`;
    bind();
  }

  function serverGrid() {
    if (!servers.length) return `<div class="fleet-empty">${UI.empty('No servers yet', canCreate() ? 'Create your first server to choose its limits, version, and owner.' : 'Ask an administrator to create a server and assign you access.')}</div>`;
    return servers.map((server) => `<article class="fleet-server-card" data-fleet-server="${server.id}">
      <div class="fleet-server-top"><div class="server-icon">${esc((server.serverType || 'MC').slice(0, 2))}</div><div class="grow" style="min-width:0"><div class="row" style="gap:8px"><b class="truncate">${esc(server.name)}</b>${status(server.status)}</div><small>${esc(server.serverType || 'Minecraft')} ${esc(server.version || '')}</small></div></div>
      ${server.description ? `<p class="fleet-server-description">${esc(server.description)}</p>` : '<p class="fleet-server-description muted">No description added.</p>'}
      <dl class="fleet-server-meta"><div><dt>Address</dt><dd>${esc(server.ip || '0.0.0.0')}:${server.port}</dd></div><div><dt>Limits</dt><dd>${esc(limits(server))}</dd></div><div><dt>Players</dt><dd>${server.players || 0} / ${server.maxPlayers || 0}</dd></div></dl>
      <div class="fleet-server-actions"><div class="row wrap" style="gap:6px">${power(server)}</div><a class="btn sm primary" href="server.html?id=${server.id}">${ICONS.terminal} Open console</a></div>
    </article>`).join('');
  }

  function bind() {
    root.querySelectorAll('[data-dashboard-power]').forEach((button) => button.onclick = async () => {
      if (refreshing) return;
      button.disabled = true;
      try {
        await API.post(`/servers/${button.dataset.serverId}/${button.dataset.dashboardPower}`);
        UI.toast(`${button.dataset.dashboardPower} requested`, 'success');
        setTimeout(load, 900);
      } catch (err) { UI.toast(err.message, 'error'); button.disabled = false; }
    });
  }

  async function load() {
    if (refreshing) return;
    refreshing = true;
    try {
      const data = await API.get('/servers?withUsage=disk');
      servers = data.servers || [];
      Layout.setServerCount(servers.length);
      render();
    } catch (err) {
      root.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`;
    } finally { refreshing = false; }
  }

  Layout.title('Dashboard', 'Your private server fleet');
  Layout.actions(`<button class="btn sm" id="dashRefresh">${ICONS.refresh} Refresh</button>${canCreate() ? `<a class="btn sm primary" href="servers.html#create">${ICONS.plus} New server</a>` : ''}`);
  document.getElementById('dashRefresh').onclick = () => load();
  root.innerHTML = `<div class="skeleton" style="height:250px"></div>`;
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 15000);
})();
