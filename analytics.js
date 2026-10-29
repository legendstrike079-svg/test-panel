/* Analytics: host + fleet history, port usage, audit trail. Pure SVG charts. */
(async function () {
  try { await bootstrap({ active: 'analytics.html' }); } catch (_) { return; }

  const root = document.getElementById('analyticsBody');
  const RANGES = [
    { label: '5 minutes', minutes: 5 },
    { label: '15 minutes', minutes: 15 },
    { label: '30 minutes', minutes: 30 },
    { label: '1 hour', minutes: 60 },
  ];
  let range = Number(localStorage.getItem('zenith_analytics_range') || 30);
  let timer = null;

  Layout.title('Analytics', 'Resource history and activity');
  Layout.actions('');
  root.innerHTML = `
    <div class="card">
      <div class="row between wrap" style="gap:10px">
        <div class="row" style="gap:8px" id="rangePicker">
          ${RANGES.map((r) => `<button class="btn sm" data-range="${r.minutes}">${r.label}</button>`).join('')}
        </div>
        <div class="row" style="gap:8px">
          <span class="badge tiny" id="sampleBadge">sampling…</span>
          <button class="btn sm" id="analyticsRefresh">${ICONS.refresh} Refresh</button>
        </div>
      </div>
      <div class="tiny dim mt">The panel samples the host every 5 seconds and keeps the last hour in memory — no disk writes, nothing to clean up.</div>
    </div>
    <div id="summaryCards" class="grid cols-4"></div>
    <div id="charts" class="stack"></div>
    <div class="dash-split">
      <div class="card" id="fleetCard"><h3>Fleet</h3><div class="mt" id="fleetBody">${UI.skeleton(4)}</div></div>
      <div class="card" id="logCard"><h3>Activity</h3><div class="mt" id="activityBody">${UI.skeleton(6)}</div></div>
    </div>`;

  async function load() {
    const [hist, list, act] = await Promise.all([
      API.get(`/system/history?minutes=${range}&points=140`),
      API.get('/servers'),
      API.get('/system/activity?limit=60'),
    ]);
    renderSummary(hist);
    renderCharts(hist);
    renderFleet(list.servers || []);
    renderActivity(act.activity || []);
    const badge = document.getElementById('sampleBadge');
    if (badge) badge.textContent = `${hist.points} samples · ${Math.round(hist.intervalMs / 1000)}s interval`;
  }

  function renderSummary(hist) {
    const s = hist.summary || {};
    const el = document.getElementById('summaryCards');
    el.innerHTML = `
      <div class="card"><span class="label tiny dim">CPU average</span>
        <div class="stat-row mt"><b>${(s.cpuAvg ?? 0).toFixed(1)}%</b><span class="dim">peak ${(s.cpuPeak ?? 0).toFixed(1)}%</span></div></div>
      <div class="card"><span class="label tiny dim">Memory average</span>
        <div class="stat-row mt"><b>${(s.memoryAvg ?? 0).toFixed(1)}%</b><span class="dim">peak ${(s.memoryPeak ?? 0).toFixed(1)}%</span></div></div>
      <div class="card"><span class="label tiny dim">Players peak</span>
        <div class="stat-row mt"><b>${s.playersPeak ?? 0}</b><span class="dim">in this window</span></div></div>
      <div class="card"><span class="label tiny dim">Disk in use</span>
        <div class="stat-row mt"><b>${s.disk ?? 0}%</b><span class="dim">${s.uptimeSamples ?? 0} samples</span></div></div>`;
  }

  function renderCharts(hist) {
    const series = hist.series || [];
    const el = document.getElementById('charts');
    const last = series[series.length - 1] || {};
    el.innerHTML = `
      <div class="grid cols-2" style="gap:14px">
        <div class="card">
          <div class="row between"><h3 style="margin:0">CPU load</h3><span class="tiny dim mono">now ${(last.cpu ?? 0).toFixed(1)}%</span></div>
          ${Chart.area(series, { key: 'cpu', color: 'var(--blue)', label: 'host cpu', max: 100 })}
        </div>
        <div class="card">
          <div class="row between"><h3 style="margin:0">Memory</h3><span class="tiny dim mono">now ${(last.memory ?? 0).toFixed(1)}%</span></div>
          ${Chart.area(series, { key: 'memory', color: 'var(--violet)', label: 'host memory', max: 100 })}
        </div>
        <div class="card">
          <div class="row between"><h3 style="margin:0">Players online</h3><span class="tiny dim mono">now ${last.players ?? 0}</span></div>
          ${Chart.area(series, { key: 'players', color: 'var(--green)', unit: '', label: 'players', max: Math.max(5, ...series.map((s) => s.players || 0)) * 1.2 })}
        </div>
        <div class="card">
          <div class="row between"><h3 style="margin:0">Servers running</h3><span class="tiny dim mono">${last.running ?? 0} / ${last.servers ?? 0}</span></div>
          ${Chart.area(series, { key: 'running', color: 'var(--yellow)', unit: '', label: 'running servers', max: Math.max(2, ...series.map((s) => s.servers || 0)) })}
        </div>
      </div>`;
  }

  function renderFleet(servers) {
    const el = document.getElementById('fleetBody');
    if (!servers.length) { el.innerHTML = UI.empty('No servers yet'); return; }
    const byStatus = ['running', 'starting', 'installing', 'offline', 'crashed'].map((st) => ({
      label: st, value: servers.filter((s) => s.status === st).length,
      color: { running: 'var(--green)', starting: 'var(--yellow)', installing: 'var(--blue)', offline: 'var(--fg-faint)', crashed: 'var(--red)' }[st],
    }));
    el.innerHTML = `
      <div class="row" style="gap:16px;align-items:center">
        ${Chart.donut(byStatus, { size: 126, thickness: 14, center: String(servers.length), sub: 'servers' })}
        ${Chart.legend(byStatus.filter((i) => i.value).map((i) => ({ ...i, text: i.value })))}
      </div>
      <table class="data mt">
        <thead><tr><th>Server</th><th>Status</th><th>Players</th><th>RAM limit</th><th>Port</th></tr></thead>
        <tbody>
          ${servers.map((s) => `<tr>
            <td><a href="server.html?id=${s.id}">${esc(s.name)}</a><div class="tiny dim">${esc(s.ownerName || '')} · ${esc(s.nodeName || 'local')}</div></td>
            <td>${statusBadge(s.status)}</td>
            <td class="mono">${s.players || 0}/${s.maxPlayers || 0}</td>
            <td class="mono">${fmt.bytes((s.memory || 0) * 1024 * 1024)}</td>
            <td class="mono">${s.port}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderActivity(activity) {
    const el = document.getElementById('activityBody');
    if (!activity.length) { el.innerHTML = UI.empty('Nothing logged yet'); return; }
    el.innerHTML = `<div class="stack" style="gap:0">${activity.map((a) => `
      <div class="row" style="gap:10px;padding:7px 0;border-bottom:1px solid var(--line-subtle)">
        <span class="tiny dim mono" style="flex:0 0 auto">${new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <div class="grow" style="min-width:0">
          <div style="font-size:13px">${esc(a.detail || a.action)}</div>
          <div class="tiny dim">${esc(a.actor || 'system')} · <span class="mono">${esc(a.action)}</span>${a.serverName ? ` · ${esc(a.serverName)}` : ''}</div>
        </div>
      </div>`).join('')}</div>`;
  }

  document.querySelectorAll('[data-range]').forEach((b) => {
    const on = Number(b.dataset.range) === range;
    b.classList.toggle('primary', on);
    b.onclick = () => {
      range = Number(b.dataset.range);
      localStorage.setItem('zenith_analytics_range', String(range));
      document.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('primary', Number(x.dataset.range) === range));
      load().catch((e) => UI.toast(e.message, 'error'));
    };
  });
  document.getElementById('analyticsRefresh').onclick = () => load().catch((e) => UI.toast(e.message, 'error'));
  await load();
  timer = setInterval(() => { load().catch(() => {}); }, 20000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
})();
