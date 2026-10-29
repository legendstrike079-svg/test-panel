/* Allocations: which ports each node owns, which are taken and which are free. */
(async function () {
  try { await bootstrap({ active: 'allocations.html' }); } catch (_) { return; }

  const root = document.getElementById('allocBody');
  Layout.title('Allocations', 'Ports per node');
  Layout.actions(`<button class="btn sm" id="allocRefresh">${ICONS.refresh} Refresh</button>`);

  async function load() {
    try {
      const data = await API.get('/system/allocations');
      const nodes = data.nodes || [];
      root.innerHTML = `
        <div class="grid cols-4">
          <div class="card"><span class="label tiny dim">Nodes</span><div class="stat-row mt"><b>${nodes.length}</b><span class="dim">online ${nodes.filter((n) => n.status === 'online').length}</span></div></div>
          <div class="card"><span class="label tiny dim">Ports tracked</span><div class="stat-row mt"><b>${data.totalPorts}</b><span class="dim">across all nodes</span></div></div>
          <div class="card"><span class="label tiny dim">Assigned</span><div class="stat-row mt"><b>${data.totalUsed}</b><span class="dim">to servers</span></div></div>
          <div class="card"><span class="label tiny dim">Free</span><div class="stat-row mt"><b>${data.totalPorts - data.totalUsed}</b><span class="dim">ready to allocate</span></div></div>
        </div>
        ${nodes.map((n) => nodeCard(n)).join('')}`;
      root.querySelectorAll('[data-copyp]').forEach((b) => {
        b.onclick = () => navigator.clipboard.writeText(b.dataset.copyp).then(() => UI.toast(`Copied port ${b.dataset.copyp}`, 'success'));
      });
    } catch (err) {
      root.innerHTML = `<div class="card">${UI.empty('Could not load allocations', err.message)}</div>`;
    }
  }

  function nodeCard(node) {
    const ports = [];
    for (let p = node.range.start; p <= node.range.end; p += 1) ports.push(p);
    const usedAt = new Map(node.used.map((u) => [u.port, u]));
    return `
      <div class="card">
        <div class="row between wrap" style="gap:10px">
          <div class="row" style="gap:10px">
            <div class="server-icon" style="width:42px;height:42px;flex:0 0 42px;font-size:13px">${esc(node.name.slice(0, 2).toUpperCase())}</div>
            <div>
              <div class="row" style="gap:8px"><b>${esc(node.name)}</b>${node.local ? '<span class="badge tiny">panel host</span>' : '<span class="badge tiny blue">remote agent</span>'}</div>
              <div class="tiny dim mono">${node.range.start}–${node.range.end} · ${node.usedCount}/${node.total} allocated · next free ${node.nextFree ?? 'none'}</div>
            </div>
          </div>
          <div class="row" style="gap:8px">
            <span class="badge ${node.status === 'online' ? 'green' : 'red'}"><i class="dot ${node.status === 'online' ? 'green' : 'red'}"></i>${esc(node.status)}</span>
            <a class="btn sm" href="nodes.html">${ICONS.node} Manage</a>
          </div>
        </div>
        <div class="bar ${node.usedCount / node.total > 0.85 ? 'red' : 'blue'} mt"><i style="width:${Math.round((node.usedCount / node.total) * 100)}%"></i></div>
        <div class="alloc-grid mt" style="max-height:230px;overflow:auto">
          ${ports.map((p) => {
            const u = usedAt.get(p);
            return `<span class="alloc-port ${u ? 'used' : 'free'}" ${u ? `title="${esc(u.name)} · ${esc(u.owner || '')} · ${esc(u.status || '')}"` : ''}>${u ? `<a href="server.html?id=${u.serverId}">${p}</a>` : p}</span>`;
          }).join('')}
        </div>
        ${node.used.length ? `
          <div class="divider"></div>
          <table class="data">
            <thead><tr><th>Port</th><th>Server</th><th>Owner</th><th>Software</th><th>Status</th></tr></thead>
            <tbody>${node.used.map((u) => `<tr>
              <td class="mono">${u.port} <button class="btn ghost sm icon" data-copyp="${u.port}" title="Copy">${ICONS.folder}</button></td>
              <td><a href="server.html?id=${u.serverId}">${esc(u.name)}</a></td>
              <td>${esc(u.owner || '')}</td>
              <td class="mono tiny">${esc(u.serverType || '')} ${esc(u.version || '')}</td>
              <td>${statusBadge(u.status || 'offline')}</td>
            </tr>`).join('')}</tbody>
          </table>` : '<div class="tiny dim mt">No servers on this node yet.</div>'}
      </div>`;
  }

  document.getElementById('allocRefresh').onclick = () => load();
  await load();
  setInterval(load, 30000);
})();
