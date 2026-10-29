/* Server detail page: console, files, Modrinth, backups, playit, schedules, settings */
(async function () {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { location.href = 'servers.html'; return; }

  try { await bootstrap({ active: 'servers.html' }); } catch (_) { return; }

  let server = null;
  let socket = null;
  const STATUS_LABEL = { running: 'Running', starting: 'Starting', installing: 'Installing', stopping: 'Stopping', offline: 'Offline', crashed: 'Crashed', suspended: 'Suspended' };
  const consoleView = new ConsoleView(document.createElement('div'));
  const TABS = [
    { key: 'console', label: 'Console', icon: ICONS.terminal, perm: 'console' },
    { key: 'players', label: 'Players', icon: ICONS.users2, perm: 'console' },
    { key: 'files', label: 'Files', icon: ICONS.folder, perm: 'files' },
    { key: 'properties', label: 'Properties', icon: ICONS.edit, perm: 'settings' },
    { key: 'worlds', label: 'Worlds', icon: ICONS.star, perm: 'files' },
    { key: 'sftp', label: 'SFTP', icon: ICONS.key, perm: 'files' },
    { key: 'plugins', label: 'Plugins', icon: ICONS.puzzle, perm: 'plugins', hidden: () => !supportsPlugins(server) && supportsMods(server) },
    { key: 'mods', label: 'Mods', icon: ICONS.container, perm: 'plugins', hidden: () => !supportsMods(server) },
    { key: 'backups', label: 'Backups', icon: ICONS.backup, perm: 'backups' },
    { key: 'network', label: 'Network', icon: ICONS.globe, perm: 'network' },
    { key: 'schedules', label: 'Schedules', icon: ICONS.clock, perm: 'schedules' },
    { key: 'people', label: 'People', icon: ICONS.users, perm: 'subusers' },
    { key: 'settings', label: 'Settings', icon: ICONS.gear, perm: 'settings' },
  ];

  const PLUGIN_TYPES = ['PAPER', 'SPIGOT', 'PURPUR', 'FOLIA', 'BUKKIT', 'CRAFTBUKKIT', 'VELOCITY', 'BUNGEECORD', 'WATERFALL'];
  const MOD_TYPES = ['FABRIC', 'QUILT', 'FORGE', 'NEOFORGE', 'MOHIST', 'ARCLIGHT'];
  function supportsPlugins(srv) { return Boolean(srv) && PLUGIN_TYPES.includes(String(srv.serverType || '').toUpperCase()); }
  function supportsMods(srv) { return Boolean(srv) && MOD_TYPES.includes(String(srv.serverType || '').toUpperCase()); }
  function isContainerWorkload(srv) { return Boolean(srv && srv.workloadType === 'container'); }
  function isBotWorkload(srv) { return Boolean(isContainerWorkload(srv) && srv.containerRole === 'bot'); }
  function isGameWorkload(srv) { return Boolean(srv && srv.workloadType === 'game'); }
  function sshxUrl(session = server?.sshx) {
    const url = String(session?.url || '').trim();
    return /^https:\/\/sshx\.io\/[^\s'"<>]+$/i.test(url) ? url : '';
  }
  function sshxSlot(session = server?.sshx) {
    const url = sshxUrl(session);
    const status = String(session?.status || 'starting');
    if (url) return `<a class="sshx-session-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span><i class="dot green"></i>SSHX session ready</span><code>${esc(url)}</code><small>Open the link in a new tab to control this container.</small></a>`;
    if (status === 'error') return `<div class="sshx-session-state error"><b>SSHX could not start</b><small>${esc(session?.error || 'See the container console for the exact error.')}</small></div>`;
    return `<div class="sshx-session-state"><b>Creating SSHX browser session…</b><small>The real link appears here as soon as sshx reports it in the container log.</small></div>`;
  }
  function openSshxSession() {
    const url = sshxUrl();
    if (!url) { UI.toast('SSHX is still starting. Watch the Console; its link appears as soon as the session is ready.', 'info'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  function updateSshx(session) {
    if (!server || !isContainerWorkload(server) || isBotWorkload(server)) return;
    server.sshx = { ...(server.sshx || {}), ...(session || {}) };
    document.querySelectorAll('[data-sshx-slot]').forEach((slot) => { slot.innerHTML = sshxSlot(server.sshx); });
    document.querySelectorAll('[data-open-sshx]').forEach((button) => {
      button.disabled = !sshxUrl(server.sshx);
      button.title = sshxUrl(server.sshx) ? 'Open this container’s SSHX session' : 'Waiting for SSHX to provide its session link';
    });
  }

  async function loadServer() {
    const data = await API.get(`/servers/${id}`);
    server = data.server;
    server.playit = data.playit;
    return server;
  }

  function header() {
    const el = document.getElementById('serverHeader');
    const remote = server.nodeId && server.nodeId !== 'local';
    const backend = server.backend || 'process';
    const subtitle = isGameWorkload(server)
      ? `${server.gameName || 'Dedicated game'} · SteamCMD app ${server.gameAppId || '?'}`
      : `${server.serverType} ${server.version || ''}${server.build ? ` · build ${server.build}` : ''}`.trim();
    const runtimeLabel = isGameWorkload(server) ? 'Docker game container' : (isBotWorkload(server) ? `Managed ${server.containerTemplate === 'python-3.12' ? 'Python' : 'Node.js'} bot` : (backend === 'docker' ? `Docker ${server.container ? 'container' : ''}`.trim() : `Java ${server.javaVersion || '?'}`));
    el.innerHTML = `
      <section class="server-hero" aria-label="Server overview">
        <div class="server-hero-copy">
          <div class="server-crumb"><a href="servers.html">Servers</a><span>/</span><span>${esc(server.nodeName || 'Local Node')}</span></div>
          <div class="server-title-row">
            <h1>${esc(server.name)}</h1>
            <span class="status-line ${esc(server.status)}" id="liveStatus"><i></i>${esc(STATUS_LABEL[server.status] || server.status)}</span>
          </div>
          <div class="server-hero-subtitle">
            <span>${esc(subtitle)}</span>
            <span aria-hidden="true">·</span>
            <span title="runtime">${(backend === 'docker' || isGameWorkload(server)) ? ICONS.docker : ICONS.chip}${esc(runtimeLabel)}</span>
            <span aria-hidden="true">·</span>
            <span title="memory limit">${ICONS.memory}${server.memory} MB memory</span>
            ${remote ? `<span class="server-agent">Agent node</span>` : ''}
          </div>
        </div>
        <div class="server-hero-actions">
          <div class="power-slot" aria-label="Power controls"></div>
          <a class="btn hero-exit" href="servers.html" title="Exit this server and return to all servers">${ICONS.logout}<span>Exit server</span></a>
          <div class="hero-tools" aria-label="Server tools">
            <button class="icon-btn" id="focusCmd" title="${isContainerWorkload(server) && !isBotWorkload(server) ? 'Open SSHX browser session' : isBotWorkload(server) ? 'Open bot console' : 'Focus command input'}" aria-label="${isContainerWorkload(server) && !isBotWorkload(server) ? 'Open SSHX browser session' : isBotWorkload(server) ? 'Open bot console' : 'Focus command input'}">${ICONS.terminal}</button>
            <button class="icon-btn" id="gotoSettingsTop" title="Server settings" aria-label="Server settings">${ICONS.gear}</button>
            <button class="icon-btn" id="refreshServer" title="Refresh live data" aria-label="Refresh live data">${ICONS.refresh}</button>
          </div>
        </div>
      </section>`;
    const focus = el.querySelector('#focusCmd');
    if (focus) focus.onclick = () => { if (isContainerWorkload(server)) { setTab('console'); if (!isBotWorkload(server)) openSshxSession(); return; } setTab('console'); document.getElementById('cmdInput')?.focus(); };
    el.querySelector('#gotoSettingsTop').onclick = () => setTab('settings');
    el.querySelector('#refreshServer').onclick = () => refreshAll(true);
    powerBar();
  }

  /** Power buttons appear twice (page head + console panel) - fill every slot. */
  function powerBar() {
    if (!server) return;
    const busy = ['installing', 'starting', 'stopping'].includes(server.status);
    const running = server.status === 'running';
    const html = `
      <button class="btn power-action green" data-power="start" ${busy || running ? 'disabled' : ''}>${ICONS.play}<span>Start</span></button>
      <button class="btn power-action yellow" data-power="restart" ${busy || !running ? 'disabled' : ''}>${ICONS.restart}<span>Restart</span></button>
      <button class="btn power-action red" data-power="stop" ${busy || !running ? 'disabled' : ''}>${ICONS.stop}<span>Stop</span></button>
      <button class="btn power-action power-kill" data-power="kill" ${busy || !running ? 'disabled' : ''}>${ICONS.warn}<span>Kill</span></button>`;
    document.querySelectorAll('.power-slot').forEach((el) => { el.innerHTML = html; });
    document.querySelectorAll('[data-power]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await API.post(`/servers/${id}/${b.dataset.power}`); setTimeout(refreshAll, 800); }
      catch (err) { UI.toast(err.message, 'error'); b.disabled = false; }
    });
  }

  function tabGroup(key) {
    if (isContainerWorkload(server) && key === 'console') return 'Container';
    if (isGameWorkload(server) && key === 'console') return 'Game management';
    if (['console', 'players'].includes(key)) return 'Server management';
    if (['files', 'properties', 'worlds', 'sftp', 'plugins', 'mods', 'backups'].includes(key)) return 'Content';
    if (['network', 'schedules'].includes(key)) return 'Automation & network';
    if (key === 'people') return 'Access';
    return 'Configuration';
  }

  function tabs() {
    const el = document.getElementById('serverTabs');
    const allowedContainerTabs = new Set(['console', 'files', 'backups', 'network', 'settings']);
    const allowedGameTabs = new Set(['console', 'files', 'sftp', 'backups', 'network', 'schedules', 'people', 'settings']);
    const visible = TABS.filter((t) => server.perms[t.perm] || server.perms.admin)
      .filter((t) => !(t.hidden && t.hidden()))
      .filter((t) => !isContainerWorkload(server) || allowedContainerTabs.has(t.key))
      .filter((t) => !isGameWorkload(server) || allowedGameTabs.has(t.key));
    let group = '';
    el.innerHTML = visible.map((t) => {
      const next = tabGroup(t.key);
      const title = next !== group ? `<div class="server-nav-section">${esc(next)}</div>` : '';
      group = next;
      return `${title}<button class="server-nav-link" data-tab="${t.key}" title="${esc(t.label)}">${t.icon}<span>${esc(t.label)}</span></button>`;
    }).join('');
    el.querySelectorAll('button[data-tab]').forEach((b) => b.onclick = () => {
      setTab(b.dataset.tab);
      Layout.closeMobileNav();
    });
    installServerDrawer(el);
    const wanted = (location.hash || '#console').slice(1);
    setTab(visible.some((t) => t.key === wanted) ? wanted : 'console');
  }

  /**
   * Two-tier navigation for a server: a compact, global primary rail remains
   * on the far left; this contextual drawer owns the server's options. It has
   * its own scroll area, so a long server menu never clips the account/global
   * navigation. On mobile both tiers become one off-canvas drawer.
   */
  function installServerDrawer(el) {
    const shell = document.querySelector('.shell');
    const main = document.querySelector('.main');
    if (!shell || !main || !el) return;
    shell.classList.remove('rail', 'server-drawer-collapsed');
    // A server page owns the entire left navigation. Remove the global panel
    // rail and top toolbar rather than merging their controls into the console.
    // Exiting through the server switcher returns to the normal panel shell.
    shell.querySelector('.sidebar')?.remove();
    shell.querySelector('.nav-scrim')?.remove();
    shell.querySelector('.topbar')?.remove();
    localStorage.removeItem('zenith.serverDrawerCollapsed');
    shell.classList.add('server-layout');
    let drawer = shell.querySelector('.server-sidebar');
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.className = 'server-sidebar';
      drawer.setAttribute('aria-label', 'Server navigation');
      shell.insertBefore(drawer, main);
    }
    drawer.innerHTML = `
      <div class="server-drawer-head">
        <a class="server-switcher" href="servers.html" title="Back to all servers">
          <span class="server-switcher-icon">${ICONS.servers}</span>
          <span class="server-switcher-copy"><b>${esc(server.name)}</b><small>${esc(server.serverType)} ${esc(server.version || '')}</small></span>
        </a>
        <span class="drawer-context">Server menu</span>
      </div>
      <a class="server-exit-link" href="servers.html">${ICONS.logout}<span>Exit server</span></a>
      <nav class="server-nav" aria-label="Server options"></nav>
      <div class="server-drawer-foot">
        <span class="dot ${server.status === 'running' ? 'green' : server.status === 'starting' ? 'yellow' : 'red'}"></span>
        <span>${esc(STATUS_LABEL[server.status] || server.status)}</span>
        <span class="server-node-name">${ICONS.node}${esc(server.nodeName || 'Local Node')}</span>
      </div>`;
    drawer.querySelector('.server-nav').appendChild(el);
    el.className = 'server-tabs';
    // The contextual menu is the only navigation in this view and stays
    // mounted instead of collapsing into a menu button.
  }

  function setServerDrawerCollapsed() {
    const shell = document.querySelector('.shell');
    if (shell) shell.classList.remove('server-drawer-collapsed');
  }

  function bindServerDrawerToggle() {
    // Intentionally retained as a no-op compatibility hook. The server menu is
    // persistent on desktop; narrow layouts use the global hamburger drawer.
  }

  const rendered = {};
  function setTab(key) {
    document.querySelectorAll('#serverTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${key}`));
    location.hash = key;
    if (!rendered[key]) { rendered[key] = true; RENDER[key] && RENDER[key](); }
  }

  /* ================================ console ================================ */
  /** JTG's console uses one dominant live-log pane, a true metric rail and
   * historical charts. Keep that complete layout for generic Docker workloads
   * too — only the input is replaced by the isolated SSHX session action. */
  function jtgStatCard(icon, label, id, value = '—', detail = '') {
    return `<article class="jtg-stat-card"><span class="jtg-stat-watermark" aria-hidden="true">${icon}</span><div class="jtg-stat-copy"><span>${esc(label)}</span><b id="${esc(id)}">${esc(value)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</div></article>`;
  }

  function renderContainerConsole() {
    const root = document.getElementById('tab-console');
    const bot = isBotWorkload(server);
    const botEntry = server.botEntryFile || (server.containerTemplate === 'python-3.12' ? 'bot.py' : 'index.js');
    const botStartupCommand = server.botStartupCommand || (server.containerTemplate === 'python-3.12' ? `python ${botEntry}` : `node ${botEntry}`);
    const containerIsolation = server.containerIsolation || {};
    const verifiedIsolation = containerIsolation.ok === true;
    const identity = containerIsolation.identity || {};
    const rootFilesystem = containerIsolation.rootFilesystem || {};
    const rootfsLabel = rootFilesystem.driver
      ? `${rootFilesystem.driver} · container ${String(rootFilesystem.id || '').slice(0, 12) || 'verified'}`
      : (rootFilesystem.id ? `Docker-managed container ${String(rootFilesystem.id).slice(0, 12)} · driver not disclosed by engine` : 'Verifying Docker root filesystem…');
    const containerPurpose = server.containerRole === 'bot'
      ? 'Bot hosting runtime (Python/Node application image)'
      : 'Linux VM-style workspace (Docker shared kernel)';
    root.innerHTML = `
      <div class="console-page container-console-page jtg-console-page">
        <section class="jtg-console-grid" aria-label="Live Docker container console and telemetry">
          <div class="console-main">
            <section class="console-terminal jtg-log-console" aria-label="Container log console">
              <div class="console-terminal-head">
                <div class="terminal-title"><span class="terminal-lights"><i></i><i></i><i></i></span><b>Console</b></div>
                <span class="badge tiny" id="socketMode">connecting</span>
                <span class="terminal-meta" id="consoleMeta">${esc(server.dockerImage || server.containerTemplate || 'Docker image')} · Docker · /data</span>
                <div class="terminal-actions"><button class="btn ghost sm icon" id="clearLogs" title="Clear terminal view" aria-label="Clear terminal view">${ICONS.trash}</button><button class="btn ghost sm icon" id="scrollBottom" title="Scroll to latest output" aria-label="Scroll to latest output">${ICONS.download}</button></div>
              </div>
              <div class="terminal-body" id="terminalBody" aria-live="polite">${UI.spinner()} <span class="dim">connecting to the container log stream…</span></div>
              ${bot ? `<div class="container-console-input bot-console-input"><span class="prompt" aria-hidden="true">›</span><span>Live bot output from <code>/data/${esc(botEntry)}</code>. Upload/edit files in Files, then restart to apply changes.</span></div>` : `<div class="container-console-input"><span class="prompt" aria-hidden="true">›</span><span>Live Docker output. Control this isolated workload in its SSHX browser session.</span><button class="btn primary sm" id="openSshxSession">${ICONS.terminal} Open SSHX</button></div>`}
            </section>
            <div class="card install-progress" id="installCard" style="display:none"><div class="row between"><h3 style="margin:0">Container preparation</h3><span class="tiny dim" id="installNote"></span></div><div class="bar blue mt"><i id="installBar" style="width:0%"></i></div></div>
          </div>

          <aside class="jtg-stat-rail" aria-label="Live container metrics">
            ${jtgStatCard(ICONS.ports, 'Service port', 'jtgAddress', 'Not published', 'Docker network isolated')}
            ${jtgStatCard(ICONS.clock, 'Uptime', 'jtgUptime', '—', 'live container session')}
            ${jtgStatCard(ICONS.chip, 'CPU load', 'jtgCpu', '—', 'Docker cgroup usage')}
            ${jtgStatCard(ICONS.memory, 'Memory', 'jtgMemory', '—', `${server.memory} MB limit`)}
            ${jtgStatCard(ICONS.disk, 'Disk', 'jtgDisk', 'Measuring…', '/data workspace')}
            ${jtgStatCard(ICONS.download, 'Network inbound', 'jtgNetIn', 'Waiting…', 'container interface')}
            ${jtgStatCard(ICONS.upload, 'Network outbound', 'jtgNetOut', 'Waiting…', 'container interface')}
          </aside>
        </section>

        <section class="chart-row jtg-chart-row" aria-label="Container resource history">
          <div class="card chart-card"><div class="hd"><b>CPU load</b><span class="tiny dim">${ICONS.chip} Docker history</span></div><div id="chartCpu"><div class="tiny dim">Collecting samples…</div></div></div>
          <div class="card chart-card"><div class="hd"><b>Memory</b><span class="tiny dim">${ICONS.memory} cgroup history</span></div><div id="chartMem"><div class="tiny dim">Collecting samples…</div></div></div>
          <div class="card chart-card"><div class="hd"><b>Network</b><span class="tiny dim">${ICONS.analytics} inbound / outbound</span></div><div id="chartNet"><div class="tiny dim">Collecting samples…</div></div></div>
        </section>

        <section class="grid cols-2 console-bottom-grid jtg-console-details">
          <div class="card jtg-runtime-card"><div class="row between"><div><span class="eyebrow">Docker runtime</span><h3 style="margin:3px 0 0">${esc(server.containerTemplate || 'Container workload')}</h3></div><span class="badge tiny" id="jtgContainerStatus">${esc(STATUS_LABEL[server.status] || server.status)}</span></div><dl class="kv mt"><dt>Purpose</dt><dd>${esc(containerPurpose)}</dd><dt>Image</dt><dd class="mono">${esc(server.dockerImage || 'unknown')}</dd><dt>Hostname</dt><dd class="mono">${esc(identity.hostname || server.containerHostname || 'verifying…')}</dd><dt>OS</dt><dd>${esc((identity.os && (identity.os.prettyName || identity.os.id)) || 'verifying /etc/os-release…')}</dd><dt>Network</dt><dd class="mono">${esc(verifiedIsolation ? (containerIsolation.network || server.containerNetwork || 'verified bridge') : 'verifying dedicated bridge…')}</dd><dt>Namespaces</dt><dd>${verifiedIsolation ? 'Verified private PID, mount, UTS, IPC and network' : 'Verifying Docker namespace policy…'}</dd><dt>Kernel</dt><dd>Shared Docker host kernel by design</dd><dt>Root filesystem</dt><dd>${esc(rootfsLabel)}</dd><dt>Workspace</dt><dd class="mono">/data only</dd><dt>Persistence</dt><dd>Tenant workspace mount; image root filesystem is private</dd></dl></div>
          ${bot ? `<div class="card jtg-bot-card"><div><span class="eyebrow">Bot startup profile</span><h3 style="margin:3px 0 0">Managed ${esc(server.containerTemplate === 'python-3.12' ? 'Python' : 'Node.js')} runtime</h3></div><dl class="kv mt"><dt>Startup file</dt><dd class="mono">/data/${esc(botEntry)}</dd><dt>Startup command</dt><dd class="mono">${esc(botStartupCommand)}</dd><dt>Dependencies</dt><dd>${server.containerTemplate === 'python-3.12' ? 'requirements.txt when present' : 'package.json when present'}</dd><dt>Console</dt><dd>Live application stdout/stderr</dd><dt>Shell</dt><dd>Not exposed for bot runtimes</dd></dl><div class="banner-note mt"><div><b>Upload, then start</b><div class="tiny">Use Files to upload source and dependencies. Start/restart runs the managed command inside this isolated bot container and streams the exact output above.</div></div></div></div>` : `<div class="card jtg-sshx-card"><div class="row between"><div><span class="eyebrow">Browser terminal</span><h3 style="margin:3px 0 0">SSHX session</h3></div><button class="btn sm" id="openSshxSessionAside" data-open-sshx>${ICONS.terminal} Open SSHX</button></div><p class="tiny dim mt">SSHX runs inside this Docker workload. The panel displays only the real URL emitted by its container log.</p><div class="mt" data-sshx-slot>${sshxSlot(server.sshx)}</div></div>`}
        </section>
      </div>`;
    if (!bot) {
      root.querySelector('#openSshxSession').onclick = openSshxSession;
      root.querySelector('#openSshxSessionAside').onclick = openSshxSession;
      updateSshx(server.sshx);
    }
    root.querySelector('#clearLogs').onclick = () => { consoleView.clear(); API.post(`/servers/${id}/logs/clear`).catch(() => {}); };
    root.querySelector('#scrollBottom').onclick = () => { const log = root.querySelector('#terminalBody'); log.scrollTop = log.scrollHeight; };
    const log = root.querySelector('#terminalBody');
    consoleView.el = log; consoleView.clear();
    connectSocket(); loadLive(); powerBar();
  }

  function renderConsole() {
    if (isContainerWorkload(server)) return renderContainerConsole();
    const root = document.getElementById('tab-console');
    const backend = server.backend || 'process';
    const game = isGameWorkload(server);
    const directAddress = `${server.ip || location.hostname}:${server.port}`;
    const allocationText = (server.portAllocations || [server.port]).join(', ');
    const runtimeTitle = game ? `${server.gameName || 'Dedicated game'} runtime` : 'Minecraft runtime';
    const consoleTitle = game ? 'Dedicated game console' : 'Minecraft server console';
    const commandPlaceholder = game ? 'Type a game console command…' : 'Type a Minecraft command…';
    root.innerHTML = `
      <div class="console-page jtg-console-page">
        <section class="jtg-console-grid" aria-label="Live ${game ? 'dedicated game' : 'Minecraft'} server console and telemetry">
          <div class="console-main">
            <section class="console-terminal jtg-log-console" aria-label="${consoleTitle}">
              <div class="console-terminal-head">
                <div class="terminal-title"><span class="terminal-lights"><i></i><i></i><i></i></span><b>Console</b></div>
                <span class="badge tiny" id="socketMode">connecting</span>
                <span class="terminal-meta" id="consoleMeta">${esc(server.serverType)} ${esc(server.version || '')} · ${esc(directAddress)}</span>
                <div class="terminal-actions"><button class="btn ghost sm icon" id="clearLogs" title="Clear terminal view (server log is retained)" aria-label="Clear terminal view">${ICONS.trash}</button><button class="btn ghost sm icon" id="scrollBottom" title="Scroll to latest output" aria-label="Scroll to latest output">${ICONS.download}</button></div>
              </div>
              <div class="terminal-body" id="terminalBody" aria-live="polite">${UI.spinner()} <span class="dim">connecting to the console stream...</span></div>
              <div class="console-input"><span class="prompt" aria-hidden="true">❯</span><input type="text" id="cmdInput" placeholder="${commandPlaceholder}" autocomplete="off" aria-label="Console command"><button class="btn primary" id="cmdSend">Execute</button></div>
            </section>
            <div class="card install-progress" id="installCard" style="display:none"><div class="row between"><h3 style="margin:0">Task progress</h3><span class="tiny dim" id="installNote"></span></div><div class="bar blue mt"><i id="installBar" style="width:0%"></i></div></div>
          </div>

          <aside class="jtg-stat-rail" aria-label="Live Minecraft server metrics">
            ${jtgStatCard(ICONS.globe, 'Server address', 'jtgAddress', directAddress, 'direct allocation')}
            ${jtgStatCard(ICONS.clock, 'Uptime', 'jtgUptime', '—', 'live server session')}
            ${jtgStatCard(ICONS.chip, 'CPU load', 'jtgCpu', '—', backend === 'docker' ? 'Docker cgroup usage' : 'Java process usage')}
            ${jtgStatCard(ICONS.memory, 'Memory', 'jtgMemory', '—', `${server.memory} MB limit`)}
            ${jtgStatCard(ICONS.disk, 'Disk', 'jtgDisk', 'Measuring…', 'server volume')}
            ${jtgStatCard(ICONS.download, 'Network inbound', 'jtgNetIn', 'Waiting…', backend === 'docker' ? 'container interface' : 'node interface')}
            ${jtgStatCard(ICONS.upload, 'Network outbound', 'jtgNetOut', 'Waiting…', backend === 'docker' ? 'container interface' : 'node interface')}
          </aside>
        </section>

        <section class="chart-row jtg-chart-row" aria-label="Server resource history">
          <div class="card chart-card"><div class="hd"><b>CPU load</b><span class="tiny dim">${ICONS.chip} process history</span></div><div id="chartCpu"><div class="tiny dim">Collecting samples…</div></div></div>
          <div class="card chart-card"><div class="hd"><b>Memory</b><span class="tiny dim">${ICONS.memory} RSS history</span></div><div id="chartMem"><div class="tiny dim">Collecting samples…</div></div></div>
          <div class="card chart-card"><div class="hd"><b>Network</b><span class="tiny dim">${ICONS.analytics} inbound / outbound</span></div><div id="chartNet"><div class="tiny dim">Collecting samples…</div></div></div>
        </section>

        <section class="grid cols-2 console-bottom-grid jtg-console-details">
          <div class="card jtg-runtime-card"><div class="row between"><div><span class="eyebrow">${esc(runtimeTitle)}</span><h3 style="margin:3px 0 0">${esc(game ? (server.gameName || 'Dedicated game') : `${server.serverType} ${server.version || ''}`)}</h3></div><span class="badge tiny" id="jtgContainerStatus">${esc(STATUS_LABEL[server.status] || server.status)}</span></div><dl class="kv mt"><dt>Backend</dt><dd>${backend === 'docker' ? 'Docker container' : 'Java process'}</dd><dt>${game ? 'SteamCMD app' : 'Java'}</dt><dd>${game ? esc(String(server.gameAppId || '—')) : (backend === 'docker' ? esc(server.dockerImage || 'managed image') : `Java ${esc(String(server.javaVersion || '?'))}`)}</dd><dt>${game ? 'Ports' : 'Route'}</dt><dd id="publicAddr">${server.playit && server.playit.publicAddress ? esc(server.playit.publicAddress) : (game ? esc(allocationText) : 'not tunnelled')}</dd></dl><button class="btn sm mt" id="gotoNetwork">${ICONS.globe} Manage network</button></div>
          <div class="card jtg-command-card"><div class="row between"><div><span class="eyebrow">${game ? 'Game controls' : 'Server controls'}</span><h3 style="margin:3px 0 0">${game ? 'Console input' : 'Quick commands'}</h3></div>${game ? `<span class="badge tiny">${server.maxPlayers} player slots</span>` : `<button class="btn sm" id="gotoPlayers">${ICONS.users2} Players <span class="badge tiny mono" id="playerCount">0 / ${server.maxPlayers}</span></button>`}</div>${game ? `<div class="tiny dim mt">Commands are sent to this game’s real standard input when its dedicated binary supports a console. Use the game’s configuration files in Files for title-specific settings.</div>` : `<div class="chips mt" id="quickCmds">${['list', 'save-all', 'whitelist list', 'tps', 'time set day', 'weather clear', 'say Server restart in 5 minutes', 'worldborder center 0 0'].map((c) => `<button class="chip command-chip" data-cmd="${esc(c)}">${esc(c)}</button>`).join('')}</div>`}</div>
        </section>
      </div>`;

    const gotoNetwork = root.querySelector('#gotoNetwork');
    if (gotoNetwork) gotoNetwork.onclick = () => setTab('network');
    const gotoPlayers = root.querySelector('#gotoPlayers');
    if (gotoPlayers) gotoPlayers.onclick = () => setTab('players');
    root.querySelector('#clearLogs').onclick = () => { consoleView.clear(); API.post(`/servers/${id}/logs/clear`).catch(() => {}); };
    root.querySelector('#scrollBottom').onclick = () => { const b = root.querySelector('#terminalBody'); b.scrollTop = b.scrollHeight; };
    const cmdInput = root.querySelector('#cmdInput');
    const sendCmd = () => {
      const cmd = cmdInput.value.trim();
      if (!cmd) return;
      if (socket) socket.command(cmd);
      else API.post(`/servers/${id}/command`, { command: cmd }).catch((e) => UI.toast(e.message, 'error'));
      cmdInput.value = '';
    };
    root.querySelector('#cmdSend').onclick = sendCmd;
    cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCmd(); });
    root.querySelectorAll('[data-cmd]').forEach((c) => c.onclick = () => { cmdInput.value = c.dataset.cmd; cmdInput.focus(); });

    const body = root.querySelector('#terminalBody');
    consoleView.el = body;
    consoleView.clear();
    connectSocket();
    loadLive();
    powerBar();
  }

  /* ------------------------- live console meters ------------------------- */
  const history = { cpu: [], mem: [], net: [] };
  const HISTORY_MAX = 48;

  function pushHistory(key, value) {
    if (!Number.isFinite(value)) return;
    history[key].push({ at: Date.now(), v: value });
    if (history[key].length > HISTORY_MAX) history[key].shift();
  }

  function drawCharts() {
    const cpuBox = document.getElementById('chartCpu');
    const memBox = document.getElementById('chartMem');
    const netBox = document.getElementById('chartNet');
    if (cpuBox && history.cpu.length) cpuBox.innerHTML = Chart.area(history.cpu, { key: 'v', color: 'var(--blue)', height: 96, unit: '%', max: null, label: 'CPU of this server' });
    if (memBox && history.mem.length) {
      memBox.innerHTML = Chart.area(history.mem, { key: 'v', color: 'var(--green)', height: 96, unit: '', label: 'RSS of the server process' });
    }
    if (netBox && history.net.length) netBox.innerHTML = Chart.area(history.net, { key: 'v', color: 'var(--violet)', height: 96, unit: '', label: 'bytes/s' });
  }

  function connectSocket() {
    if (socket) socket.close();
    socket = new ConsoleSocket(id, {
      onState(state) {
        const el = document.getElementById('socketMode');
        if (!el) return;
        el.textContent = state === 'open' ? 'live (websocket)' : state === 'polling' ? 'live (polling)' : 'reconnecting';
        el.className = `badge tiny ${state === 'open' ? 'green' : state === 'polling' ? 'yellow' : 'red'}`;
      },
      onEvent(msg) {
        if (msg.type === 'log') consoleView.append(msg.data);
        else if (msg.type === 'status') { updateStatus(msg.data.status); }
        else if (msg.type === 'stats') { updateStats(msg.data); }
        else if (msg.type === 'players') { updatePlayers(msg.data); }
        else if (msg.type === 'install') { updateInstall(msg.data); }
        else if (msg.type === 'playit') { if (server) server.playit = { ...server.playit, ...msg.data }; }
        else if (msg.type === 'sshx') { updateSshx(msg.data); }
        else if (msg.type === 'error') { UI.toast(msg.message, 'error'); }
      },
    });
  }

  function updateStatus(status) {
    if (!server) return;
    const containerState = document.getElementById('containerRuntimeStatus');
    if (containerState) containerState.textContent = STATUS_LABEL[status] || status;
    const jtgContainerState = document.getElementById('jtgContainerStatus');
    if (jtgContainerState) jtgContainerState.textContent = STATUS_LABEL[status] || status;
    if (server.status === status) return;
    server.status = status;
    const el = document.getElementById('liveStatus');
    if (el) {
      el.className = `status-line ${status}`;
      el.innerHTML = `<i></i>${esc(STATUS_LABEL[status] || status)}`;
    }
    const drawerState = document.querySelector('.server-drawer-foot');
    if (drawerState) {
      const tone = status === 'running' ? 'green' : ['starting', 'installing', 'stopping'].includes(status) ? 'yellow' : 'red';
      const node = server.nodeName || 'Local Node';
      drawerState.innerHTML = `<span class="dot ${tone}"></span><span>${esc(STATUS_LABEL[status] || status)}</span><span class="server-node-name">${ICONS.node}${esc(node)}</span>`;
    }
    powerBar();
  }

  function updateStats(data) {
    const cpu = Number(data.cpu || 0);
    const cpuPercentOfLimit = Number.isFinite(Number(data.cpuPercentOfLimit)) ? Number(data.cpuPercentOfLimit) : null;
    const cpuForLimit = cpuPercentOfLimit === null ? cpu : cpuPercentOfLimit;
    const memPercent = Number(data.memory || 0);
    const limit = data.memoryLimitBytes || server.memory * 1048576;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const width = (id, p) => { const el = document.getElementById(id); if (el) el.style.width = `${Math.min(p || 0, 100)}%`; };
    set('cpuText', `${cpu.toFixed(1)}%`);
    set('statCpu', `${cpu.toFixed(2)}%`);
    width('cpuBar', cpuForLimit);
    set('memText', `${fmt.bytes(data.memoryBytes || 0)} / ${fmt.bytes(limit)}`);
    set('statMemory', `${fmt.bytes(data.memoryBytes || 0)} / ${fmt.bytes(limit)}`);
    width('memBar', memPercent);
    set('uptimeBadge', data.uptime ? `up ${fmt.duration(data.uptime)}` : 'offline');
    set('statUptime', data.uptime ? fmt.duration(data.uptime) : 'stopped');
    // JTG metric rail on both Minecraft and Docker consoles. These values come
    // directly from the live process/cgroup sample — no estimates.
    const online = ['running', 'starting'].includes(String(data.status || server.status));
    set('jtgCpu', online ? (cpuPercentOfLimit === null ? `${cpu.toFixed(2)}%` : `${cpuPercentOfLimit.toFixed(1)}% of limit`) : '—');
    set('jtgMemory', online ? `${fmt.bytes(data.memoryBytes || 0)} / ${fmt.bytes(limit)}` : '—');
    set('jtgUptime', data.uptime ? fmt.duration(data.uptime) : '—');
    pushHistory('cpu', cpu);
    pushHistory('mem', Number(data.memoryBytes || 0));
    drawCharts();
    if (data.status) updateStatus(data.status);
    if (data.installProgress) updateInstall(data.installProgress);
  }

  let playerActions = [];
  function updatePlayers(players) {
    const list = document.getElementById('playerList');
    const count = document.getElementById('playerCount');
    const arr = players || [];
    if (count) count.textContent = `${arr.length} / ${server.maxPlayers}`;
    if (list) {
      list.innerHTML = arr.length
        ? `<div class="chips">${arr.map((p) => `<span class="player-pill">${playerHead(p.name, { size: 20, online: true })}${esc(p.name)}</span>`).join('')}</div>
           <button class="btn sm block mt" id="openPlayerManager">${ICONS.users2} Manage players</button>`
        : '<span class="tiny dim">nobody online</span>';
      const open = document.getElementById('openPlayerManager');
      if (open) open.onclick = () => setTab('players');
    }
    const tab = document.getElementById('tab-players');
    if (tab && rendered.players) renderPlayersList(arr);
  }

  /** Read the action catalogue once, then keep the Players tab in sync. */
  async function loadPlayerMeta() {
    try {
      const data = await Players.fetch(id);
      playerActions = data.actions || [];
      updatePlayers(data.players || []);
    } catch (_) {}
  }

  function renderPlayersList(arr) {
    const el = document.getElementById('serverPlayers');
    if (!el) return;
    Players.mount(el, {
      serverId: id,
      players: arr,
      max: server.maxPlayers || 20,
      status: server.status,
      actions: playerActions,
      emptyText: 'Nobody is online right now',
    });
  }

  function updateInstall(progress) {
    const card = document.getElementById('installCard');
    const bar = document.getElementById('installBar');
    const note = document.getElementById('installNote');
    if (!card || !progress) return;
    if (progress.percent >= 100) {
      card.style.display = 'none';
      server.installProgress = null;
      loadServer().then(() => { header(); });
      return;
    }
    card.style.display = '';
    bar.style.width = `${progress.percent || 0}%`;
    note.textContent = progress.note || progress.step || '';
  }

  /** One poll for everything the console page shows (no invented numbers). */
  async function loadLive() {
    try {
      const data = await API.get(`/servers/${id}/live`);
      const set = (elId, text) => { const el = document.getElementById(elId); if (el) el.textContent = text; };
      if (data.disk) {
        set('diskText', data.disk.pretty);
        set('statDisk', data.disk.limit ? `${data.disk.pretty} / ${fmt.bytes(data.disk.limit)}` : data.disk.pretty);
        set('jtgDisk', data.disk.limit ? `${data.disk.pretty} / ${fmt.bytes(data.disk.limit)}` : data.disk.pretty);
        const limit = data.diskLimitBytes || null;
        const bar = document.getElementById('diskBar');
        if (bar) bar.style.width = limit ? `${Math.min((data.disk.bytes / limit) * 100, 100)}%` : '6%';
      } else {
        set('statDisk', 'not measured');
        set('jtgDisk', 'Not measured');
      }
      if (data.sshx) updateSshx(data.sshx);
      if (data.net) {
        set('statNetIn', data.net.in);
        set('statNetOut', data.net.out);
        set('jtgNetIn', `↓ ${data.net.in}`);
        set('jtgNetOut', `↑ ${data.net.out}`);
        const scope = document.getElementById('netScope');
        if (scope) scope.textContent = data.net.scope === 'container' ? 'container in/out' : 'node in/out (panel host)';
        pushHistory('net', parseRate(data.net.in) + parseRate(data.net.out));
        drawCharts();
      } else {
        set('statNetIn', 'not measured');
        set('statNetOut', 'not measured');
        set('jtgNetIn', 'Not measured');
        set('jtgNetOut', 'Not measured');
      }
      const addr = document.getElementById('statAddress');
      if (addr && server.playit && server.playit.publicAddress) addr.textContent = server.playit.publicAddress;
      // A Minecraft JTG rail shows the actual tunnel when one exists, otherwise
      // the server's assigned allocation. Generic Docker workloads deliberately
      // retain their honest “Not published” service-port card.
      if (!isContainerWorkload(server)) {
        const jtgAddress = document.getElementById('jtgAddress');
        if (jtgAddress) jtgAddress.textContent = (server.playit && server.playit.publicAddress) || `${server.ip || location.hostname}:${server.port}`;
      }
      if (data.players) updatePlayers(data.players);
      if (data.stats) updateStats({ ...data.stats, status: data.status, uptime: data.uptime });
      const meta = document.getElementById('consoleMeta');
      if (meta) {
        meta.textContent = isContainerWorkload(server)
          ? `${server.dockerImage || server.containerTemplate || 'Docker image'} | Docker${data.container ? ` (${data.container})` : ''} | /data`
          : isGameWorkload(server)
            ? `${server.gameName || 'Dedicated game'} | SteamCMD app ${server.gameAppId || '?'} | Docker${data.container ? ` (${data.container})` : ''} | ${(server.portAllocations || [server.port]).join(', ')}`
            : `${server.serverType} ${server.version || ''} | ${data.backend || 'process'}${data.container ? ` (${data.container})` : ''} | ${location.hostname}:${server.port}`;
      }
    } catch (_) {}
  }

  /** "12.5kB/s" or "182 KiB" -> bytes. Returns 0 when the text is not a size. */
  function parseRate(text) {
    const m = String(text || '').match(/([0-9.]+)\s*([kKmMgG]?)(i?)[bB]/);
    if (!m) return 0;
    const mult = { '': 1, k: 1024, m: 1048576, g: 1073741824 }[m[2].toLowerCase()] || 1;
    return Number(m[1]) * mult;
  }

  async function loadActivity() {
    try {
      const data = await API.get(`/servers/${id}/activity`);
      const el = document.getElementById('serverActivity');
      el.innerHTML = data.activity.length
        ? data.activity.slice(0, 8).map((a) => `<div class="row between" style="padding:4px 0"><span><span class="dim">${esc(a.action)}</span> ${esc(a.detail || '')}</span><span class="dim">${fmt.timeAgo(a.at)}</span></div>`).join('')
        : '<span class="dim">No activity yet</span>';
    } catch (_) {}
  }

  /* ================================ players ================================ */
  async function renderPlayersTab() {
    const root = document.getElementById('tab-players');
    root.innerHTML = `
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start">
        <div class="card">
          <div class="row between wrap" style="gap:10px">
            <div>
              <h3 style="margin:0">Online players</h3>
              <div class="tiny dim mt">Live list - press an action to run the matching console command.</div>
            </div>
            <div class="row wrap" style="gap:7px">
              <button class="btn sm" id="pRefresh">${ICONS.refresh} Ask server</button>
              <button class="btn sm" id="pByName">${ICONS.plus} Act by name</button>
            </div>
          </div>
          <div class="divider"></div>
          <div id="serverPlayers">${UI.skeleton(3)}</div>
        </div>
        <div class="stack">
          <div class="card">
            <h3>Server status</h3>
            <div class="stack mt" style="gap:8px">
              <div class="kv"><span>State</span><b id="pState">${esc(server.status)}</b></div>
              <div class="kv"><span>Online</span><b id="pCount">0 / ${server.maxPlayers || 20}</b></div>
              <div class="kv"><span>Max players</span><b>${server.maxPlayers || 20}</b></div>
              <div class="kv"><span>Whitelist</span><b id="pWhitelist">-</b></div>
              <div class="kv"><span>Address</span><b>${esc(server.ip)}:${server.port}</b></div>
            </div>
          </div>
          <div class="card">
            <div class="row between"><h3 style="margin:0">Whitelist & bans</h3></div>
            <div class="chips mt">
              <button class="btn sm" data-wl="list">${ICONS.users2} whitelist list</button>
              <button class="btn sm" data-wl="on">${ICONS.check} whitelist on</button>
              <button class="btn sm" data-wl="off">${ICONS.close} whitelist off</button>
              <button class="btn sm" data-wl="reload">${ICONS.refresh} whitelist reload</button>
              <button class="btn sm" data-wl="banlist">${ICONS.ban} banlist</button>
              <button class="btn sm" data-wl="save">${ICONS.save} save-all</button>
            </div>
            <div class="tiny dim mt">Output shows up in the console tab.</div>
          </div>
          <div class="card">
            <h3>Recent player events</h3>
            <div class="mt" id="playerEvents">${UI.skeleton(2)}</div>
          </div>
        </div>
      </div>`;

    const runCommand = async (command) => {
      try { await API.post(`/servers/${id}/command`, { command }); UI.toast(`Sent: ${command}`, 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
    };
    root.querySelectorAll('[data-wl]').forEach((b) => {
      b.onclick = () => {
        const map = { list: 'whitelist list', on: 'whitelist on', off: 'whitelist off', reload: 'whitelist reload', banlist: 'banlist', save: 'save-all' };
        runCommand(map[b.dataset.wl]);
      };
    });
    root.querySelector('#pRefresh').onclick = async () => {
      try { await API.post(`/servers/${id}/players/refresh`); UI.toast('Asked the server for its list', 'info'); } catch (err) { UI.toast(err.message, 'error'); }
    };
    root.querySelector('#pByName').onclick = () => Players.openActions(id, '', playerActions);

    try {
      const data = await Players.fetch(id);
      playerActions = data.actions || [];
      const state = root.querySelector('#pState');
      if (state) state.textContent = data.status;
      const count = root.querySelector('#pCount');
      if (count) count.textContent = `${data.count} / ${data.max}`;
      renderPlayersList(data.players || []);
      if (data.status === 'running') API.post(`/servers/${id}/players/refresh`).catch(() => {});
    } catch (err) {
      root.querySelector('#serverPlayers').innerHTML = UI.empty('Could not load players', err.message);
    }

    try {
      const events = await API.get(`/servers/${id}/activity`);
      const rows = (events.activity || []).filter((a) => String(a.action).startsWith('player.')).slice(0, 12);
      const el = root.querySelector('#playerEvents');
      el.innerHTML = rows.length
        ? rows.map((a) => `<div class="row between" style="padding:5px 0;border-bottom:1px solid var(--line-subtle)">
             <span style="font-size:12.5px">${esc(a.detail || a.action)}</span><span class="tiny dim">${fmt.timeAgo(a.at)}</span></div>`).join('')
        : '<span class="tiny dim">Nothing yet - actions you run here are logged with the player name.</span>';
    } catch (_) {}
  }

  /* ================================ files ================================ */
  async function renderFiles(path = '') {
    const root = document.getElementById('tab-files');
    root.innerHTML = `<div class="card flush">
      <div class="files-toolbar">
        <div class="grow crumbs" id="crumbs">${UI.spinner(13)}</div>
        <input type="search" id="fileSearch" placeholder="search files..." style="max-width:190px">
        <button class="btn sm" id="newFolder">${ICONS.plus} Folder</button>
        <button class="btn sm" id="uploadBtn">${ICONS.upload} Upload</button>
        <input type="file" id="fileInput" multiple style="display:none">
      </div>
      <div id="fileList">${UI.skeleton(6)}</div>
      <div class="card-body" id="dropAreaWrap"></div>
    </div>`;

    const listEl = root.querySelector('#fileList');
    const dropWrap = root.querySelector('#dropAreaWrap');
    dropWrap.innerHTML = `<div class="dropzone" id="dropzone">Drop files here to upload to <b id="dropPath">/</b></div>`;

    async function browse(p) {
      path = p;
      root.dataset.path = p;
      try {
        const data = await API.get(`/servers/${id}/files?path=${encodeURIComponent(p)}`);
        renderCrumbs(data);
        dropWrap.querySelector('#dropPath').textContent = `/${p}`;
        listEl.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${data.entries.map(row).join('') || `<tr><td colspan="5">${UI.empty('This folder is empty')}</td></tr>`}</tbody>
        </table></div>`;
      } catch (err) {
        listEl.innerHTML = `<div class="card-body">${UI.empty(err.message)}</div>`;
      }
    }

    function renderCrumbs(data) {
      const parts = data.path.split('/').filter(Boolean);
      const crumbs = [`<a data-path="">root</a>`];
      let acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        crumbs.push(`<span class="dim">/</span><a data-path="${esc(acc)}">${esc(part)}</a>`);
      }
      const el = root.querySelector('#crumbs');
      el.innerHTML = crumbs.join(' ');
      el.querySelectorAll('a').forEach((a) => a.onclick = () => browse(a.dataset.path));
    }

    function row(f) {
      const icon = f.type === 'directory' ? ICONS.folder : ICONS.info;
      return `<tr data-path="${esc(f.path)}">
        <td style="width:26px;padding-right:0"><span style="width:15px;display:inline-block;color:var(--fg-faint)">${icon}</span></td>
        <td>
          <span style="cursor:pointer" data-open="${f.type === 'directory' ? 'dir' : 'file'}" data-editable="${f.editable}" style="font-weight:${f.type === 'directory' ? '600' : '400'}">${esc(f.name)}</span>
          ${f.archive ? '<span class="chip" style="margin-left:6px">archive</span>' : ''}
        </td>
        <td class="mono tiny">${f.type === 'directory' ? '-' : f.sizePretty}</td>
        <td class="tiny dim">${fmt.timeAgo(f.modified)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${f.type === 'file' ? `<button class="btn sm ghost" data-download="${esc(f.path)}" title="Download">${ICONS.download}</button>` : ''}
          ${f.archive ? `<button class="btn sm ghost" data-unzip="${esc(f.path)}" title="Extract">unzip</button>` : ''}
          <button class="btn sm ghost" data-rename="${esc(f.path)}" title="Rename">rename</button>
          <button class="btn sm ghost" data-delete="${esc(f.path)}" title="Delete">${ICONS.trash}</button>
        </td>
      </tr>`;
    }

    root.addEventListener('click', async (e) => {
      const open = e.target.closest('[data-open]');
      if (open) {
        const name = open.textContent;
        const full = open.closest('tr').dataset.path;
        if (open.dataset.open === 'dir') return browse(full);
        if (open.dataset.editable === 'true') return editFile(full);
        UI.toast('Binary file - use download instead', 'warn');
        return;
      }
      const dl = e.target.closest('[data-download]');
      if (dl) {
        window.location = `/api/servers/${id}/files/download?path=${encodeURIComponent(dl.dataset.download)}&token=${store.token}`;
        return;
      }
      const un = e.target.closest('[data-unzip]');
      if (un) {
        un.disabled = true;
        try { const r = await API.post(`/servers/${id}/files/unzip`, { path: un.dataset.unzip }); UI.toast(`Extracted ${r.extracted}`, 'success'); browse(path); }
        catch (err) { UI.toast(err.message, 'error'); }
        un.disabled = false;
        return;
      }
      const rn = e.target.closest('[data-rename]');
      if (rn) {
        const from = rn.dataset.rename;
        const to = prompt('New name / path:', from);
        if (!to || to === from) return;
        try { await API.post(`/servers/${id}/files/rename`, { from, to }); UI.toast('Renamed', 'success'); browse(path); }
        catch (err) { UI.toast(err.message, 'error'); }
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!(await UI.confirm(`Delete ${del.dataset.delete}? This cannot be undone.`, { confirmText: 'Delete' }))) return;
        try { await API.post(`/servers/${id}/files/delete`, { paths: [del.dataset.delete] }); UI.toast('Deleted', 'success'); browse(path); }
        catch (err) { UI.toast(err.message, 'error'); }
      }
    });

    async function editFile(file) {
      try {
        const data = await API.get(`/servers/${id}/files/content?path=${encodeURIComponent(file)}`);
        UI.modal({
          title: file,
          wide: true,
          body: `<textarea id="editor" style="min-height:52vh">${esc(data.content)}</textarea>`,
          footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveFile">${ICONS.save} Save</button>`,
          onMount(modalRoot, { close }) {
            modalRoot.querySelector('#saveFile').onclick = async (e) => {
              const btn = e.target.closest('button');
              btn.disabled = true;
              try {
                await API.post(`/servers/${id}/files/content`, { path: file, content: modalRoot.querySelector('#editor').value });
                UI.toast('File saved', 'success');
                close();
              } catch (err) { UI.toast(err.message, 'error'); }
              btn.disabled = false;
            };
          },
        });
      } catch (err) { UI.toast(err.message, 'error'); }
    }

    root.querySelector('#newFolder').onclick = async () => {
      const name = prompt('Folder name:');
      if (!name) return;
      try { await API.post(`/servers/${id}/files/mkdir`, { path: `${path ? `${path}/` : ''}${name}` }); browse(path); UI.toast('Folder created', 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    const fileInput = root.querySelector('#fileInput');
    root.querySelector('#uploadBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => uploadFiles(fileInput.files);
    async function uploadFiles(files) {
      if (!files || !files.length) return;
      const form = new FormData();
      form.append('path', path);
      [...files].forEach((f) => form.append('files', f));
      UI.toast(`Uploading ${files.length} file(s)...`, 'info');
      try {
        const res = await API.request(`/servers/${id}/files/upload`, { method: 'POST', body: form });
        UI.toast(`Uploaded ${res.count} file(s) (${res.totalPretty})`, 'success');
        browse(path);
      } catch (err) { UI.toast(err.message, 'error'); }
    }

    const dz = dropWrap.querySelector('#dropzone');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
    dz.addEventListener('drop', (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });

    root.querySelector('#fileSearch').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const q = e.target.value.trim();
      if (!q) return browse(path);
      try {
        const data = await API.get(`/servers/${id}/files/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(path)}`);
        listEl.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Size</th><th>Path</th><th></th></tr></thead>
          <tbody>${data.results.map((r) => `<tr><td>${esc(r.name)}</td><td class="tiny mono">${esc(r.sizePretty)}</td><td class="tiny dim mono">${esc(r.path)}</td>
            <td style="text-align:right"><button class="btn sm ghost" data-download="${esc(r.path)}">${ICONS.download}</button></td></tr>`).join('') || `<tr><td colspan="4">${UI.empty('No matches')}</td></tr>`}</tbody></table></div>`;
      } catch (err) { UI.toast(err.message, 'error'); }
    });

    browse(path);
  }

  /* ================================ modrinth ================================ */
  /**
   * Modrinth manager. `mode` is 'plugin' or 'mod': JTG keeps the two as separate
   * tabs, so this renderer is shared and every element id is suffixed with the
   * mode (two live tabs must not collide on ids).
   */
  async function renderPlugins(mode) {
    const forced = mode === 'mod' ? 'mod' : (mode === 'plugin' ? 'plugin' : '');
    const root = document.getElementById(forced === 'mod' ? 'tab-mods' : 'tab-plugins');
    const uid = forced === 'mod' ? 'mod' : 'plugin';
    const isMods = forced === 'mod' || (!forced && supportsMods(server));
    const qs = (sel) => root.querySelector(sel);
    const typeParam = forced ? `type=${forced}` : '';
    root.innerHTML = `
      <div class="tabs" style="margin-bottom:14px">
        <button class="active" data-ptab="installed">Installed</button>
        <button data-ptab="browse">Browse Modrinth</button>
      </div>
      <div id="ptab-installed">
        <div class="row between" style="margin-bottom:12px">
          <div class="row" style="gap:8px">
            <input type="search" id="installedSearch-${uid}" placeholder="filter installed..." style="max-width:220px">
            <button class="btn sm" id="checkUpdates-${uid}">${ICONS.refresh} Check for updates</button>
          </div>
          <span class="badge" id="installedCount-${uid}"></span>
        </div>
        <div class="card flush"><div id="installedList-${uid}">${UI.skeleton(4)}</div></div>
      </div>
      <div id="ptab-browse" style="display:none">
        <div class="card" style="margin-bottom:14px">
          <div class="row wrap" style="gap:10px">
            <div class="grow" style="min-width:220px"><input type="search" id="modSearch-${uid}" placeholder="Search ${isMods ? 'mods' : 'plugins'} on Modrinth..." ></div>
            <select id="modLoader-${uid}" style="max-width:170px"><option value="">any loader</option></select>
            <select id="modGameVersion-${uid}" style="max-width:150px"><option value="">any version</option></select>
            <select id="modSort-${uid}" style="max-width:170px">
              <option value="relevance">Sort: relevance</option>
              <option value="downloads">Sort: downloads</option>
              <option value="updated">Sort: updated</option>
              <option value="newest">Sort: newest</option>
            </select>
            <button class="btn primary sm" id="modSearchBtn-${uid}">${ICONS.search} Search</button>
          </div>
          <div class="tiny dim mt">Downloads install straight into <span class="mono">/${isMods ? 'mods' : 'plugins'}</span> with required dependencies, matched to ${esc(server.serverType)} ${esc(server.version)}.</div>
        </div>
        <div id="modResults-${uid}" class="grid cols-2"></div>
        <div class="row center mt" style="justify-content:center"><button class="btn sm" id="modMore-${uid}" style="display:none">Load more</button></div>
      </div>`;

    root.querySelectorAll('[data-ptab]').forEach((b) => b.onclick = () => {
      root.querySelectorAll('[data-ptab]').forEach((x) => x.classList.toggle('active', x === b));
      root.querySelector('#ptab-installed').style.display = b.dataset.ptab === 'installed' ? '' : 'none';
      root.querySelector('#ptab-browse').style.display = b.dataset.ptab === 'browse' ? '' : 'none';
      if (b.dataset.ptab === 'browse' && !root.dataset.browsed) { root.dataset.browsed = '1'; searchMods(true); }
    });

    // filters
    try {
      const meta = await API.get(`/modrinth/servers/${id}/packages`);
      const loaderSel = root.querySelector(`#modLoader-${uid}`);
      meta.loaders.forEach((l) => loaderSel.insertAdjacentHTML('beforeend', `<option value="${l}">${l}</option>`));
      const vSel = root.querySelector(`#modGameVersion-${uid}`);
      vSel.insertAdjacentHTML('beforeend', `<option value="${esc(meta.gameVersion)}" selected>${esc(meta.gameVersion)} (server)</option>`);
    } catch (_) {}

    async function loadInstalled() {
      const wrap = root.querySelector(`#installedList-${uid}`);
      try {
        const data = await API.get(`/modrinth/servers/${id}/packages${typeParam ? `?${typeParam}` : ''}`);
        root.querySelector(`#installedCount-${uid}`).textContent = `${data.packages.length} installed`;
        if (!data.packages.length) {
          wrap.innerHTML = UI.empty(`No ${isMods ? 'mods' : 'plugins'} installed yet`, 'Use the Browse tab to install from Modrinth, or upload jars in the Files tab.');
          return;
        }
        const q = (root.querySelector(`#installedSearch-${uid}`).value || '').toLowerCase();
        const list = data.packages.filter((p) => !q || (p.title || '').toLowerCase().includes(q));
        wrap.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr><th>${isMods ? 'Mod' : 'Plugin'}</th><th>Version</th><th>Size</th><th>Source</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${list.map((p) => `<tr data-pkg="${esc(p.id)}">
            <td>
              <div class="row" style="gap:9px">
                ${p.icon ? `<img class="plugin-icon" style="width:30px;height:30px;flex:0 0 30px;border-radius:7px" src="${esc(iconSrc(p.icon))}" onerror="this.style.display='none'">` : ''}
                <div><div style="font-weight:600">${esc(p.title)}</div><div class="tiny dim mono truncate" style="max-width:280px">${esc(p.filename)}${p.dependency ? ' · dependency' : ''}</div></div>
              </div>
            </td>
            <td class="mono tiny">${esc(p.version || '')}<div class="tiny dim">${esc(p.versionType || '')}</div></td>
            <td class="mono tiny">${esc(p.sizePretty || '')}</td>
            <td class="tiny">${p.projectId ? `<a href="https://modrinth.com/project/${esc(p.slug || p.projectId)}" target="_blank" style="color:var(--blue)">Modrinth</a>` : '<span class="dim">manual</span>'}</td>
            <td>${p.enabled === false ? '<span class="badge yellow">disabled</span>' : '<span class="badge green">enabled</span>'}${!p.exists ? ' <span class="badge red">missing</span>' : ''}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn sm ghost" data-toggle="${esc(p.id)}" data-enabled="${p.enabled !== false}">${p.enabled === false ? 'enable' : 'disable'}</button>
              ${p.projectId ? `<button class="btn sm ghost" data-update="${esc(p.id)}">update</button>` : ''}
              <button class="btn sm ghost" data-remove="${esc(p.id)}" data-name="${esc(p.filename)}">${ICONS.trash}</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`;

        wrap.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
          try { await API.post(`/modrinth/servers/${id}/packages/toggle`, { id: b.dataset.toggle, enabled: b.dataset.enabled !== 'true' }); loadInstalled(); }
          catch (err) { UI.toast(err.message, 'error'); }
        });
        wrap.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
          if (!(await UI.confirm(`Delete ${b.dataset.name}?`, { confirmText: 'Delete' }))) return;
          try { await API.del(`/modrinth/servers/${id}/packages/${b.dataset.remove}`); UI.toast('Removed', 'success'); loadInstalled(); }
          catch (err) { UI.toast(err.message, 'error'); }
        });
        wrap.querySelectorAll('[data-update]').forEach((b) => b.onclick = async () => {
          b.disabled = true; b.textContent = '...';
          try {
            const r = await API.post(`/modrinth/servers/${id}/packages/update`, { id: b.dataset.update, type: forced || undefined });
            UI.toast(`Updated ${r.filename}: ${r.from} -> ${r.to}`, 'success');
            loadInstalled();
          } catch (err) { UI.toast(err.message, 'error'); loadInstalled(); }
        });
      } catch (err) {
        wrap.innerHTML = `<div class="card-body">${UI.empty(err.message)}</div>`;
      }
    }

    root.querySelector(`#installedSearch-${uid}`).addEventListener('input', () => loadInstalled());
    root.querySelector(`#checkUpdates-${uid}`).onclick = async (e) => {
      const btn = e.target.closest('button');
      btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Checking...`;
      try {
        const data = await API.get(`/modrinth/servers/${id}/packages/updates`);
        UI.toast(data.count ? `${data.count} update(s) available` : 'Everything is up to date', data.count ? 'warn' : 'success');
        data.results.filter((r) => r.updateAvailable).forEach((r) => {
          const btn2 = root.querySelector(`[data-update="${r.id}"]`);
          if (btn2) { btn2.classList.remove('ghost'); btn2.classList.add('yellow'); btn2.textContent = `update -> ${r.latest}`; }
        });
      } catch (err) { UI.toast(err.message, 'error'); }
      btn.disabled = false; btn.innerHTML = `${ICONS.refresh} Check for updates`;
    };

    let offset = 0;
    let lastQuery = '';
    async function searchMods(reset = false) {
      const q = root.querySelector(`#modSearch-${uid}`).value.trim();
      const params = new URLSearchParams({
        q,
        ...(forced ? { type: forced } : {}),
        loader: root.querySelector(`#modLoader-${uid}`).value,
        sort: root.querySelector(`#modSort-${uid}`).value,
        limit: '20',
        offset: String(reset ? 0 : offset),
      });
      if (!reset && q !== lastQuery) offset = 0;
      lastQuery = q;
      const results = root.querySelector(`#modResults-${uid}`);
      if (reset) results.innerHTML = `<div class="card">${UI.skeleton(3)}</div><div class="card">${UI.skeleton(3)}</div>`;
      try {
        const data = await API.get(`/modrinth/servers/${id}/browse?${params}`);
        offset = (data.offset || 0) + (data.hits || []).length;
        const html = (data.hits || []).map((h) => `
          <div class="card plugin-card">
            ${h.icon ? `<img class="plugin-icon" src="${esc(iconSrc(h.icon))}" onerror="this.style.visibility='hidden'">` : '<div class="plugin-icon"></div>'}
            <div class="grow">
              <div class="row between" style="gap:8px">
                <b class="truncate">${esc(h.title)}</b>
                <span class="tiny dim mono">${fmt.num(h.downloads)} ↓</span>
              </div>
              <div class="desc">${esc(h.description)}</div>
              <div class="chips mt">
                <span class="chip violet">${esc(h.projectType)}</span>
                ${(h.categories || []).slice(0, 3).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}
                ${h.versions && h.versions.length ? `<span class="chip">${esc(h.versions[h.versions.length - 1])}+</span>` : ''}
              </div>
              <div class="row mt" style="gap:7px">
                <button class="btn sm primary" data-install="${esc(h.projectId)}" data-title="${esc(h.title)}" data-type="${esc(h.projectType || '')}">Install</button>
                <button class="btn sm" data-builds="${esc(h.slug || h.projectId)}" data-title="${esc(h.title)}" data-icon="${esc(h.icon || '')}" data-type="${esc(h.projectType || '')}">Pick build...</button>
                <button class="btn sm" data-details="${esc(h.slug || h.projectId)}">Details</button>
                <a class="btn sm ghost" href="https://modrinth.com/project/${esc(h.slug)}" target="_blank">Modrinth ↗</a>
              </div>
            </div>
          </div>`).join('');
        if (reset) results.innerHTML = html || `<div style="grid-column:1/-1">${UI.empty('No results', 'Try a different search term or loader.')}</div>`;
        else results.insertAdjacentHTML('beforeend', html);
        root.querySelector(`#modMore-${uid}`).style.display = html ? '' : 'none';
      } catch (err) {
        results.innerHTML = `<div style="grid-column:1/-1">${UI.empty(err.message)}</div>`;
      }
    }

    root.querySelector(`#modSearchBtn-${uid}`).onclick = () => searchMods(true);
    root.querySelector(`#modSearch-${uid}`).addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMods(true); });
    root.querySelector(`#modMore-${uid}`).onclick = () => searchMods(false);

    root.addEventListener('click', async (e) => {
      const inst = e.target.closest('[data-install]');
      if (inst) {
        inst.disabled = true; inst.innerHTML = `${UI.spinner(13)} Installing`;
        try {
          await API.post(`/modrinth/servers/${id}/packages`, { projectId: inst.dataset.install, type: forced || inst.dataset.type || undefined, resolveDependencies: true });
          UI.toast(`${inst.dataset.title}: install started (watch the console)`, 'success');
          setTimeout(loadInstalled, 3000);
        } catch (err) { UI.toast(err.message, 'error'); }
        inst.disabled = false; inst.textContent = 'Install';
        return;
      }
      const builds = e.target.closest('[data-builds]');
      if (builds) {
        ModrinthVersionModal.open(
          { projectId: builds.dataset.builds, title: builds.dataset.title, slug: builds.dataset.builds, icon: builds.dataset.icon },
          id,
          () => { setTimeout(loadInstalled, 3000); },
          { type: forced },
        );
        return;
      }
      const det = e.target.closest('[data-details]');
      if (det) {
        det.disabled = true;
        try {
          const [{ project }, { versions }] = await Promise.all([
            API.get(`/modrinth/project/${det.dataset.details}`),
            API.get(`/modrinth/versions/${det.dataset.details}?gameVersion=${encodeURIComponent(server.version)}`),
          ]);
          UI.modal({
            title: project.title,
            wide: true,
            body: `
              <div class="row" style="gap:14px;align-items:flex-start">
                ${project.icon ? `<img class="plugin-icon" style="width:72px;height:72px;flex:0 0 72px" src="${esc(iconSrc(project.icon))}">` : ''}
                <div class="grow">
                  <p class="muted" style="margin-top:0">${esc(project.description)}</p>
                  <div class="chips">
                    <span class="chip violet">${esc(project.projectType)}</span>
                    <span class="chip">${fmt.num(project.downloads)} downloads</span>
                    <span class="chip">${esc(project.license || 'unknown license')}</span>
                    ${(project.gameVersions || []).slice(-4).map((v) => `<span class="chip">${esc(v)}</span>`).join('')}
                  </div>
                </div>
              </div>
              <div class="divider"></div>
              <h3>Compatible versions (${server.serverType} ${server.version})</h3>
              <div class="table-wrap" style="max-height:260px;overflow:auto"><table class="data">
                <thead><tr><th>Version</th><th>Type</th><th>Published</th><th></th></tr></thead>
                <tbody>${versions.slice(0, 25).map((v) => `<tr>
                  <td class="mono tiny">${esc(v.versionNumber)}</td>
                  <td><span class="badge ${v.versionType === 'release' ? 'green' : v.versionType === 'beta' ? 'yellow' : 'red'}">${esc(v.versionType)}</span></td>
                  <td class="tiny dim">${fmt.timeAgo(v.published)}</td>
                  <td style="text-align:right"><button class="btn sm" data-install-version="${esc(v.id)}" data-project="${esc(project.projectId || project.slug || det.dataset.details)}" data-type="${esc(project.projectType || '')}" data-title="${esc(project.title)}">Install</button></td>
                </tr>`).join('') || `<tr><td colspan="4">${UI.empty('No compatible version found', 'The server version may be too new/old for this project.')}</td></tr>`}</tbody>
              </table></div>`,
          });
        } catch (err) { UI.toast(err.message, 'error'); }
        det.disabled = false;
      }
      const instV = e.target.closest('[data-install-version]');
      if (instV) {
        instV.disabled = true;
        try {
          await API.post(`/modrinth/servers/${id}/packages`, { projectId: instV.dataset.project, versionId: instV.dataset.installVersion, type: forced || instV.dataset.type || undefined, resolveDependencies: true });
          UI.toast('Install started', 'success');
          document.querySelector('.overlay.open')?.querySelector('.close')?.click();
          setTimeout(loadInstalled, 3000);
        } catch (err) { UI.toast(err.message, 'error'); instV.disabled = false; }
      }
    });

    loadInstalled();
  }

  /* ================================ backups ================================ */
  async function renderBackups() {
    const root = document.getElementById('tab-backups');
    root.innerHTML = `
      <div class="row between wrap" style="margin-bottom:14px;gap:10px">
        <div class="banner-note yellow" style="flex:1;min-width:260px">${ICONS.warn}
          <div><b>Backups include worlds, plugins, configs.</b><div class="tiny">Restoring stops the server, replaces the files and restarts it. Locked backups are never pruned.</div></div>
        </div>
        <div class="row">
          <button class="btn sm" id="pruneBtn">Prune autos</button>
          <button class="btn sm primary" id="newBackup">${ICONS.plus} Create backup</button>
        </div>
      </div>
      <div class="card flush"><div id="backupList">${UI.skeleton(4)}</div></div>`;

    async function load() {
      try {
        const data = await API.get(`/servers/${id}/backups`);
        const wrap = root.querySelector('#backupList');
        if (!data.backups.length) {
          wrap.innerHTML = UI.empty('No backups yet', 'Create one now - or enable the daily backup schedule in the Schedules tab.');
          return;
        }
        wrap.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr><th>File</th><th>Size</th><th>Created</th><th>Note</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${data.backups.map((b) => `<tr>
            <td><div style="font-weight:600">${esc(b.filename)}</div><div class="chips"><span class="chip">${b.automatic ? 'automatic' : 'manual'}</span>${b.locked ? '<span class="chip">locked</span>' : ''}${b.remoteNode ? `<span class="chip">node: ${esc(b.remoteNode)}</span>` : ''}</div></td>
            <td class="mono tiny">${esc(b.sizePretty)}</td>
            <td class="tiny dim">${fmt.timeAgo(b.createdAt)}<div class="tiny dim">${fmt.date(b.createdAt)}</div></td>
            <td class="tiny dim">${esc(b.note || '-')}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn sm ghost" data-restore="${esc(b.id)}" data-file="${esc(b.filename)}" title="Restore">restore</button>
              <a class="btn sm ghost" href="/api/servers/${id}/backups/${b.id}/download?token=${store.token}" title="Download">${ICONS.download}</a>
              <button class="btn sm ghost" data-lock="${esc(b.id)}" data-locked="${b.locked}" title="${b.locked ? 'Unlock' : 'Lock'}">${b.locked ? 'unlock' : 'lock'}</button>
              <button class="btn sm ghost" data-del="${esc(b.id)}" title="Delete">${ICONS.trash}</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`;

        wrap.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
          if (!(await UI.confirm(`Restore ${b.dataset.file}? Current files will be replaced and the server restarted.`, { confirmText: 'Restore' }))) return;
          b.disabled = true;
          try { await API.post(`/servers/${id}/backups/${b.dataset.restore}/restore`, { force: true }); UI.toast('Restore started - watch the console', 'success'); setTimeout(() => setTab('console'), 800); }
          catch (err) { UI.toast(err.message, 'error'); b.disabled = false; }
        });
        wrap.querySelectorAll('[data-lock]').forEach((b) => b.onclick = async () => {
          try { await API.patch(`/servers/${id}/backups/${b.dataset.lock}`, { locked: b.dataset.locked !== 'true' }); load(); }
          catch (err) { UI.toast(err.message, 'error'); }
        });
        wrap.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
          if (!(await UI.confirm('Delete this backup permanently?', { confirmText: 'Delete' }))) return;
          try { await API.del(`/servers/${id}/backups/${b.dataset.del}`); UI.toast('Backup deleted', 'success'); load(); }
          catch (err) { UI.toast(err.message, 'error'); }
        });
      } catch (err) {
        root.querySelector('#backupList').innerHTML = `<div class="card-body">${UI.empty(err.message)}</div>`;
      }
    }

    root.querySelector('#newBackup').onclick = () => {
      UI.modal({
        title: 'Create backup',
        narrow: true,
        body: `<label class="field">Note <span class="dim tiny">(optional)</span><input id="bkpNote" placeholder="before updating plugins"></label>
               <div class="tiny dim mt">The server keeps running. Large worlds take longer - progress is streamed to the console.</div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doBackup">Start backup</button>`,
        onMount(m, { close }) {
          m.querySelector('#doBackup').onclick = async (e) => {
            const btn = e.target.closest('button');
            btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Starting...`;
            try {
              await API.post(`/servers/${id}/backups/stream`, { note: m.querySelector('#bkpNote').value });
              UI.toast('Backup started - progress is in the console', 'success');
              close();
              setTimeout(load, 2500);
            } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Start backup'; }
          };
        },
      });
    };
    root.querySelector('#pruneBtn').onclick = async () => {
      const keep = prompt('Keep the newest N automatic backups:', '10');
      if (!keep) return;
      try { const r = await API.post(`/servers/${id}/backups/prune`, { keep: parseInt(keep, 10) }); UI.toast(`Removed ${r.removed} old backup(s)`, 'success'); load(); }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    load();
  }

  /* ================================ network / playit ================================ */
  async function renderNetwork() {
    const root = document.getElementById('tab-network');
    root.innerHTML = `<div class="stack">
      <div class="grid cols-2">
      <div class="card" id="playitCard">${UI.skeleton(5)}</div>
      <div class="card">
        <h3>How playit.gg works</h3>
        <ol class="muted" style="padding-left:18px;font-size:13px;line-height:1.9">
          <li>Click <b>Start tunnel</b> - the panel downloads the official playit agent + CLI into <span class="mono">data/bin</span>.</li>
          <li>You get a <b>claim link</b>. Open it, sign in to (or create) your free playit.gg account and approve this agent.
              The panel keeps polling in the background and picks up the secret automatically.</li>
          <li>In the playit dashboard create a tunnel: type <span class="mono">Minecraft Java</span>,
              local address <span class="mono">127.0.0.1</span>, local port <span class="mono">${server.port}</span>.</li>
          <li>Share the public address (like <span class="mono">something.playit.gg:12345</span>) with your players - no port forwarding, no public IP needed.</li>
        </ol>
        <div class="divider"></div>
        <label class="field">Already have a playit secret key?
          <div class="row"><input id="playitSecret" placeholder="paste your secret key (optional)">
          <button class="btn sm" id="saveSecret">Save</button></div>
        </label>
        <div class="tiny dim mt">With a secret key the agent skips the claim step and reconnects automatically after restarts.</div>
        <div class="divider"></div>
        <div class="row between"><span class="muted">Start the tunnel automatically with the server</span>
          <label class="switch"><input type="checkbox" id="playitAutostart"><span class="track"></span></label></div>
      </div>
      </div>
      <div class="card" id="subdomainCard">${UI.skeleton(4)}</div>
    </div>`;

    async function load() {
      try {
        const data = await API.get(`/servers/${id}/playit`);
        server.playit = data;
        const running = data.running;
        const claimPending = data.pendingClaim || (data.claimUrl && !data.accountLinked);
        const badge = running ? 'green' : claimPending ? 'yellow' : '';
        root.querySelector('#playitCard').innerHTML = `
          <div class="row between">
            <h3 style="margin:0">playit.gg tunnel</h3>
            <span class="badge ${badge}"><i class="dot ${running ? 'green' : claimPending ? 'yellow' : ''}"></i>
              ${running ? 'connected' : claimPending ? 'waiting for claim' : 'stopped'}</span>
          </div>
          <dl class="kv mt">
            <dt>Local target</dt><dd>${esc(data.localAddress || '')}</dd>
            <dt>Public address</dt><dd>${data.publicAddress ? esc(data.publicAddress) : '<span class="dim">create a tunnel on playit.gg to get one</span>'}</dd>
            <dt>Secret key</dt><dd>${data.hasSecret ? 'stored - agent reconnects automatically' : '<span class="dim">not claimed yet</span>'}</dd>
            <dt>Binaries</dt><dd>${data.binaryInstalled ? 'agent + cli installed' : 'not downloaded yet'}</dd>
            <dt>Agent log</dt><dd class="tiny">${esc(data.lastLine || '-')}</dd>
          </dl>

          ${claimPending && data.claimUrl ? `
            <div class="banner-note yellow mt">${ICONS.warn}
              <div><b>Claim this agent to finish setup</b>
                <div class="tiny">Open the link below, sign in to playit.gg and approve it. The panel is already polling - the tunnel starts by itself.</div>
                <div class="copy-box mt"><span class="code grow">${esc(data.claimUrl)}</span>
                  <a class="btn sm primary" href="${esc(data.claimUrl)}" target="_blank" rel="noreferrer">Open</a>
                  <button class="btn sm" data-copy="${esc(data.claimUrl)}">Copy</button>
                  <button class="btn sm green" id="markClaimed">I approved it</button>
                </div>
                ${data.claimCode ? `<div class="tiny dim mt">or enter code <b class="mono">${esc(data.claimCode)}</b> at playit.gg/claim</div>` : ''}
              </div>
            </div>` : ''}

          ${data.error ? `<div class="banner-note red mt">${ICONS.warn}<div>${esc(data.error)}</div></div>` : ''}

          <div class="row wrap mt" style="gap:8px">
            ${data.running
              ? `<button class="btn red" id="stopTunnel">${ICONS.stop} Stop tunnel</button>`
              : `<button class="btn primary" id="startTunnel">${ICONS.play} Start tunnel${claimPending ? ' (claim in progress)' : ''}</button>`}
            <button class="btn" id="newClaim">${ICONS.refresh} New claim link</button>
            <button class="btn" id="installAgent">${ICONS.download} ${data.binaryInstalled ? 'Reinstall binaries' : 'Install binaries'}</button>
            <button class="btn" id="resetTunnel">Reset tunnel</button>
          </div>`;

        const startBtn = root.querySelector('#startTunnel');
        if (startBtn) startBtn.onclick = async (e) => {
          e.target.disabled = true; e.target.innerHTML = `${UI.spinner(13)} Starting...`;
          try { const r = await API.post(`/servers/${id}/playit/start`); UI.toast(r.status && r.status.pendingClaim ? 'Claim link generated - open it to finish' : 'Tunnel starting...', 'success'); setTimeout(load, 1500); }
          catch (err) { UI.toast(err.message, 'error'); e.target.disabled = false; e.target.innerHTML = `${ICONS.play} Start tunnel`; }
        };
        const stopBtn = root.querySelector('#stopTunnel');
        if (stopBtn) stopBtn.onclick = async () => {
          try { await API.post(`/servers/${id}/playit/stop`); UI.toast('Tunnel stopped', 'success'); load(); }
          catch (err) { UI.toast(err.message, 'error'); }
        };
        root.querySelector('#newClaim').onclick = async (e) => {
          e.target.disabled = true;
          try {
            const r = await API.post(`/servers/${id}/playit/claim-url`);
            UI.toast(`Claim link ready: ${r.url || r.claimCode}`, 'success');
            load();
          } catch (err) { UI.toast(err.message, 'error'); }
          e.target.disabled = false;
        };
        root.querySelector('#installAgent').onclick = async (e) => {
          e.target.disabled = true; e.target.innerHTML = `${UI.spinner(13)} Downloading...`;
          try { await API.post(`/servers/${id}/playit/install`); UI.toast('playit binaries installed', 'success'); load(); }
          catch (err) { UI.toast(err.message, 'error'); e.target.disabled = false; e.target.innerHTML = `${ICONS.download} Install binaries`; }
        };
        root.querySelector('#resetTunnel').onclick = async () => {
          if (!(await UI.confirm('Reset the tunnel? The stored secret is deleted and you will claim again.', { confirmText: 'Reset' }))) return;
          try { await API.post(`/servers/${id}/playit/reset`); UI.toast('Tunnel reset', 'success'); load(); }
          catch (err) { UI.toast(err.message, 'error'); }
        };
        const claimed = root.querySelector('#markClaimed');
        if (claimed) claimed.onclick = async () => { await API.post(`/servers/${id}/playit/claim`); UI.toast('Marked as claimed', 'success'); load(); };
        const auto = root.querySelector('#playitAutostart');
        auto.checked = !!data.autostart;
        auto.onchange = async () => {
          try { await API.post(`/servers/${id}/playit/autostart`, { autostart: auto.checked }); UI.toast(auto.checked ? 'Tunnel will start with the server' : 'Autostart disabled', 'success'); }
          catch (err) { UI.toast(err.message, 'error'); }
        };
      } catch (err) {
        root.querySelector('#playitCard').innerHTML = `<div class="card-body">${UI.empty(err.message)}</div>`;
      }
    }

    root.querySelector('#saveSecret').onclick = async () => {
      const secret = root.querySelector('#playitSecret').value.trim();
      if (!secret) return UI.toast('Paste your secret key first', 'error');
      try { await API.post(`/servers/${id}/playit/secret`, { secret }); UI.toast('Secret saved - tunnel restarting', 'success'); setTimeout(load, 2000); }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    load();
    loadSubdomains();
    const t = setInterval(() => { if (!document.hidden && document.getElementById('tab-network').classList.contains('active')) load(); }, 8000);
    window.addEventListener('beforeunload', () => clearInterval(t));
  }

  /* ---------------------------- subdomains ---------------------------- */
  async function loadSubdomains() {
    const card = document.getElementById('subdomainCard');
    if (!card) return;
    try {
      const data = await API.get(`/servers/${id}/subdomains`);
      card.innerHTML = `
        <div class="row between wrap" style="gap:10px">
          <div>
            <h3 style="margin:0">Join address (subdomain)</h3>
            <div class="tiny dim mt">Give players a real hostname instead of an IP and port.
              ${data.configured ? 'DNS records are created automatically through your DNS provider.' : 'Manual mode: copy the records below into your DNS provider.'}</div>
          </div>
          <span class="badge ${data.configured ? 'green' : ''}">${data.configured ? 'automatic (Cloudflare)' : 'manual records'}</span>
        </div>
        <div class="divider"></div>
        <div id="subdomainList">${data.subdomains.length ? data.subdomains.map(subRow).join('') : '<span class="tiny dim">No subdomain yet.</span>'}</div>
        <div class="row wrap mt" style="gap:8px">
          <input id="subLabel" value="${esc(data.suggested || '')}" placeholder="label, e.g. survival" style="max-width:220px">
          ${data.configured ? '' : `<input id="subIp" placeholder="public IPv4 of this node" style="max-width:220px">`}
          <button class="btn primary" id="subCreate">${ICONS.globe} Create subdomain</button>
        </div>
        <div class="tiny dim mt">${data.baseDomain ? `Base domain: <span class="mono">${esc(data.baseDomain)}</span>` : 'No base domain configured yet — an admin sets it in Admin → Settings → Subdomains.'}</div>`;

      card.querySelector('#subCreate').onclick = async (e) => {
        const label = card.querySelector('#subLabel').value.trim();
        const ipField = card.querySelector('#subIp');
        if (!label) return UI.toast('Type a label first', 'warn');
        e.target.disabled = true;
        try {
          const res = await API.post(`/servers/${id}/subdomains`, { sub: label, ip: ipField ? ipField.value.trim() : undefined });
          if (res.manual) {
            UI.modal({
              title: 'Create these DNS records',
              body: `<p class="muted" style="margin:0 0 8px">Add both records at your DNS provider, then <span class="mono">${esc(res.subdomain.host)}</span> works for players.</p>
                ${res.subdomain.records.map((r) => `<div class="dns-record"><b>${esc(r.type)}</b> ${esc(r.name)} → ${esc(r.content)}${r.type === 'SRV' ? ` (port ${r.port})` : ''}${r.ttl ? ` · TTL ${r.ttl}` : ''}</div>`).join('')}`,
              footer: `<button class="btn primary" data-close>Got it</button>`,
            });
          } else {
            UI.toast(`Players can now join ${res.subdomain.host}`, 'success');
          }
          loadSubdomains();
        } catch (err) { UI.toast(err.message, 'error'); }
        e.target.disabled = false;
      };

      card.querySelectorAll('[data-subdel]').forEach((b) => {
        b.onclick = async () => {
          if (!(await UI.confirm('Delete this hostname and its DNS records?', { confirmText: 'Delete' }))) return;
          try { await API.del(`/servers/${id}/subdomains/${b.dataset.subdel}`); UI.toast('Subdomain removed', 'success'); loadSubdomains(); }
          catch (err) { UI.toast(err.message, 'error'); }
        };
      });
    } catch (err) {
      card.innerHTML = UI.empty('Could not load subdomains', err.message);
    }
  }

  function subRow(sub) {
    return `
      <div class="row between wrap" style="gap:10px;padding:8px 0;border-bottom:1px solid var(--line-subtle)">
        <div>
          <div class="row" style="gap:8px"><b class="mono">${esc(sub.host)}</b><span class="badge tiny ${sub.provider === 'cloudflare' ? 'green' : ''}">${esc(sub.provider)}</span>
            <button class="btn ghost sm icon" data-copy="${esc(sub.address)}" title="Copy address">${ICONS.folder}</button></div>
          <div class="tiny dim mt">players join <span class="mono">${esc(sub.host)}</span> · or with the port <span class="mono">${esc(sub.address)}</span>
            · SRV <span class="mono">${esc(sub.srv)}</span> · created ${fmt.timeAgo(sub.createdAt)}</div>
        </div>
        <button class="btn sm red" data-subdel="${esc(sub.id)}">${ICONS.trash} Remove</button>
      </div>`;
  }

  /* ================================ schedules ================================ */
  async function renderSchedules() {
    const root = document.getElementById('tab-schedules');
    root.innerHTML = `
      <div class="row between wrap" style="margin-bottom:14px">
        <div class="tiny dim">Cron-style tasks: 5 fields <span class="mono">minute hour day month weekday</span> (e.g. <span class="mono">0 4 * * *</span> = every day at 04:00).</div>
        <button class="btn sm primary" id="newTask">${ICONS.plus} New task</button>
      </div>
      <div class="card flush"><div id="taskList">${UI.skeleton(3)}</div></div>`;

    async function load() {
      const data = await API.get(`/servers/${id}/schedules`);
      const wrap = root.querySelector('#taskList');
      if (!data.schedules.length) { wrap.innerHTML = UI.empty('No scheduled tasks'); return; }
      wrap.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Task</th><th>Action</th><th>Schedule</th><th>Last run</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${data.schedules.map((t) => `<tr>
          <td><div style="font-weight:600">${esc(t.name)}</div><div class="tiny dim">${t.payload ? `payload: ${esc(t.payload)}` : ''}</div></td>
          <td><span class="badge">${esc(t.action)}</span></td>
          <td class="mono tiny">${esc(t.cron)}<div class="tiny dim">${esc(t.description || '')}</div></td>
          <td class="tiny dim">${t.lastRun ? `${fmt.timeAgo(t.lastRun)}<div>${esc(t.lastResult || '')}</div>` : 'never'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn sm ghost" data-toggle="${esc(t.id)}" data-enabled="${t.enabled}">${t.enabled ? 'disable' : 'enable'}</button>
            <button class="btn sm ghost" data-run="${esc(t.id)}">run now</button>
            <button class="btn sm ghost" data-del="${esc(t.id)}">${ICONS.trash}</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`;

      wrap.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
        try { await API.patch(`/servers/${id}/schedules/${b.dataset.toggle}`, { enabled: b.dataset.enabled !== 'true' }); load(); }
        catch (err) { UI.toast(err.message, 'error'); }
      });
      wrap.querySelectorAll('[data-run]').forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try { const r = await API.post(`/servers/${id}/schedules/${b.dataset.run}/run`); UI.toast(`Task result: ${r.result}`, r.result === 'ok' ? 'success' : 'warn'); load(); }
        catch (err) { UI.toast(err.message, 'error'); b.disabled = false; }
      });
      wrap.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!(await UI.confirm('Delete this task?', { confirmText: 'Delete' }))) return;
        await API.del(`/servers/${id}/schedules/${b.dataset.del}`); load();
      });
    }

    root.querySelector('#newTask').onclick = () => {
      UI.modal({
        title: 'New scheduled task',
        body: `<div class="col" style="gap:12px">
          <label class="field">Name <input id="tName" placeholder="Nightly restart"></label>
          <div class="field-row">
            <label class="field">Action
              <select id="tAction">
                <option value="restart">Restart server</option>
                <option value="start">Start server</option>
                <option value="stop">Stop server</option>
                <option value="backup">Create backup</option>
                <option value="command">Run console command</option>
              </select>
            </label>
            <label class="field">Cron expression <input id="tCron" value="0 4 * * *" class="mono"></label>
          </div>
          <label class="field">Payload <span class="dim tiny">(console command when action = command)</span>
            <input id="tPayload" placeholder="say restarting soon">
          </label>
          <div class="chips">
            ${[['0 4 * * *', 'daily 04:00'], ['0 */6 * * *', 'every 6h'], ['*/30 * * * *', 'every 30m'], ['0 4 * * 0', 'weekly'], ['@hourly', 'hourly']]
              .map(([c, l]) => `<span class="chip" style="cursor:pointer" data-cron="${c}">${l}</span>`).join('')}
          </div>
        </div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveTask">Create task</button>`,
        onMount(m, { close }) {
          m.querySelectorAll('[data-cron]').forEach((c) => c.onclick = () => { m.querySelector('#tCron').value = c.dataset.cron; });
          m.querySelector('#saveTask').onclick = async (e) => {
            const btn = e.target.closest('button');
            btn.disabled = true;
            try {
              await API.post(`/servers/${id}/schedules`, {
                name: m.querySelector('#tName').value || 'Scheduled task',
                action: m.querySelector('#tAction').value,
                cron: m.querySelector('#tCron').value,
                payload: m.querySelector('#tPayload').value,
                enabled: true,
              });
              UI.toast('Task created', 'success');
              close(); load();
            } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; }
          };
        },
      });
    };

    load();
  }

  /* ================================ subusers ================================ */
  async function renderPeople() {
    const root = document.getElementById('tab-people');
    const perms = ['console', 'files', 'backups', 'plugins', 'network', 'settings', 'schedules', 'subusers'];
    root.innerHTML = `
      <div class="row between wrap" style="margin-bottom:14px">
        <div class="tiny dim">Subusers can log in to the panel and manage only the permissions you grant, on this server only.</div>
        <button class="btn sm primary" id="addSub">${ICONS.plus} Add subuser</button>
      </div>
      <div class="card flush"><div id="subList"></div></div>
      <div class="card mt">
        <h3>Owner</h3>
        <div class="row between"><div><b>${esc(server.ownerName || '')}</b><div class="tiny dim">full access to this server</div></div><span class="badge green">owner</span></div>
      </div>`;

    async function load() {
      const data = await API.get(`/servers/${id}`);
      const subs = data.server.subusers || [];
      const wrap = root.querySelector('#subList');
      wrap.innerHTML = subs.length ? `<table class="data"><thead><tr><th>User</th><th>Permissions</th><th>Added</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${subs.map((s) => `<tr>
          <td><div class="row" style="gap:9px"><div class="avatar">${esc((s.username || '?')[0].toUpperCase())}</div>${esc(s.username)}</div></td>
          <td class="chips">${(s.permissions || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</td>
          <td class="tiny dim">${fmt.timeAgo(s.addedAt)} <div>by ${esc(s.addedBy || '')}</div></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn sm ghost" data-edit="${esc(s.userId)}">edit perms</button>
            <button class="btn sm ghost" data-rm="${esc(s.userId)}">${ICONS.trash}</button>
          </td>
        </tr>`).join('')}</tbody></table>` : UI.empty('No subusers yet');

      wrap.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
        const sub = subs.find((x) => x.userId === b.dataset.edit);
        UI.modal({
          title: `Permissions for ${sub.username}`,
          body: `<div class="col" style="gap:9px">${perms.map((p) => `<label class="checkbox"><input type="checkbox" value="${p}" ${(sub.permissions || []).includes(p) ? 'checked' : ''}> <span>${p}</span></label>`).join('')}</div>`,
          footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="savePerms">Save</button>`,
          onMount(m, { close }) {
            m.querySelector('#savePerms').onclick = async () => {
              const selected = [...m.querySelectorAll('input:checked')].map((i) => i.value);
              try { await API.patch(`/servers/${id}/subusers/${sub.userId}`, { permissions: selected }); UI.toast('Permissions updated', 'success'); close(); load(); }
              catch (err) { UI.toast(err.message, 'error'); }
            };
          },
        });
      });
      wrap.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
        if (!(await UI.confirm('Remove this subuser?', { confirmText: 'Remove' }))) return;
        await API.del(`/servers/${id}/subusers/${b.dataset.rm}`); load();
      });
    }

    root.querySelector('#addSub').onclick = () => {
      UI.modal({
        title: 'Add subuser',
        body: `<label class="field">Panel username or e-mail <input id="subUser" placeholder="steve"></label>
          <div class="mt"><div class="label tiny dim" style="margin-bottom:8px">Permissions</div>
          <div class="col" style="gap:9px">${perms.map((p) => `<label class="checkbox"><input type="checkbox" value="${p}" ${p === 'console' ? 'checked' : ''}> <span>${p}</span></label>`).join('')}</div></div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doAddSub">Add subuser</button>`,
        onMount(m, { close }) {
          m.querySelector('#doAddSub').onclick = async () => {
            const permissions = [...m.querySelectorAll('input:checked')].map((i) => i.value);
            try {
              await API.post(`/servers/${id}/subusers`, { username: m.querySelector('#subUser').value, permissions });
              UI.toast('Subuser added', 'success'); close(); load();
            } catch (err) { UI.toast(err.message, 'error'); }
          };
        },
      });
    };

    load();
  }

  /* ================================ settings ================================ */
  async function renderContainerSettings() {
    const root = document.getElementById('tab-settings');
    const isAdmin = Boolean(server.perms && server.perms.admin);
    const bot = isBotWorkload(server);
    const entry = server.botEntryFile || (server.containerTemplate === 'python-3.12' ? 'bot.py' : 'index.js');
    const startupCommand = server.botStartupCommand || (server.containerTemplate === 'python-3.12' ? `python ${entry}` : `node ${entry}`);
    const runtimeName = server.containerTemplate === 'python-3.12' ? 'Python 3.12' : 'Node.js 20';
    const profile = bot
      ? `<section class="card"><span class="eyebrow">Bot runtime</span><h3>${esc(runtimeName)} application</h3><dl class="kv"><dt>Docker image</dt><dd class="mono">${esc(server.dockerImage || 'unknown')}</dd><dt>Working directory</dt><dd class="mono">/data</dd><dt>Startup command</dt><dd class="mono">${esc(startupCommand)}</dd><dt>Dependencies</dt><dd>${server.containerTemplate === 'python-3.12' ? 'requirements.txt when present' : 'package.json when present'}</dd><dt>Terminal</dt><dd>Not exposed for bot runtimes</dd></dl><div class="banner-note mt"><div><b>How bot startup works</b><div class="tiny">After you save a safe startup profile, upload its files through Files. Start runs the managed command with ${esc(runtimeName)} inside the isolated container, installs declared dependencies there, and streams its actual stdout/stderr to Console.</div></div></div></section>`
      : `<section class="card"><span class="eyebrow">Image</span><h3>${esc(server.containerTemplate || 'Docker workload')}</h3><dl class="kv"><dt>Docker image</dt><dd class="mono">${esc(server.dockerImage || 'unknown')}</dd><dt>Runtime</dt><dd>Docker workspace</dd><dt>Working directory</dt><dd class="mono">/data</dd><dt>Remote terminal</dt><dd>SSHX browser session</dd></dl><div class="banner-note mt"><div><b>Image changes are deliberate</b><div class="tiny">Choose the image during creation. Existing workspaces keep their selected base image to avoid silently replacing the operating system.</div></div></div><div class="mt" data-sshx-slot>${sshxSlot(server.sshx)}</div><button class="btn sm mt" id="openSshxFromSettings" data-open-sshx>${ICONS.terminal} Open SSHX session</button></section>`;
    root.innerHTML = `<div class="grid cols-2"><section class="card"><h3>${bot ? 'Bot settings' : 'Container settings'}</h3><div class="col" style="gap:12px"><label class="field">Name <input id="cName" value="${esc(server.name)}" maxlength="60"></label><label class="field">Description <textarea id="cDescription" maxlength="500">${esc(server.description || '')}</textarea></label>${bot ? `<div class="bot-startup-grid"><label class="field">Startup file <input id="cBotEntry" value="${esc(entry)}" maxlength="120" autocomplete="off"><span class="hint">A relative ${server.containerTemplate === 'python-3.12' ? '.py' : '.js, .cjs, or .mjs'} source file under /data.</span></label><label class="field">Startup command <input id="cBotStartup" value="${esc(startupCommand)}" maxlength="160" autocomplete="off"><span class="hint">${server.containerTemplate === 'python-3.12' ? `Allowed: python ${esc(entry)}` : `Allowed: node ${esc(entry)} or npm start`}. Runs inside the bot container, never on the panel host.</span></label></div>` : ''}<div class="field-row"><label class="field">RAM (MB)<input type="number" id="cMemory" value="${server.memory}" min="256" step="256"></label><label class="field">Disk limit (MB)<input type="number" id="cDisk" value="${server.diskLimit || 0}" min="0" step="1024"><span class="hint">0 means no panel limit</span></label><label class="field">CPU limit (%)<input type="number" id="cCpu" value="${server.cpuLimit || 100}" min="1" step="10"><span class="hint">Hard Docker CPU limit</span></label>${isAdmin ? `<label class="field">IP allocation<input id="cIp" value="${esc(server.ip || '0.0.0.0')}"><span class="hint">Admin-only allocation record</span></label>` : ''}</div><button class="btn primary" id="saveContainerSettings">${ICONS.save} Save ${bot ? 'bot' : 'container'} settings</button><div class="tiny dim">RAM and CPU limits take effect after the next container start. Files in <code>/data</code> persist across restarts.</div></div></section>${profile}<section class="card" style="border-color:rgba(255,93,93,.3)"><h3 style="color:#fecaca">Danger zone</h3><div class="row between"><div><b>Delete ${bot ? 'bot' : 'container'}</b><div class="tiny dim">Removes the Docker container, persistent files, and backups.</div></div><button class="btn sm red" id="deleteContainer">Delete</button></div></section></div>`;
    if (!bot) {
      root.querySelector('#openSshxFromSettings').onclick = openSshxSession;
      updateSshx(server.sshx);
    }
    root.querySelector('#saveContainerSettings').onclick = async (event) => {
      const button = event.currentTarget; button.disabled = true; button.innerHTML = `${UI.spinner(13)} Saving…`;
      const patch = { name: root.querySelector('#cName').value, description: root.querySelector('#cDescription').value, memory: parseInt(root.querySelector('#cMemory').value, 10), diskLimit: parseInt(root.querySelector('#cDisk').value, 10) || 0, cpuLimit: parseInt(root.querySelector('#cCpu').value, 10) || 0 };
      if (bot) { patch.botEntryFile = root.querySelector('#cBotEntry').value.trim(); patch.botStartupCommand = root.querySelector('#cBotStartup').value.trim(); }
      const ip = root.querySelector('#cIp'); if (ip) patch.ip = ip.value.trim();
      try { await API.patch(`/servers/${id}`, patch); await loadServer(); header(); UI.toast(`${bot ? 'Bot' : 'Container'} settings saved${bot ? '. Restart after source changes to apply the profile.' : ''}`, 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
      button.disabled = false; button.innerHTML = `${ICONS.save} Save ${bot ? 'bot' : 'container'} settings`;
    };
    root.querySelector('#deleteContainer').onclick = async () => {
      if (!(await UI.confirm(`Delete this Docker ${bot ? 'bot' : 'container'}, its persistent files, and its backups? This cannot be undone.`, { confirmText: `Delete ${bot ? 'bot' : 'container'}` }))) return;
      try { await API.del(`/servers/${id}`); UI.toast(`${bot ? 'Bot' : 'Container'} deleted`, 'success'); location.href = 'servers.html'; } catch (err) { UI.toast(err.message, 'error'); }
    };
  }

  async function renderGameSettings() {
    const root = document.getElementById('tab-settings');
    const isAdmin = Boolean(server.perms && server.perms.admin);
    const game = server.game || {};
    const ports = (server.portAllocations || [server.port]).join(', ');
    root.innerHTML = `<div class="grid cols-2"><section class="card"><span class="eyebrow">Dedicated game</span><h3>${esc(server.gameName || 'Game server')}</h3><div class="col" style="gap:12px"><label class="field">Server name <input id="gName" value="${esc(server.name)}" maxlength="60"></label><label class="field">Description <textarea id="gDescription" maxlength="500">${esc(server.description || '')}</textarea></label><div class="field-row"><label class="field">RAM (MB)<input type="number" id="gMemory" value="${server.memory}" min="256" step="256"></label><label class="field">Disk limit (MB)<input type="number" id="gDisk" value="${server.diskLimit || 0}" min="0" step="1024"><span class="hint">0 means no panel limit</span></label><label class="field">CPU limit (%)<input type="number" id="gCpu" value="${server.cpuLimit || 100}" min="1" step="10"><span class="hint">Hard Docker CPU limit</span></label><label class="field">Player slots<input type="number" id="gPlayers" value="${server.maxPlayers || 1}" min="1" max="250"></label>${isAdmin ? `<label class="field">IP allocation<input id="gIp" value="${esc(server.ip || '0.0.0.0')}"><span class="hint">Admin-only allocation record</span></label>` : ''}</div><label class="checkbox"><input type="checkbox" id="gAutoStart" ${server.autoStart ? 'checked' : ''}> <span><b>Auto-start</b><small>Start this game after a panel restart when its Docker runtime is available.</small></span></label><button class="btn primary" id="saveGameSettings">${ICONS.save} Save game settings</button><div class="tiny dim">Resource changes apply on the next game-container start. The game’s own worlds and configuration files are preserved in <code>/data</code>.</div></div></section><section class="card"><span class="eyebrow">SteamCMD profile</span><h3>${esc(server.gameName || 'Dedicated game')}</h3><dl class="kv"><dt>Steam app</dt><dd class="mono">${esc(String(server.gameAppId || 'unknown'))}</dd><dt>Runtime</dt><dd>Linux Docker game container</dd><dt>Allocated ports</dt><dd class="mono">${esc(ports)}</dd><dt>Working directory</dt><dd class="mono">/data</dd><dt>Last install</dt><dd>${server.lastInstalledAt ? esc(fmt.timeAgo(server.lastInstalledAt)) : 'Never'}</dd></dl><div class="banner-note mt"><div><b>${esc(game.note || 'Game-specific files are managed in /data.')}</b><div class="tiny">Use Files for title-specific configuration. Reinstall game runs SteamCMD update/validate and keeps persistent saves and configs.</div></div></div><button class="btn sm mt" id="reinstallGame">${ICONS.refresh} Reinstall / update game</button></section>${(game.password || game.token) ? `<section class="card"><span class="eyebrow">Game credentials</span><h3>Startup secrets</h3><div class="col" style="gap:12px">${game.password ? `<label class="field">Server password <input type="password" id="gPassword" autocomplete="new-password" placeholder="Leave blank to keep the saved password"><span class="hint">Never returned by the API. Enter a new value only to change it.</span></label>` : ''}${game.token ? `<label class="field">${server.gameId === 'dont-starve-together' ? 'Klei cluster token' : 'Game Server Login Token'} <input type="password" id="gToken" autocomplete="new-password" placeholder="Leave blank to keep the saved token"><span class="hint">Never returned by the API. Enter a new value only to change it.</span></label>` : ''}<button class="btn sm" id="saveGameSecrets">${ICONS.key} Save startup secrets</button></div></section>` : ''}<section class="card" style="border-color:rgba(255,93,93,.3)"><h3 style="color:#fecaca">Danger zone</h3><div class="row between"><div><b>Delete game server</b><div class="tiny dim">Removes its Docker container, persistent game files, and backups.</div></div><button class="btn sm red" id="deleteGame">Delete</button></div></section></div>`;
    root.querySelector('#saveGameSettings').onclick = async (event) => {
      const button = event.currentTarget; button.disabled = true; button.innerHTML = `${UI.spinner(13)} Saving…`;
      const patch = { name: root.querySelector('#gName').value, description: root.querySelector('#gDescription').value, memory: parseInt(root.querySelector('#gMemory').value, 10), diskLimit: parseInt(root.querySelector('#gDisk').value, 10) || 0, cpuLimit: parseInt(root.querySelector('#gCpu').value, 10), maxPlayers: parseInt(root.querySelector('#gPlayers').value, 10), autoStart: root.querySelector('#gAutoStart').checked };
      const ip = root.querySelector('#gIp'); if (ip) patch.ip = ip.value.trim();
      try { await API.patch(`/servers/${id}`, patch); await loadServer(); header(); UI.toast('Game settings saved. Restart to apply launch changes.', 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
      button.disabled = false; button.innerHTML = `${ICONS.save} Save game settings`;
    };
    const install = root.querySelector('#reinstallGame');
    if (install) install.onclick = async () => {
      if (!(await UI.confirm(`Re-download and validate ${server.gameName}? Existing saves and settings in /data are kept.`, { confirmText: 'Update game' }))) return;
      try { await API.post(`/servers/${id}/reinstall`); UI.toast('SteamCMD update started — watch Console', 'success'); setTab('console'); } catch (err) { UI.toast(err.message, 'error'); }
    };
    const secrets = root.querySelector('#saveGameSecrets');
    if (secrets) secrets.onclick = async (event) => {
      const button = event.currentTarget; button.disabled = true;
      const body = {};
      const password = root.querySelector('#gPassword'); const token = root.querySelector('#gToken');
      if (password && password.value) body.gamePassword = password.value;
      if (token && token.value) body.gameToken = token.value;
      if (!Object.keys(body).length) { UI.toast('Enter a new password or token to change it.', 'info'); button.disabled = false; return; }
      try { await API.patch(`/servers/${id}/game-secrets`, body); UI.toast('Startup secrets saved. Restart to apply.', 'success'); if (password) password.value = ''; if (token) token.value = ''; }
      catch (err) { UI.toast(err.message, 'error'); }
      button.disabled = false;
    };
    root.querySelector('#deleteGame').onclick = async () => {
      if (!(await UI.confirm(`Delete ${server.gameName}, its Docker container, persistent files, and backups? This cannot be undone.`, { confirmText: 'Delete game' }))) return;
      try { await API.del(`/servers/${id}`); UI.toast('Game server deleted', 'success'); location.href = 'servers.html'; } catch (err) { UI.toast(err.message, 'error'); }
    };
  }

  async function renderSettings() {
    if (isContainerWorkload(server)) return renderContainerSettings();
    if (isGameWorkload(server)) return renderGameSettings();
    const root = document.getElementById('tab-settings');
    const remote = Boolean(server.nodeId && server.nodeId !== 'local');
    const nodeBackend = (server.node && server.node.backend) || 'process';
    const effectiveBackend = server.backend || nodeBackend;
    root.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <h3>General</h3>
          <div class="col" style="gap:12px">
            <label class="field">Server name <input id="sName" value="${esc(server.name)}"></label>
            <label class="field">Description <input id="sDesc" value="${esc(server.description || '')}"></label>
            <div class="field-row">
              <label class="field">Memory (MB) <input type="number" id="sMemory" value="${server.memory}" min="256" step="128"></label>
              <label class="field">Disk limit (MB) <input type="number" id="sDiskLimit" value="${server.diskLimit || 0}" min="0" step="1024"><span class="hint">0 means no panel limit</span></label>
              <label class="field">CPU limit (%) <input type="number" id="sCpuLimit" value="${server.cpuLimit || 0}" min="0" step="10"><span class="hint">0 means no panel limit</span></label>
              <label class="field">Port <input type="number" id="sPort" value="${server.port}" min="1024" max="65535"></label>
              <label class="field">Max players <input type="number" id="sMaxPlayers" value="${server.maxPlayers || 20}" min="1"></label>
              ${server.perms && server.perms.admin ? `<label class="field">IP address <input id="sIp" value="${esc(server.ip || '0.0.0.0')}" placeholder="0.0.0.0"><span class="hint">Admin-only bind allocation</span></label>` : ''}
            </div>
            <div class="row wrap" style="gap:16px">
              <label class="checkbox"><input type="checkbox" id="sEula" ${server.eulaAccepted ? 'checked' : ''}> <span>EULA accepted</span></label>
              <label class="checkbox"><input type="checkbox" id="sAutoStart" ${server.autoStart ? 'checked' : ''}> <span>Start on panel boot</span></label>
              <label class="checkbox"><input type="checkbox" id="sOnlineMode" ${server.onlineMode ? 'checked' : ''}> <span>Online mode (premium auth)</span></label>
              <label class="checkbox"><input type="checkbox" id="sAikar" ${server.aikarFlags ? 'checked' : ''}> <span>Aikar's GC flags</span></label>
            </div>
            <label class="field">Extra JVM arguments <input id="sJavaArgs" value="${esc(server.javaArgs || '')}" placeholder="-Dcom.mojang.eula.agree=true"></label>
            <div class="card inset" style="padding:12px">
              <div class="row between"><b class="tiny">Network</b><a class="tiny dim" href="allocations.html">all allocations</a></div>
              <div class="stack mt" style="gap:6px">
                <div class="kv"><span>Ports on this server</span><b>${(server.portAllocations || [server.port]).join(', ')}</b></div>
                <div class="kv"><span>Join address</span><b>${esc(server.ip)}:${server.port}</b></div>
                <div class="kv"><span>Subdomains</span><b>${(server.subdomains || []).length ? (server.subdomains || []).map((x) => esc(x.host)).join(', ') : 'none'}</b></div>
                <div class="kv"><span>Node</span><b>${esc(server.nodeName || 'local')}${server.nodeId !== 'local' ? ' (agent)' : ''}</b></div>
              </div>
              <button class="btn sm block mt" id="gotoNetworkFromSettings">${ICONS.globe} Manage addresses</button>
            </div>
            <button class="btn primary" id="saveSettings">${ICONS.save} Save changes</button>
            <div class="tiny dim">Memory and JVM flags apply after a restart.</div>
          </div>
        </div>

        <div class="col" style="gap:14px">
          <div class="card">
            <div class="row between"><h3 style="margin:0">Software &amp; version</h3>${statusBadge(server.status)}</div>
            <dl class="kv mt">
              <dt>Type</dt><dd>${esc(server.serverType)} ${esc(server.version || '')}${server.build ? ` (build ${esc(server.build)})` : ''}</dd>
              <dt>Jar</dt><dd>${esc(server.jarFile || 'server.jar')}</dd>
              <dt>Java</dt><dd>${esc(remote ? (server.remoteJava || `java ${server.javaVersion || '?'} on the node`) : (server.javaPath || 'auto'))} · required ${server.javaVersion || '?'}</dd>
              <dt>Node</dt><dd>${esc(server.nodeName || 'Local node')}${remote ? ' <span class="badge blue">remote agent</span>' : ''}</dd>
              <dt>Installed</dt><dd>${server.lastInstalledAt ? fmt.timeAgo(server.lastInstalledAt) : 'never'}</dd>
            </dl>
            ${remote ? '<div class="banner-note mt"><div><b>Runs on another machine</b><div class="tiny">The node agent owns the process: console, stats, power, commands and backups are proxied through it. The file manager and Modrinth installs still operate on the panel host\'s copy of the server, so upload worlds on the node itself (or move the server back to the local node first).</div></div></div>' : ''}
            <div class="row wrap mt" style="gap:8px">
              <button class="btn sm primary" id="changeVersion" title="Choose and apply a real upstream software/version release">${ICONS.refresh} One-click software switch</button>
              <button class="btn sm" id="reinstall">Reinstall software</button>
              <button class="btn sm" id="uploadJar">${ICONS.upload} Upload custom jar</button>
              <button class="btn sm" id="manageJava">${ICONS.chip} Java runtimes</button>
            </div>
          </div>

          ${server.perms && server.perms.admin ? `<div class="card">
            <div class="row between"><h3 style="margin:0">Placement</h3><button class="btn sm" id="moveNode">Move to node</button></div>
            <div class="tiny dim mt">Servers run on <b>${esc(server.nodeName || 'Local node')}</b>${remote ? ' via its agent.' : ' as a child process of the panel.'} Moving requires the server to be stopped; the software is reinstalled on the target node (world files stay where they are).</div>
          </div>` : ''}

          <div class="card">
            <div class="row between"><h3 style="margin:0">Container runtime</h3><span class="badge ${effectiveBackend === 'docker' ? 'violet' : 'green'}">${effectiveBackend === 'docker' ? 'docker' : 'java process'}</span></div>
            <div class="tiny dim mt">${effectiveBackend === 'docker'
              ? `This server runs inside a container on <b>${esc(server.nodeName || 'the local node')}</b>${server.container ? ` (<span class="mono">${esc(server.container)}</span>)` : ''}. Its files are bind-mounted, so the Files, Worlds and SFTP tabs keep working.`
              : `This server runs as a Java process owned by the panel on <b>${esc(server.nodeName || 'the local node')}</b>.`}</div>
            <div class="field-row mt">
              <label class="field">Run servers as
                <select id="sBackend">
                  <option value="" ${server.requestedBackend ? '' : 'selected'}>Follow the node (${nodeBackend})</option>
                  <option value="process" ${server.requestedBackend === 'process' ? 'selected' : ''}>Java process (no container)</option>
                  <option value="docker" ${server.requestedBackend === 'docker' ? 'selected' : ''}>Docker container</option>
                </select>
              </label>
              <label class="field">Container image <input id="sImage" value="${esc(server.dockerImage || '')}" placeholder="eclipse-temurin:${esc(String(server.javaVersion || 21))}-jre"></label>
            </div>
            <button class="btn sm" id="saveRuntime">${ICONS.docker} Apply runtime</button>
            <div class="tiny dim mt" id="runtimeNote">Switching to Docker is validated against the node: if the daemon is unreachable the change is refused with the engine's own error. Stop the server first.</div>
          </div>

          <div class="card">
            <div class="row between"><h3 style="margin:0">server.properties</h3><button class="btn sm" id="loadProps">Load</button></div>
            <div id="propsBox" class="mt tiny dim">Load the file to edit common gameplay settings (motd, difficulty, gamemode, pvp, view distance...).</div>
          </div>

          <div class="card" style="border-color:rgba(255,93,93,0.3)">
            <h3 style="color:#ffa2a2">Danger zone</h3>
            <div class="col" style="gap:10px">
              <div class="row between"><div><b>Kill server</b><div class="tiny dim">Force stop the process immediately (SIGKILL)</div></div><button class="btn sm red" id="killServer">Kill</button></div>
              <div class="row between"><div><b>Delete server</b><div class="tiny dim">Removes the server, its files and its backups</div></div><button class="btn sm red" id="deleteServer">Delete</button></div>
            </div>
          </div>
        </div>
      </div>`;

    const moveBtn = root.querySelector('#moveNode');
    if (moveBtn) moveBtn.onclick = async () => {
      let nodes = [];
      try { nodes = (await API.get('/nodes')).nodes || []; } catch (err) { return UI.toast(err.message, 'error'); }
      const options = nodes.filter((n) => n.id !== server.nodeId);
      if (!options.length) return UI.toast('There is no other node to move to', 'warn');
      UI.modal({
        title: 'Move server to another node',
        body: `<div class="col" style="gap:12px">
            <div class="banner-note"><div><b>How this works</b><div class="tiny">The server must be stopped. Its record and port move to the target node and the server software is re-installed there. World files are <b>not</b> copied automatically - export them from the Files/Backups tab of the old node first.</div></div></div>
            <label class="field">Target node
              <select id="mvNode">${options.map((n) => `<option value="${esc(n.id)}" ${n.status === 'offline' ? 'disabled' : ''}>${esc(n.name)} · ${esc(n.status || 'unknown')}</option>`).join('')}</select>
            </label>
          </div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doMove">Move server</button>`,
        onMount(m, { close }) {
          m.querySelector('#doMove').onclick = async () => {
            const target = m.querySelector('#mvNode').value;
            try {
              const res = await API.post(`/servers/${server.id}/node`, { nodeId: target });
              UI.toast(`Moving to ${res.server.nodeName}…`, 'success');
              close();
              setTimeout(() => location.reload(), 900);
            } catch (err) { UI.toast(err.message, 'error'); }
          };
        },
      });
    };

    root.querySelector('#saveRuntime').onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!(await UI.confirm('Change how this server runs? The server must be stopped; existing worlds and configs are untouched.', { confirmText: 'Apply' }))) return;
      btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Applying...`;
      try {
        const res = await API.patch(`/servers/${id}`, {
          backend: root.querySelector('#sBackend').value,
          dockerImage: root.querySelector('#sImage').value.trim(),
        });
        UI.toast(res.server.backend === 'docker' ? 'This server will now run in a container' : 'Runtime updated', 'success');
        await loadServer();
        renderSettings();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
      btn.disabled = false; btn.innerHTML = `${ICONS.docker} Apply runtime`;
    };

    const gotoAddr = root.querySelector('#gotoNetworkFromSettings');
    if (gotoAddr) gotoAddr.onclick = () => setTab('network');
    root.querySelector('#saveSettings').onclick = async (e) => {
      const btn = e.target.closest('button');
      btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Saving...`;
      try {
        const body = {
          name: root.querySelector('#sName').value,
          description: root.querySelector('#sDesc').value,
          memory: parseInt(root.querySelector('#sMemory').value, 10),
          diskLimit: parseInt(root.querySelector('#sDiskLimit').value, 10) || 0,
          cpuLimit: parseInt(root.querySelector('#sCpuLimit').value, 10) || 0,
          port: parseInt(root.querySelector('#sPort').value, 10),
          maxPlayers: parseInt(root.querySelector('#sMaxPlayers').value, 10),
          eulaAccepted: root.querySelector('#sEula').checked,
          autoStart: root.querySelector('#sAutoStart').checked,
          onlineMode: root.querySelector('#sOnlineMode').checked,
          aikarFlags: root.querySelector('#sAikar').checked,
          javaArgs: root.querySelector('#sJavaArgs').value,
        };
        const ip = root.querySelector('#sIp');
        if (ip) body.ip = ip.value.trim();
        await API.patch(`/servers/${id}`, body);
        await loadServer();
        header();
        UI.toast('Settings saved', 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
      btn.disabled = false; btn.innerHTML = `${ICONS.save} Save changes`;
    };

    root.querySelector('#killServer').onclick = async () => {
      if (!(await UI.confirm('Force kill the server process? Unsaved world data may be lost.', { confirmText: 'Kill' }))) return;
      try { await API.post(`/servers/${id}/kill`); UI.toast('Kill signal sent', 'success'); } catch (err) { UI.toast(err.message, 'error'); }
    };

    root.querySelector('#deleteServer').onclick = async () => {
      if (!(await UI.confirm('Delete this server, its files and backups? This cannot be undone.', { confirmText: 'Delete forever' }))) return;
      try { await API.del(`/servers/${id}`); UI.toast('Server deleted', 'success'); location.href = 'servers.html'; }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    root.querySelector('#reinstall').onclick = async () => {
      if (!(await UI.confirm('Re-download and reinstall the server software? Worlds and configs are kept.', { confirmText: 'Reinstall' }))) return;
      try { await API.post(`/servers/${id}/reinstall`, { version: server.version, serverType: server.serverType }); UI.toast('Installing - watch the console', 'success'); setTab('console'); }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    root.querySelector('#changeVersion').onclick = async () => {
      let catalogue;
      try {
        catalogue = await API.get('/system/catalogue');
      } catch (err) {
        UI.toast(`Could not load the software catalogue: ${err.message}`, 'error');
        return;
      }
      // A custom jar has its own explicit upload workflow; presenting it here
      // would imply the panel can fetch a release that has no upstream URL.
      const types = (catalogue.types || []).filter((type) => type.id !== 'CUSTOM');
      if (!types.length) {
        UI.toast('No installable Minecraft software is available from the catalogue', 'error');
        return;
      }
      const currentType = types.find((type) => type.id === server.serverType) || types[0];
      UI.modal({
        title: 'One-click software switch',
        wide: true,
        body: `<div class="software-switcher">
            <section class="software-switcher-current">
              <span class="software-switcher-icon">${ICONS.refresh}</span>
              <div><span class="eyebrow">Current runtime</span><b>${esc(server.serverType)} ${esc(server.version || '')}</b><small>The server must remain stopped while Zenith creates a recovery backup and replaces its server software.</small></div>
            </section>
            <div class="field-row software-switcher-fields">
              <label class="field">Server software
                <select id="migType">${types.map((type) => `<option value="${esc(type.id)}" ${type.id === currentType.id ? 'selected' : ''}>${esc(type.name)} — ${esc(type.description)}</option>`).join('')}</select>
              </label>
              <label class="field">Target version
                <select id="migVersion" disabled><option value="">Loading available versions…</option></select>
              </label>
            </div>
            <div class="software-switcher-tools">
              <label class="field grow">Find a version <input id="migSearch" type="search" placeholder="e.g. 1.21.4" disabled></label>
              <button class="btn sm" id="refreshMigrationVersions" type="button">${ICONS.refresh} Refresh releases</button>
            </div>
            <div class="software-switcher-release" id="migVersionHint" role="status">Loading releases directly from the selected software provider…</div>
            <div class="banner-note yellow">${ICONS.warn}<div><b>What this changes</b><div class="tiny">Zenith keeps worlds and normal configuration files, creates a real safety backup when possible, then downloads the selected software. Plugin and mod compatibility is your responsibility. Any backup failure is shown exactly in the console and result message.</div></div></div>
          </div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doMigrate" disabled>${ICONS.refresh} Switch software</button>`,
        onMount(mr, { close }) {
          const typeSel = mr.querySelector('#migType');
          const verSel = mr.querySelector('#migVersion');
          const search = mr.querySelector('#migSearch');
          const hint = mr.querySelector('#migVersionHint');
          const change = mr.querySelector('#doMigrate');
          const refresh = mr.querySelector('#refreshMigrationVersions');
          let releases = [];
          let requestSerial = 0;
          let selectedVersion = '';

          const paintVersions = () => {
            const filter = search.value.trim().toLowerCase();
            const shown = releases.filter((release) => !filter || release.id.toLowerCase().includes(filter));
            const wanted = selectedVersion || verSel.value;
            verSel.innerHTML = shown.length
              ? shown.map((release) => `<option value="${esc(release.id)}" ${release.id === wanted ? 'selected' : ''}>${esc(release.id)}${release.released ? ` · ${esc(release.released)}` : ''}${release.builds ? ` · ${release.builds} builds` : ''}</option>`).join('')
              : '<option value="">No matching upstream release</option>';
            if (shown.length) {
              verSel.value = shown.some((release) => release.id === wanted) ? wanted : shown[0].id;
              selectedVersion = verSel.value;
            } else selectedVersion = '';
            verSel.disabled = shown.length === 0;
            change.disabled = shown.length === 0;
            hint.textContent = shown.length
              ? `${shown.length} verified release${shown.length === 1 ? '' : 's'} available from the ${typeSel.options[typeSel.selectedIndex].text.split(' — ')[0]} provider.`
              : 'No provider release matches that filter. Clear the search or choose another software.';
          };

          const loadVersions = async () => {
            const serial = ++requestSerial;
            releases = [];
            search.value = '';
            search.disabled = true;
            verSel.disabled = true;
            change.disabled = true;
            refresh.disabled = true;
            verSel.innerHTML = '<option value="">Loading available versions…</option>';
            hint.textContent = `Checking the live ${typeSel.value} provider…`;
            try {
              const data = await API.get(`/system/versions/${encodeURIComponent(typeSel.value)}`);
              if (serial !== requestSerial) return;
              releases = (data.versions || []).filter((release) => release && release.id).map((release) => ({ ...release, id: String(release.id) }));
              const first = typeSel.value === server.serverType
                ? releases.find((release) => release.id === String(server.version || ''))
                : null;
              selectedVersion = first ? first.id
                : data.latest && releases.some((release) => release.id === String(data.latest)) ? String(data.latest)
                  : releases[0] ? releases[0].id : '';
              search.disabled = false;
              paintVersions();
            } catch (err) {
              if (serial !== requestSerial) return;
              verSel.innerHTML = '<option value="">Provider unavailable</option>';
              hint.textContent = `Could not load versions: ${err.message}`;
              UI.toast(`Could not load ${typeSel.value} releases: ${err.message}`, 'error');
            } finally {
              if (serial === requestSerial) refresh.disabled = false;
            }
          };

          typeSel.onchange = loadVersions;
          refresh.onclick = loadVersions;
          search.oninput = paintVersions;
          verSel.onchange = () => { selectedVersion = verSel.value; };
          loadVersions();

          change.onclick = async () => {
            const targetType = typeSel.value;
            const targetVersion = verSel.value;
            if (!targetVersion) return;
            if (!(await UI.confirm(`Switch ${server.name} from ${server.serverType} ${server.version || ''} to ${targetType} ${targetVersion}? The server stays stopped while the real installer runs.`, { title: 'Confirm software switch', confirmText: 'Switch software', danger: false }))) return;
            change.disabled = true;
            change.innerHTML = `${UI.spinner(13)} Starting switch…`;
            try {
              const result = await API.post(`/servers/${id}/migrate`, { version: targetVersion, serverType: targetType });
              const backupState = result.backup ? `Safety backup ${result.backup} created. ` : '';
              const outcome = result.message || 'Software switch started. Watch the console for real installer output.';
              UI.toast(result.backupWarning ? outcome : `${backupState}${outcome}`, result.backupWarning ? 'warn' : 'success');
              close();
              setTab('console');
              setTimeout(() => { loadServer().then(() => { header(); renderSettings(); }).catch(() => {}); }, 800);
            } catch (err) {
              UI.toast(err.message, 'error');
              change.disabled = false;
              change.innerHTML = `${ICONS.refresh} Switch software`;
            }
          };
        },
      });
    };

    root.querySelector('#uploadJar').onclick = () => {
      UI.modal({
        title: 'Upload a custom server jar',
        body: `<div class="col" style="gap:12px">
            <label class="field">Jar file <input type="file" id="jarFile" accept=".jar"></label>
            <label class="field">Version label <input id="jarVersion" placeholder="1.21.4" value="${esc(server.version || '')}"></label>
            <div class="tiny dim">The file is uploaded to the server directory and becomes the launch target (max ${fmt.bytes(2 * 1024 * 1024 * 1024)}).</div>
          </div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doUploadJar">${ICONS.upload} Upload</button>`,
        onMount(mr, { close }) {
          mr.querySelector('#doUploadJar').onclick = async (e) => {
            const file = mr.querySelector('#jarFile').files[0];
            if (!file) return UI.toast('Pick a .jar file first', 'error');
            const btn = e.target.closest('button');
            btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Uploading...`;
            const form = new FormData();
            form.append('jar', file);
            form.append('version', mr.querySelector('#jarVersion').value);
            form.append('serverType', 'CUSTOM');
            try {
              await API.request(`/servers/${id}/jar`, { method: 'POST', body: form });
              UI.toast('Jar uploaded - restart the server', 'success');
              close(); await loadServer(); header();
            } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Upload'; }
          };
        },
      });
    };

    root.querySelector('#manageJava').onclick = async () => {
      const data = await API.get(`/servers/${id}/java`);
      UI.modal({
        title: 'Java runtimes',
        body: `<div class="tiny dim">This server needs Java ${data.required}. Pick an installed runtime or let the panel download a Temurin JRE.</div>
          <div class="divider"></div>
          <div class="col" style="gap:9px">
            ${data.available.map((j) => `<div class="row between card" style="padding:11px">
                <div><b>Java ${j.major || '?'}</b><div class="tiny dim mono">${esc(j.path)}</div></div>
                <div class="row">${j.managed ? '<span class="badge violet">managed</span>' : '<span class="badge">system</span>'}
                <button class="btn sm" data-pick-java="${esc(j.path)}">Use</button></div>
              </div>`).join('') || UI.empty('No Java found', 'Install one below - the panel can fetch it for you.')}
          </div>
          <div class="divider"></div>
          <div class="row" style="gap:8px">
            <input type="number" id="javaVersionToInstall" value="${data.required}" style="max-width:110px">
            <button class="btn" id="installJava">${ICONS.download} Download &amp; install this Java</button>
            <button class="btn ghost" id="resetJava">Use automatic</button>
          </div>`,
        onMount(mr, { close }) {
          mr.querySelectorAll('[data-pick-java]').forEach((b) => b.onclick = async () => {
            await API.patch(`/servers/${id}`, { javaPath: b.dataset.pickJava });
            UI.toast('Java runtime pinned', 'success'); close();
          });
          mr.querySelector('#installJava').onclick = async () => {
            const v = parseInt(mr.querySelector('#javaVersionToInstall').value, 10) || 21;
            try { await API.post(`/servers/${id}/java/install`, { version: v }); UI.toast(`Installing Java ${v} - watch the console`, 'success'); close(); setTab('console'); }
            catch (err) { UI.toast(err.message, 'error'); }
          };
          mr.querySelector('#resetJava').onclick = async () => {
            await API.patch(`/servers/${id}`, { javaPath: '' });
            UI.toast('Using automatic Java selection', 'success'); close();
          };
        },
      });
    };

    root.querySelector('#loadProps').onclick = async (e) => {
      const btn = e.target.closest('button');
      btn.disabled = true;
      try {
        const { properties } = await API.get(`/servers/${id}/properties`);
        const keys = ['motd', 'difficulty', 'gamemode', 'pvp', 'max-players', 'view-distance', 'simulation-distance', 'online-mode', 'level-name', 'level-seed', 'spawn-protection', 'allow-flight', 'enable-command-block', 'white-list', 'server-port'];
        root.querySelector('#propsBox').innerHTML = `<div class="field-row">
            ${keys.filter((k) => properties[k] !== undefined).map((k) => `<label class="field">${k}
              <input data-prop="${k}" value="${esc(properties[k])}"></label>`).join('')}
          </div>
          <button class="btn primary mt" id="saveProps">${ICONS.save} Save properties</button>`;
        root.querySelector('#saveProps').onclick = async () => {
          const props = {};
          root.querySelectorAll('[data-prop]').forEach((i) => { props[i.dataset.prop] = i.value; });
          try { await API.put(`/servers/${id}/properties`, { properties: props }); UI.toast('server.properties saved', 'success'); }
          catch (err) { UI.toast(err.message, 'error'); }
        };
      } catch (err) {
        root.querySelector('#propsBox').innerHTML = `<span class="tiny dim">${esc(err.message)}</span>`;
      }
      btn.disabled = false;
    };
  }

  /* ================================ boot ================================ */

  /* ============================== properties ============================== */
  const PROP_LABELS = {
    motd: ['Message of the day', 'Shown under the server name in the multiplayer list. Supports § colour codes.'],
    'server-port': ['Server port', 'The port players connect to - it is pinned to this server\'s allocation.'],
    'max-players': ['Max players', 'How many players may be online at once.'],
    'gamemode': ['Default game mode', 'survival, creative, adventure or spectator.'],
    'difficulty': ['Difficulty', 'peaceful, easy, normal or hard.'],
    pvp: ['PvP', 'Allow players to damage each other.'],
    'online-mode': ['Online mode (auth)', 'true requires a genuine Minecraft account. Turn off only behind a proxy.'],
    'white-list': ['Whitelist', 'When true only whitelisted players may join.'],
    'enforce-whitelist': ['Enforce whitelist', 'Kick players who are not on the list.'],
    'level-name': ['World folder', 'Which world directory the server loads.'],
    'level-seed': ['World seed', 'Used when the world is generated for the first time.'],
    'level-type': ['World type', 'minecraft:normal, flat, large_biomes, amplified ...'],
    'spawn-protection': ['Spawn protection radius', '0 disables the protected area around spawn.'],
    'view-distance': ['View distance', 'Chunks sent to players (higher = more CPU/RAM).'],
    'simulation-distance': ['Simulation distance', 'Chunks that keep ticking around each player.'],
    'allow-flight': ['Allow flight', 'Needed by some mods/plugins (and for flying in creative).'],
    'allow-nether': ['Allow nether', 'Generate and allow travel to the nether.'],
    'spawn-animals': ['Spawn animals', 'Allow passive mob spawning.'],
    'spawn-monsters': ['Spawn monsters', 'Allow hostile mob spawning.'],
    'spawn-npcs': ['Spawn villagers', 'Allow villager spawning.'],
    'enable-command-block': ['Command blocks', 'Allow command blocks to run.'],
    'force-gamemode': ['Force game mode', 'Reset each player to the default mode on join.'],
    'hardcore': ['Hardcore', 'Death is permanent (spectator mode after dying).'],
    'enable-rcon': ['Enable RCON', 'Remote console protocol - leave off unless you use it.'],
    'enable-query': ['Enable query', 'GameSpy4 query protocol for server list tools.'],
    'player-idle-timeout': ['Idle kick (minutes)', '0 never kicks idle players.'],
    'op-permission-level': ['Op permission level', '1-4, higher gives more commands.'],
    'function-permission-level': ['Function permission level', '1-4 for command blocks/functions.'],
    'network-compression-threshold': ['Compression threshold (bytes)', '-1 disables compression.'],
    'max-world-size': ['Max world size (blocks)', 'Radius limit for world borders.'],
    'hide-online-players': ['Hide online players', 'Hide the player list from the ping response.'],
    'prevent-proxy-connections': ['Prevent proxy connections', 'Reject connections whose IP does not match the auth server.'],
    'require-resource-pack': ['Require resource pack', 'Kick players who decline the resource pack.'],
    'resource-pack': ['Resource pack URL', 'Direct download URL for the pack.'],
    'resource-pack-prompt': ['Resource pack prompt', 'Message shown when asking to download.'],
    'text-filtering-config': ['Text filtering config', 'Chat report filtering (1.19+).'],
    'max-tick-time': ['Max tick time (ms)', '-1 disables the watchdog.'],
    'sync-chunk-writes': ['Sync chunk writes', 'Safer on power loss, slower on disk.'],
    'rate-limit': ['Connection rate limit (packets/s)', 'Packet limit per connection.'],
    'bug-report-link': ['Bug report link', 'Shown in the server list entry.'],
  };

  const PROP_SELECT = {
    gamemode: ['survival', 'creative', 'adventure', 'spectator'],
    difficulty: ['peaceful', 'easy', 'normal', 'hard'],
    'level-type': ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'],
  };

  function propField(key, value) {
    const [label, hint] = PROP_LABELS[key] || [key, ''];
    if (PROP_SELECT[key]) {
      return `<label class="field"><span>${esc(label)}</span>
        <select data-prop="${esc(key)}">${PROP_SELECT[key].map((o) => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}
          ${PROP_SELECT[key].includes(value) ? '' : `<option selected>${esc(value)}</option>`}</select>
        ${hint ? `<span class="tiny dim">${esc(hint)}</span>` : ''}</label>`;
    }
    if (['pvp', 'online-mode', 'white-list', 'enforce-whitelist', 'allow-flight', 'allow-nether', 'spawn-animals',
      'spawn-monsters', 'spawn-npcs', 'enable-command-block', 'force-gamemode', 'hardcore', 'enable-rcon', 'enable-query',
      'hide-online-players', 'prevent-proxy-connections', 'require-resource-pack', 'sync-chunk-writes'].includes(key)) {
      return `<label class="field"><span>${esc(label)}</span>
        <select data-prop="${esc(key)}"><option value="true" ${value === 'true' ? 'selected' : ''}>true</option>
          <option value="false" ${value !== 'true' ? 'selected' : ''}>false</option></select>
        ${hint ? `<span class="tiny dim">${esc(hint)}</span>` : ''}</label>`;
    }
    if (/^-?\d+$/.test(value)) {
      return `<label class="field"><span>${esc(label)}</span><input type="number" data-prop="${esc(key)}" value="${esc(value)}">
        ${hint ? `<span class="tiny dim">${esc(hint)}</span>` : ''}</label>`;
    }
    return `<label class="field"><span>${esc(label)}</span><input data-prop="${esc(key)}" value="${esc(value)}">
      ${hint ? `<span class="tiny dim">${esc(hint)}</span>` : ''}</label>`;
  }

  /** server.properties: a real editor over the real file (plus an advanced view). */
  async function renderProperties() {
    const root = document.getElementById('tab-properties');
    root.innerHTML = UI.spinner();
    let data;
    try { data = await API.get(`/servers/${id}/properties`); }
    catch (err) {
      root.innerHTML = `<div class="banner-note yellow">${ICONS.warn}<div>
        <b>No server.properties yet</b>
        <div class="tiny" style="margin-top:4px">${esc(err.message)}</div>
        <div class="tiny" style="margin-top:6px">The file is created the first time the server starts. Start it once (or install the software) and come back.</div>
      </div></div>`;
      return;
    }
    const props = data.properties || {};
    const common = ['motd', 'server-port', 'max-players', 'gamemode', 'difficulty', 'pvp', 'online-mode', 'white-list',
      'enforce-whitelist', 'level-name', 'level-seed', 'level-type', 'view-distance', 'simulation-distance', 'spawn-protection',
      'allow-flight', 'allow-nether', 'enable-command-block', 'hardcore', 'player-idle-timeout'];
    const rest = Object.keys(props).filter((k) => !common.includes(k)).sort();
    const running = ['running', 'starting'].includes(server.status);

    root.innerHTML = `
      <div class="stack">
        <div class="row between">
          <div>
            <h3 style="margin:0">server.properties</h3>
            <div class="tiny dim">Every value is written straight to the file on disk${running ? ' - a running server needs a restart to pick changes up' : ''}.</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn sm" id="propRaw">${ICONS.folder} Raw file</button>
            <button class="btn sm primary" id="propSave">${ICONS.save} Save changes</button>
          </div>
        </div>
        ${running ? `<div class="banner-note yellow">${ICONS.warn}<div><b>The server is ${esc(server.status)}</b>
          <div class="tiny" style="margin-top:3px">Changes apply after the next restart. Port and world-folder changes need a stop/start, not a reload.</div></div></div>` : ''}
        <div class="card">
          <div class="label tiny dim" style="margin-bottom:10px">Common settings</div>
          <div class="grid cols-2" style="gap:12px">${common.filter((k) => k in props).map((k) => propField(k, props[k])).join('')}</div>
        </div>
        <div class="card">
          <div class="row between"><div class="label tiny dim">All other keys (${rest.length})</div>
            <button class="btn sm ghost" id="propToggleAll">show</button></div>
          <div class="grid cols-2 mt" id="propRest" style="gap:12px;display:none">${rest.map((k) => propField(k, props[k])).join('')}</div>
        </div>
      </div>`;

    const collect = () => {
      const out = {};
      root.querySelectorAll('[data-prop]').forEach((el) => { out[el.dataset.prop] = el.value; });
      return out;
    };
    root.querySelector('#propSave').onclick = async () => {
      const btn = root.querySelector('#propSave');
      btn.disabled = true;
      try {
        const res = await API.put(`/servers/${id}/properties`, { properties: collect() });
        UI.toast(res.needsRestart ? 'Saved - restart the server to apply it' : 'Saved', 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
      btn.disabled = false;
    };
    root.querySelector('#propToggleAll').onclick = (e) => {
      const box = root.querySelector('#propRest');
      const show = box.style.display === 'none';
      box.style.display = show ? 'grid' : 'none';
      e.target.textContent = show ? 'hide' : 'show';
    };
    root.querySelector('#propRaw').onclick = async () => {
      let fresh = data;
      try { fresh = await API.get(`/servers/${id}/properties`); } catch (_) { /* keep old */ }
      UI.modal({
        title: 'server.properties - raw text',
        wide: true,
        body: `<textarea id="rawProps" class="mono" style="width:100%;min-height:420px;font-size:12px">${esc(fresh.raw || '')}</textarea>
          <div class="tiny dim mt">Comments starting with # are preserved. Lines without "=" are ignored by the server.</div>`,
        footer: `<button class="btn" data-close>Close</button><button class="btn primary" id="rawSave">Save file</button>`,
        onMount(m, { close }) {
          m.querySelector('#rawSave').onclick = async () => {
            try {
              await API.put(`/servers/${id}/properties`, { raw: m.querySelector('#rawProps').value });
              UI.toast('server.properties saved', 'success');
              close();
              renderProperties();
            } catch (err) { UI.toast(err.message, 'error'); }
          };
        },
      });
    };
  }

  /* =============================== worlds =============================== */
  async function renderWorlds() {
    const root = document.getElementById('tab-worlds');
    root.innerHTML = UI.spinner();
    let data;
    try { data = await API.get(`/servers/${id}/worlds`); }
    catch (err) { root.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`; return; }
    const worlds = data.worlds || [];
    const total = worlds.reduce((sum, w) => sum + (w.bytes || 0), 0);

    root.innerHTML = `
      <div class="stack">
        <div class="row between">
          <div>
            <h3 style="margin:0">Worlds</h3>
            <div class="tiny dim">${worlds.length} world(s) · ${fmt.bytes(total)} on disk · active world <span class="mono">${esc(data.active)}</span></div>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn sm" id="worldRefresh">${ICONS.refresh} Rescan</button>
            <button class="btn sm primary" id="worldImport">${ICONS.upload} Import a world</button>
          </div>
        </div>
        ${worlds.length ? `<div class="grid cols-2">${worlds.map((w) => `
          <div class="card">
            <div class="row between">
              <div class="row" style="gap:10px">
                <div class="server-icon">${ICONS.globe}</div>
                <div>
                  <div class="row" style="gap:8px"><b>${esc(w.name)}</b>
                    ${w.active ? '<span class="badge green"><i class="dot green"></i>active</span>' : ''}</div>
                  <div class="tiny dim mono">${esc(w.prettyBytes)} · ${w.files} file(s), ${w.regions} region(s)${w.lastPlayed ? ` · played ${fmt.timeAgo(w.lastPlayed)}` : ''}</div>
                </div>
              </div>
            </div>
            <div class="row wrap" style="gap:7px;margin-top:12px">
              ${w.active ? '' : `<button class="btn sm" data-activate="${esc(w.name)}">${ICONS.check} Make active</button>`}
              <button class="btn sm" data-download="${esc(w.name)}">${ICONS.download} Download</button>
              <button class="btn sm" data-duplicate="${esc(w.name)}">${ICONS.plus} Duplicate</button>
              ${w.active ? '' : `<button class="btn sm red" data-delete="${esc(w.name)}">${ICONS.trash}</button>`}
            </div>
          </div>`).join('')}</div>`
          : `<div class="empty"><div><b>No worlds on disk yet</b>
              <div class="tiny dim">A world appears here after the server generates one (first start), or import an existing world as a zip.</div></div></div>`}
        <div class="card">
          <h3 style="margin:0">How this works</h3>
          <div class="muted" style="font-size:13px;line-height:1.8">
            A world is any folder in the server directory that contains a <span class="mono">level.dat</span> - the panel detects them,
            sizes them from the disk and flips <span class="mono">level-name</span> in server.properties when you make one active
            (restart the server to load it). Nether and End folders (<span class="mono">world_nether</span>, <span class="mono">world_the_end</span>)
            travel with their overworld when you delete it.
          </div>
        </div>
      </div>`;

    root.querySelector('#worldRefresh').onclick = renderWorlds;
    root.querySelector('#worldImport').onclick = () => UI.modal({
      title: 'Import a world',
      body: `<div class="col" style="gap:12px">
        <label class="field"><span>World .zip</span><input type="file" id="worldZip" accept=".zip"></label>
        <label class="field"><span>Folder name (optional)</span><input id="worldName" placeholder="leave empty to use the name inside the archive"></label>
        <div class="tiny dim">The archive must contain a <span class="mono">level.dat</span> (directly or inside one folder). Imported worlds never overwrite an existing folder.</div>
      </div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doImport">Import</button>`,
      onMount(m, { close }) {
        m.querySelector('#doImport').onclick = async () => {
          const file = m.querySelector('#worldZip').files[0];
          if (!file) return UI.toast('Choose a .zip first', 'error');
          const form = new FormData();
          form.append('file', file);
          const name = m.querySelector('#worldName').value.trim();
          if (name) form.append('name', name);
          const btn = m.querySelector('#doImport');
          btn.disabled = true;
          btn.innerHTML = `${UI.spinner(13)} uploading`;
          try {
            const res = await API.request(`/servers/${id}/worlds/import`, { method: 'POST', body: form });
            UI.toast(`Imported ${res.name} (${res.prettyBytes})`, 'success');
            close();
            renderWorlds();
          } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Import'; }
        };
      },
    });

    root.querySelectorAll('[data-activate]').forEach((b) => b.onclick = async () => {
      try {
        const res = await API.post(`/servers/${id}/worlds/${encodeURIComponent(b.dataset.activate)}/activate`);
        UI.toast(res.restartRequired ? `"${b.dataset.activate}" is now the active world - restart to load it` : `Active world set to ${b.dataset.activate}`, 'success');
        renderWorlds();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    root.querySelectorAll('[data-download]').forEach((b) => b.onclick = () => {
      const url = `${API_BASE}/servers/${id}/worlds/${encodeURIComponent(b.dataset.download)}/download?token=${encodeURIComponent(store.token)}`;
      window.open(url, '_blank');
    });
    root.querySelectorAll('[data-duplicate]').forEach((b) => b.onclick = async () => {
      try { const res = await API.post(`/servers/${id}/worlds/${encodeURIComponent(b.dataset.duplicate)}/duplicate`); UI.toast(`Copied to ${res.name} (${res.prettyBytes})`, 'success'); renderWorlds(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    root.querySelectorAll('[data-delete]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm(`Delete the world "${b.dataset.delete}"? This removes the folder from disk and cannot be undone.`, { confirmText: 'Delete world' }))) return;
      try { await API.del(`/servers/${id}/worlds/${encodeURIComponent(b.dataset.delete)}`); UI.toast('World deleted', 'success'); renderWorlds(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* ================================ SFTP ================================ */
  async function renderSftp() {
    const root = document.getElementById('tab-sftp');
    root.innerHTML = UI.spinner();
    let info;
    try { info = await API.get(`/servers/${id}/sftp`); }
    catch (err) { root.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`; return; }

    const running = info.status === 'running';
    const copyRow = (label, value, key) => `<div class="row between" style="gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
        <span class="tiny dim">${label}</span>
        <span class="row" style="gap:8px"><span class="mono tiny">${esc(value)}</span>
          <button class="btn sm ghost" data-copy="${esc(value)}" title="Copy">${ICONS.chip}</button></span></div>`;

    root.innerHTML = `
      <div class="stack">
        <div class="row between">
          <div>
            <h3 style="margin:0">SFTP access</h3>
            <div class="tiny dim">Manage this server's files with FileZilla, WinSCP, Cyberduck or the <span class="mono">sftp</span> command.</div>
          </div>
          <button class="btn sm" id="sftpRefresh">${ICONS.refresh} Refresh</button>
        </div>
        ${running
          ? `<div class="banner-note green">${ICONS.check}<div><b>The SFTP server is listening on port ${info.port}</b>
              <div class="tiny" style="margin-top:3px">${info.sessions} session(s) open · ${info.totalConnections} connection(s) since the panel started</div></div></div>`
          : `<div class="banner-note yellow">${ICONS.warn}<div><b>SFTP is not running</b>
              <div class="tiny" style="margin-top:4px">${esc(info.error || 'it is disabled in Admin → Settings')}</div>
              ${info.status === 'unavailable' ? '<div class="tiny" style="margin-top:6px">Install the optional dependency on the panel host: <span class="mono">npm install ssh2</span>, then restart the panel.</div>' : ''}
            </div></div>`}
        <div class="grid cols-2" style="gap:14px">
          <div class="card">
            <div class="label tiny dim" style="margin-bottom:6px">Connection details</div>
            ${copyRow('Host', info.host, 'host')}
            ${copyRow('Port', String(info.port), 'port')}
            ${copyRow('Username', info.username, 'user')}
            ${copyRow('Password', info.passwordHint, 'pass')}
            <div class="copy-box mt"><span class="code grow">${esc(info.url)}</span><button class="btn sm" id="copyUrl">Copy URL</button></div>
            <div class="tiny dim mt">Your username is <span class="mono">&lt;panel user&gt;.&lt;server id&gt;</span> - that is how the panel knows which server to open.</div>
          </div>
          <div class="card">
            <div class="label tiny dim" style="margin-bottom:6px">What you get</div>
            <div class="kv">
              <dt>Root</dt><dd class="mono">/</dd>
              <dt>Contents</dt><dd>worlds, plugins/mods, configs, logs</dd>
              <dt>Protocol</dt><dd>SFTP (SSH file transfer, port ${info.port})</dd>
              <dt>Node</dt><dd>${esc(info.nodeName || 'Local Node')}${info.remoteNode ? ' (remote)' : ''}</dd>
            </div>
            <div class="tiny dim mt">${esc(info.note)}</div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin:0">Connecting</h3>
          <div class="col" style="gap:10px;margin-top:10px">
            <div><div class="tiny dim">Command line</div>
              <div class="copy-box"><span class="code grow">sftp -P ${info.port} ${esc(info.username)}@${esc(info.host)}</span><button class="btn sm" data-copy="sftp -P ${info.port} ${esc(info.username)}@${esc(info.host)}">Copy</button></div></div>
            <div><div class="tiny dim">FileZilla / WinSCP</div>
              <div class="muted tiny">New site -> protocol <b>SFTP - SSH File Transfer Protocol</b>, host <span class="mono">${esc(info.host)}</span>,
                port <span class="mono">${info.port}</span>, logon type <b>Normal</b>, user <span class="mono">${esc(info.username)}</span>, password = your panel password.
                Accept the host key on first connect (the panel generates its own key at <span class="mono">data/ssh/sftp_host_rsa</span>).</div></div>
            <div><div class="tiny dim">rsync over SSH</div>
              <div class="copy-box"><span class="code grow">rsync -av -e "ssh -p ${info.port}" ./my-pack/ ${esc(info.username)}@${esc(info.host)}:/plugins/</span><button class="btn sm" data-copy="rsync -av -e \"ssh -p ${info.port}\" ./my-pack/ ${esc(info.username)}@${esc(info.host)}:/plugins/">Copy</button></div></div>
          </div>
        </div>
      </div>`;

    root.querySelector('#sftpRefresh').onclick = renderSftp;
    root.querySelector('#copyUrl').onclick = () => navigator.clipboard.writeText(info.url).then(() => UI.toast('Copied', 'success'));
    root.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => UI.toast('Copied', 'success')));
  }

  const RENDER = {
    console: renderConsole,
    players: renderPlayersTab,
    files: () => renderFiles(),
    properties: renderProperties,
    worlds: renderWorlds,
    sftp: renderSftp,
    plugins: () => renderPlugins('plugin'),
    mods: () => renderPlugins('mod'),
    backups: renderBackups,
    network: renderNetwork,
    schedules: renderSchedules,
    people: renderPeople,
    settings: renderSettings,
  };

  async function refreshAll(showToast) {
    try {
      await loadServer();
      header();
      Layout.title(server.name, `${server.serverType} ${server.version}`);
      if (showToast) UI.toast('Refreshed', 'success');
      if (server.installProgress && rendered.console) updateInstall(server.installProgress);
    } catch (err) {
      document.getElementById('serverHeader').innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`;
    }
  }

  await refreshAll();
  tabs();
  document.addEventListener('zenith:ready', () => {});

  setInterval(() => {
    if (document.hidden) return;
    const active = (location.hash || '#console').slice(1);
    if (active === 'console') loadLive();
  }, 6000);
})();
