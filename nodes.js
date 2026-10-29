/* Nodes page: local machine + remote worker nodes */
(async function () {
  const root = document.getElementById('nodesContent');
  try { await bootstrap({ active: 'nodes.html' }); } catch (_) { return; }
  const isAdmin = ['admin', 'owner'].includes(store.user.role);

  Layout.title('Nodes', 'machines that host your servers');
  Layout.actions(`${isAdmin ? `<button class="btn sm primary" id="addNode">${ICONS.plus} Add node</button>
      <button class="btn sm" id="dockerBtn">${ICONS.docker} Docker</button>` : ''}
    <button class="btn sm" id="refreshNodes">${ICONS.refresh} Refresh</button>`);
  if (isAdmin) document.getElementById('dockerBtn').onclick = openDocker;
  const addBtn = document.getElementById('addNode');
  if (addBtn) addBtn.onclick = openAdd;
  document.getElementById('refreshNodes').onclick = () => load(true);

  let dockerState = null;

  async function load(showToast) {
    try {
      const data = await API.post('/nodes/refresh');
      if (isAdmin) {
        try { dockerState = await API.get('/system/docker'); } catch (_) { dockerState = null; }
      }
      render(data.nodes);
      if (showToast) UI.toast('Node status refreshed', 'success');
    } catch (err) {
      root.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`;
    }
  }

  function nodeCard(n) {
    const stats = n.stats || {};
    const memTotal = stats.memory ? stats.memory.total : 0;
    const memFree = stats.memory ? stats.memory.free : 0;
    const memPct = memTotal ? ((memTotal - memFree) / memTotal) * 100 : 0;
    const online = n.status === 'online';
    return `<div class="card">
      <div class="row between">
        <div class="row" style="gap:12px">
          <div class="server-icon">${ICONS.node}</div>
          <div>
            <div class="row" style="gap:8px"><b style="font-size:15px">${esc(n.name)}</b>
              ${online ? '<span class="badge green"><i class="dot green"></i>online</span>'
                : n.status === 'unknown' ? '<span class="badge"><i class="dot"></i>not checked</span>'
                : '<span class="badge red"><i class="dot red"></i>offline</span>'}
              ${n.local ? '<span class="badge violet">this host</span>' : ''}
              ${((n.backend || 'process') === 'docker') ? `<span class="badge blue">${ICONS.docker} containers</span>` : '<span class="badge">processes</span>'}
              ${n.maintenance ? '<span class="badge yellow">maintenance</span>' : ''}
            </div>
            <div class="tiny dim mono">${esc(n.fqdn)}${n.local ? '' : `:${n.port}`} · ${n.servers} server(s)${n.portRange ? ` · ports ${n.portRange.start}-${n.portRange.end}` : ''}</div>
          </div>
        </div>
        <div class="row" style="gap:7px">
          ${isAdmin ? `<button class="btn sm" data-health-node="${esc(n.id)}" title="Run a real health check">${ICONS.health} check</button>` : ''}
          <button class="btn sm" data-detail-node="${esc(n.id)}">details</button>
          ${isAdmin ? `<button class="btn sm" data-edit-node="${esc(n.id)}" title="Node settings">${ICONS.edit}</button>` : ''}
          ${isAdmin && !n.local ? `<button class="btn sm red" data-del-node="${esc(n.id)}">${ICONS.trash}</button>` : ''}
        </div>
      </div>
      <div class="grid cols-3 mt" style="gap:12px">
        <div>
          <div class="row between tiny"><span class="dim">Memory</span><span class="mono">${memTotal ? `${fmt.bytes(memTotal - memFree)} / ${fmt.bytes(memTotal)}` : '-'}</span></div>
          <div class="bar ${memPct > 85 ? 'red' : memPct > 65 ? 'yellow' : 'blue'}"><i style="width:${memPct}%"></i></div>
        </div>
        <div>
          <div class="row between tiny"><span class="dim">Cores / load</span><span class="mono">${stats.cores || '?'} / ${stats.load !== undefined ? stats.load.toFixed(2) : '-'}</span></div>
          <div class="bar"><i style="width:${Math.min((stats.load || 0) / (stats.cores || 1) * 100, 100)}%"></i></div>
        </div>
        <div>
          <div class="row between tiny"><span class="dim">Port range</span><span class="mono">${n.portRange ? `${n.portRange.start}-${n.portRange.end}` : '-'}</span></div>
          <div class="bar green"><i style="width:${Math.min((n.servers / Math.max((n.portRange ? n.portRange.end - n.portRange.start : 100), 1)) * 100, 100)}%"></i></div>
        </div>
      </div>
      <div class="row between mt tiny dim">
        <span>${stats.hostname ? esc(stats.hostname) : ''} ${stats.platform ? `· ${esc(stats.platform)}` : ''} ${stats.arch ? `· ${esc(stats.arch)}` : ''}</span>
        <span>last heartbeat ${n.lastHeartbeat ? fmt.timeAgo(n.lastHeartbeat) : 'never'}</span>
      </div>
      ${n.installCommand ? `<div class="divider"></div>
        <div class="tiny dim" style="margin-bottom:6px">Install the agent on that machine to attach it to this panel:</div>
        <div class="copy-box"><span class="code grow">${esc(n.installCommand)}</span><button class="btn sm" data-copy="${esc(n.installCommand)}">Copy</button></div>` : ''}
    </div>`;
  }

  function dockerBanner() {
    if (!isAdmin || !dockerState) return '';
    const d = dockerState;
    if (!d.available) {
      return `<div class="banner-note yellow">${ICONS.warn}<div>
        <b>Docker is not available on this host</b>
        <div class="tiny" style="margin-top:4px">${esc(d.error || 'unknown error')}</div>
        <div class="tiny" style="margin-top:6px">Container servers cannot start until this is fixed. Run
          <span class="mono">bash install.sh --repair --node docker</span> or install Docker manually, then press Verify.</div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" id="dockerVerify">${ICONS.health} Verify engine</button>
        <button class="btn sm ghost" id="dockerDetails">details</button></div>
      </div></div>`;
    }
    return `<div class="card"><div class="row between">
      <div class="row" style="gap:12px">
        <div class="server-icon">${ICONS.docker}</div>
        <div>
          <div class="row" style="gap:8px"><b>Docker engine ${esc(d.engine || '')}</b>
            <span class="badge green"><i class="dot green"></i>ready</span>
            ${d.storageDriver ? `<span class="badge">${esc(d.storageDriver)}</span>` : ''}</div>
          <div class="tiny dim mono">api ${esc(d.apiVersion || '?')} · ${d.containerCount ?? 0} container(s), ${d.runningCount ?? 0} running · ${d.images ?? 0} image(s)${d.memory ? ` · host ${Math.round(d.memory / 1073741824)} GB / ${d.cpus} cores` : ''}</div>
        </div>
      </div>
      <div class="row" style="gap:7px">
        <button class="btn sm" id="dockerImages">${ICONS.container} Images</button>
        <button class="btn sm" id="dockerDetails">details</button>
      </div>
    </div></div>`;
  }

  function render(nodes) {
    root.innerHTML = `
      ${dockerBanner()}
      <div class="grid cols-2">${nodes.map(nodeCard).join('')}</div>
      <div class="card">
        <h3>How nodes work</h3>
        <div class="muted" style="font-size:13px;line-height:1.8">
          The panel host is a node by default: <b>install.sh</b> registers it as <b>Local Node</b> with credentials it
          generates, detects the CPU/RAM/disk/IP and only marks it online after a real health check passes.
          Servers can run two ways on it - as java <b>processes</b> (default) or inside <b>Docker containers</b>
          (one container per server, with CPU/memory limits and the port published). Add another machine with
          <b>Add node</b> and run the generated <span class="mono">curl | bash</span> command on it.
        </div>
      </div>`;
    const verifyBtn = root.querySelector('#dockerVerify');
    if (verifyBtn) verifyBtn.onclick = verifyDocker;
    const det = root.querySelector('#dockerDetails');
    if (det) det.onclick = openDocker;
    const imgs = root.querySelector('#dockerImages');
    if (imgs) imgs.onclick = openDocker;
    root.querySelectorAll('[data-health-node]').forEach((b) => b.onclick = () => runHealthCheck(b.dataset.healthNode, b));
    root.querySelectorAll('[data-edit-node]').forEach((b) => b.onclick = () => openEdit(nodes.find((x) => x.id === b.dataset.editNode)));
    root.querySelectorAll('[data-detail-node]').forEach((b) => b.onclick = () => openDetail(nodes.find((x) => x.id === b.dataset.detailNode)));
    root.querySelectorAll('[data-del-node]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm('Remove this node?', { confirmText: 'Remove' }))) return;
      try { await API.del(`/nodes/${b.dataset.delNode}`); UI.toast('Node removed', 'success'); load(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /** Node detail: live agent health, the servers placed here and the agent command. */
  async function openDetail(node) {
    if (!node) return;
    const stats = node.stats || {};
    const memTotal = stats.memory ? stats.memory.total : 0;
    const memFree = stats.memory ? stats.memory.free : 0;
    const memPct = memTotal ? Math.round(((memTotal - memFree) / memTotal) * 100) : 0;
    const disk = stats.disk || null;

    let servers = [];
    try {
      const all = await API.get('/servers');
      servers = (all.servers || []).filter((sv) => sv.nodeId === node.id);
    } catch (_) { /* non-admin: still show telemetry */ }

    UI.modal({
      title: `${node.name}${node.local ? ' (this host)' : ''}`,
      wide: true,
      body: `<div class="col" style="gap:14px">
          <div class="grid cols-3" style="gap:12px">
            <div class="card flush"><div class="card-body">
              <div class="label tiny dim">Status</div>
              <div class="row" style="gap:8px;margin-top:6px">
                ${node.status === 'online' ? '<span class="badge green"><i class="dot green"></i>online</span>' : '<span class="badge red"><i class="dot red"></i>offline</span>'}
                <span class="tiny dim">heartbeat ${node.lastHeartbeat ? fmt.timeAgo(node.lastHeartbeat) : 'never'}</span>
              </div>
              <div class="tiny dim mono mt">${esc(node.fqdn || '')}${node.local ? '' : `:${node.port}`}</div>
            </div></div>
            <div class="card flush"><div class="card-body">
              <div class="label tiny dim">CPU</div>
              <div class="value mono" style="font-size:20px">${stats.cores || '?'} cores</div>
              <div class="bar mt"><i style="width:${Math.min((stats.load || 0) / (stats.cores || 1) * 100, 100)}%"></i></div>
              <div class="tiny dim mt">load ${stats.load !== undefined ? stats.load : '-'} · ${esc(stats.arch || '')}</div>
            </div></div>
            <div class="card flush"><div class="card-body">
              <div class="label tiny dim">Memory</div>
              <div class="value mono" style="font-size:20px">${memPct}%</div>
              <div class="bar ${memPct > 85 ? 'red' : memPct > 65 ? 'yellow' : 'blue'} mt"><i style="width:${memPct}%"></i></div>
              <div class="tiny dim mt">${memTotal ? `${fmt.bytes(memTotal - memFree)} / ${fmt.bytes(memTotal)}` : 'unknown'}</div>
            </div></div>
          </div>
          ${disk ? `<div><div class="row between tiny"><span class="dim">Disk (${esc(node.local ? 'panel host' : 'agent dir')})</span>
            <span class="mono">${fmt.bytes(disk.used)} / ${fmt.bytes(disk.total)} (${disk.percent}%)</span></div>
            <div class="bar ${disk.percent > 90 ? 'red' : disk.percent > 75 ? 'yellow' : 'green'}"><i style="width:${disk.percent}%"></i></div></div>` : ''}
          <div>
            <div class="label tiny dim" style="margin-bottom:8px">Servers on this node (${servers.length})</div>
            ${servers.length ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Server</th><th>Status</th><th>Port</th><th>Type</th><th style="text-align:right">Open</th></tr></thead>
              <tbody>${servers.map((sv) => `<tr>
                <td><b>${esc(sv.name)}</b><div class="tiny dim">${esc(sv.ownerName || '')}</div></td>
                <td>${statusBadge(sv.status)}</td>
                <td class="mono">${sv.port}</td>
                <td class="mono tiny">${esc(sv.serverType)} ${esc(sv.version || '')}</td>
                <td style="text-align:right"><a class="btn sm ghost" href="server.html?id=${esc(sv.id)}">manage</a></td>
              </tr>`).join('')}</tbody></table></div>`
              : '<div class="empty"><div><b>No servers here yet</b><div class="tiny dim">Pick this node when creating a server to place one here.</div></div></div>'}
          </div>
          <div class="grid cols-2" style="gap:12px">
            <div>
              <div class="label tiny dim" style="margin-bottom:6px">Port allocation</div>
              <div class="kv"><dt>Range</dt><dd class="mono">${node.portRange ? `${node.portRange.start}-${node.portRange.end}` : '-'}</dd>
                <dt>Used</dt><dd class="mono">${servers.length} / ${node.portRange ? node.portRange.end - node.portRange.start + 1 : '-'}</dd>
                <dt>Memory limit</dt><dd class="mono">${node.memoryLimit ? `${node.memoryLimit} MB` : 'unlimited'}</dd>
                <dt>Disk limit</dt><dd class="mono">${node.diskLimit ? `${node.diskLimit} MB` : 'unlimited'}</dd></div>
            </div>
            <div>
              <div class="label tiny dim" style="margin-bottom:6px">Runtime</div>
              <div class="kv">
                <dt>Servers run as</dt><dd>${(node.backend || 'process') === 'docker' ? 'Docker containers' : 'java processes'}</dd>
                <dt>Container image</dt><dd class="mono">${esc(node.dockerImage || (node.backend === 'docker' ? 'eclipse-temurin:<java>-jre' : '-'))}</dd>
                <dt>Last health check</dt><dd>${node.health && node.health.at ? `${fmt.timeAgo(node.health.at)} (${node.health.ok ? 'passed' : 'failed'})` : 'not run yet'}</dd>
                <dt>Docker</dt><dd>${node.stats && node.stats.docker ? (node.stats.docker.available ? `engine ${esc(node.stats.docker.engine || '')}` : `<span class="red-t">unavailable: ${esc(node.stats.docker.error || '')}</span>`) : 'not reported'}</dd>
                ${node.local ? '<dt>Credentials</dt><dd class="mono tiny">/etc/zenith/node.env</dd>' : ''}
              </div>
            </div>
            <div>
              <div class="label tiny dim" style="margin-bottom:6px">Agent</div>
              <div class="tiny dim" style="line-height:1.7">
                ${node.local
                  ? 'The panel supervises servers itself on this host - no agent required.'
                  : `The agent runs as a systemd service (<span class="mono">systemctl status zenith-node</span>) and is polled every 2 s while a server is running here.`}
              </div>
            </div>
          </div>
          ${isAdmin && node.local ? `<div>
            <div class="label tiny dim" style="margin-bottom:6px">Containers on this host</div>
            <div id="nodeContainers" class="tiny dim">loading...</div>
          </div>` : ''}
          ${node.installCommand ? `<div>
            <div class="label tiny dim" style="margin-bottom:6px">Attach another machine</div>
            <div class="copy-box"><span class="code grow">${esc(node.installCommand)}</span><button class="btn sm" data-copy="${esc(node.installCommand)}">Copy</button></div>
          </div>` : ''}
        </div>`,
      footer: `<button class="btn" data-close>Close</button>
        ${node.local ? '' : `<button class="btn" id="verifyNode">Ping agent</button>`}`,
      onMount(m, { close }) {
        // the shared [data-copy] handler runs on document, so bind it explicitly here too
        m.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => UI.toast('Copied', 'success')); });
        const dh = m.querySelector('#detailHealth');
        if (dh) dh.onclick = () => { close(); runHealthCheck(node.id); };
        const de = m.querySelector('#detailEdit');
        if (de) de.onclick = () => { close(); openEdit(node); };
        const box = m.querySelector('#nodeContainers');
        if (box) {
          API.get(`/nodes/${node.id}/containers`).then((res) => {
            const list = res.containers || [];
            box.innerHTML = list.length
              ? `<div class="table-wrap"><table class="data"><thead><tr><th>Container</th><th>Server</th><th>State</th><th>Ports</th></tr></thead>
                  <tbody>${list.map((c) => `<tr><td class="mono tiny">${esc(c.name)}</td>
                    <td><a class="mono tiny" href="server.html?id=${esc(c.serverId)}">${esc(c.serverId)}</a></td>
                    <td>${c.state === 'running' ? '<span class="badge green">running</span>' : `<span class="badge">${esc(c.state)}</span>`}</td>
                    <td class="mono tiny dim">${esc(c.ports || '-')}</td></tr>`).join('')}</tbody></table></div>`
              : '<div class="tiny dim">No containers on this host yet.</div>';
          }).catch((err) => { box.innerHTML = `<div class="tiny red-t">${esc(err.message)}</div>`; });
        }
        const verify = m.querySelector('#verifyNode');
        if (verify) verify.onclick = async () => {
          verify.disabled = true;
          verify.innerHTML = `${UI.spinner(13)} Pinging...`;
          try {
            const res = await API.post('/nodes/refresh');
            const fresh = (res.nodes || []).find((x) => x.id === node.id);
            UI.toast(fresh && fresh.status === 'online' ? `Agent answered (${fresh.stats && fresh.stats.hostname ? fresh.stats.hostname : 'ok'})` : 'Agent did not answer', fresh && fresh.status === 'online' ? 'success' : 'error');
            load();
          } catch (err) { UI.toast(err.message, 'error'); }
          verify.disabled = false;
          verify.textContent = 'Ping agent';
        };
        void close;
      },
    });
  }

  async function verifyDocker() {
    const btn = root.querySelector('#dockerVerify') || root.querySelector('#dockerVerifyModal');
    if (btn) { btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Verifying...`; }
    try {
      const res = await API.post('/system/docker/verify');
      UI.toast(`Docker ${res.engine} answered (${(res.containers || []).length} panel container(s))`, 'success');
    } catch (err) { UI.toast(err.message, 'error'); }
    load();
  }

  /** Docker panel: engine details, images (pull on demand) and the containers. */
  async function openDocker() {
    let summary = dockerState;
    let images = [];
    let containers = [];
    try { summary = await API.get('/system/docker'); } catch (err) { UI.toast(err.message, 'error'); }
    if (summary && summary.available) {
      try { images = (await API.get('/system/docker/images')).images || []; } catch (_) { images = []; }
      containers = summary.containers || [];
    }
    UI.modal({
      title: 'Docker',
      wide: true,
      body: `<div class="col" style="gap:14px">
        ${summary && summary.available ? `
          <div class="grid cols-3" style="gap:12px">
            <div class="card flush"><div class="card-body">
              <div class="label tiny dim">Engine</div><div class="value mono" style="font-size:18px">${esc(summary.engine || '?')}</div>
              <div class="tiny dim mt">api ${esc(summary.apiVersion || '?')} · ${esc(summary.storageDriver || '')}</div></div></div>
            <div class="card flush"><div class="card-body">
              <div class="label tiny dim">Containers</div><div class="value mono" style="font-size:18px">${summary.containerCount ?? (summary.containers || []).length}</div>
              <div class="tiny dim mt">${summary.runningCount ?? 0} running now</div></div></div>
            <div class="card flush"><div class="card-body">
              <div class="label tiny dim">Host</div><div class="value mono" style="font-size:18px">${summary.cpus || '?'} cores</div>
              <div class="tiny dim mt">${summary.memory ? `${Math.round(summary.memory / 1073741824)} GB RAM · ${esc(summary.kernel || '')}` : ''}</div></div></div>
          </div>
          <div>
            <div class="row between" style="margin-bottom:8px"><span class="label tiny dim">Images</span>
              <button class="btn sm" id="pullImage">${ICONS.download} Pull an image</button></div>
            ${images.length ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Repository</th><th>Tag</th><th>Id</th><th>Size</th></tr></thead>
              <tbody>${images.map((i) => `<tr><td class="mono">${esc(i.repository)}</td><td class="mono">${esc(i.tag)}</td>
                <td class="mono tiny dim">${esc(String(i.id).slice(0, 19))}</td><td class="mono tiny">${esc(i.size || '')}</td></tr>`).join('')}</tbody></table></div>`
              : '<div class="empty"><div><b>No images yet</b><div class="tiny dim">The panel pulls eclipse-temurin:&lt;java&gt;-jre automatically when a server starts.</div></div></div>'}
          </div>
          <div>
            <div class="label tiny dim" style="margin-bottom:8px">Containers owned by the panel (${containers.length})</div>
            ${containers.length ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Container</th><th>Server</th><th>State</th><th>Ports</th></tr></thead>
              <tbody>${containers.map((c) => `<tr><td class="mono tiny">${esc(c.name)}</td>
                <td><a class="mono tiny" href="server.html?id=${esc(c.serverId)}">${esc(c.serverId)}</a></td>
                <td>${c.state === 'running' ? '<span class="badge green">running</span>' : `<span class="badge">${esc(c.state)}</span>`}</td>
                <td class="mono tiny dim">${esc(c.ports || '-')}</td></tr>`).join('')}</tbody></table></div>`
              : '<div class="empty"><div><b>No containers</b><div class="tiny dim">They appear here as soon as a server on a container node starts.</div></div></div>'}
          </div>
          <div class="tiny dim">A server on a container node runs as <span class="mono">docker start -a -i zenith-&lt;server id&gt;</span>, so the console,
            the player list and one-click commands work exactly like they do for process servers. Memory and CPU are enforced by the cgroup
            (<span class="mono">--memory ${'{'}Xmx + 384{'}'}m</span>, <span class="mono">--cpus</span> when a node has a core limit).</div>`
        : `<div class="banner-note red">${ICONS.warn}<div><b>Docker is not available</b>
            <div class="tiny" style="margin-top:4px">${esc((summary && summary.error) || 'unknown error')}</div>
            <div class="tiny" style="margin-top:6px">Install it with <span class="mono">bash install.sh --repair --node docker</span> (Ubuntu/Debian)
              then press Verify. Nothing is simulated: container servers stay offline until the daemon answers.</div></div></div>`}
      </div>`,
      footer: `<button class="btn" data-close>Close</button>
        <button class="btn primary" id="dockerVerifyModal">${ICONS.health} Verify engine</button>`,
      onMount(m, { close }) {
        const pull = m.querySelector('#pullImage');
        if (pull) pull.onclick = () => {
          UI.modal({
            title: 'Pull an image',
            body: `<label class="field">Image reference <input id="imgRef" value="eclipse-temurin:21-jre" placeholder="eclipse-temurin:21-jre"></label>
              <div class="tiny dim mt">Pulled straight from the registry by the docker daemon - the output is the real one.</div>`,
            footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doPull">Pull</button>`,
            onMount(mm, { close: cc }) {
              mm.querySelector('#doPull').onclick = async () => {
                const ref = mm.querySelector('#imgRef').value.trim();
                UI.toast(`Pulling ${ref}...`, 'info');
                try { await API.post('/system/docker/pull', { image: ref }); UI.toast(`${ref} is ready`, 'success'); cc(); close(); openDocker(); }
                catch (err) { UI.toast(err.message, 'error'); }
              };
            },
          });
        };
        m.querySelector('#dockerVerifyModal').onclick = () => verifyDocker();
        void close;
      },
    });
  }

  /** Real health check: shows every measured check, never a green badge by default. */
  async function runHealthCheck(nodeId, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} checking`; }
    let result = null;
    let httpStatus = 200;
    try {
      result = await API.post(`/nodes/${nodeId}/health-check`);
    } catch (err) {
      result = (err.data && err.data.checks) ? err.data : { ok: false, error: err.message, checks: [] };
      httpStatus = 409;
    }
    if (btn) { btn.disabled = false; btn.innerHTML = `${ICONS.health} check`; }
    const checks = result.checks || [];
    UI.modal({
      title: result.ok ? 'Node health: all checks passed' : 'Node health: problems found',
      body: `<div class="col" style="gap:12px">
        <div class="banner-note ${result.ok ? 'green' : 'red'}">${ICONS[result.ok ? 'check' : 'warn']}<div>
          ${result.ok ? `<b>Everything answered</b> - the panel marks this node online.` : `<b>The node stays offline until these are fixed.</b>
            <div class="tiny mono" style="margin-top:6px">${esc(result.error || '')}</div>`}
          <div class="tiny dim" style="margin-top:4px">checked ${result.at ? fmt.timeAgo(result.at) : 'now'} · round trip ${result.latencyMs || 0} ms</div>
        </div></div>
        ${checks.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th style="width:36px"></th><th>Check</th><th>Detail (measured, not guessed)</th></tr></thead>
          <tbody>${checks.map((c) => `<tr>
            <td>${c.ok ? `<span class="dot-check green">${ICONS.check}</span>` : `<span class="dot-check red">${ICONS.close}</span>`}</td>
            <td><b>${esc(c.name)}</b></td><td class="tiny mono dim">${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${httpStatus === 409 ? `<div class="tiny dim">Tip: for the local node, "docker is not available" only blocks container servers - switch the node backend to
          <span class="mono">process</span> in the node settings to keep serving with plain java processes.</div>` : ''}
      </div>`,
      footer: `<button class="btn" data-close>Close</button><button class="btn primary" id="hcRepair">${ICONS.wand} Repair node</button>`,
      onMount(m, { close }) {
        m.querySelector('#hcRepair').onclick = async () => {
          try {
            const res = await API.post(`/nodes/${nodeId}/repair`);
            UI.toast(res.actions.join(' · '), res.ok ? 'success' : 'error');
            close(); load();
          } catch (err) { UI.toast(err.message, 'error'); }
        };
      },
    });
    load();
  }

  /** Node settings: identity, backend, container image, allocations and limits. */
  function openEdit(node) {
    if (!node) return;
    const r = node.portRange || { start: 25565, end: 25665 };
    UI.modal({
      title: `Node settings - ${node.name}`,
      wide: true,
      body: `<div class="col" style="gap:12px">
        <div class="grid cols-2" style="gap:12px">
          <label class="field">Name <input id="eName" value="${esc(node.name)}"></label>
          <label class="field">Description <input id="eDesc" value="${esc(node.description || '')}"></label>
        </div>
        <div class="grid cols-3" style="gap:12px">
          <label class="field">FQDN / IP <input id="eFqdn" value="${esc(node.fqdn || '')}" ${node.local ? 'disabled' : ''}></label>
          <label class="field">Port <input type="number" id="ePort" value="${node.port || 8443}" ${node.local ? 'disabled' : ''}></label>
          <label class="field">Scheme <select id="eScheme"><option ${node.scheme === 'https' ? '' : 'selected'}>http</option><option ${node.scheme === 'https' ? 'selected' : ''}>https</option></select></label>
        </div>
        <div class="grid cols-2" style="gap:12px">
          <label class="field">Server runtime
            <select id="eBackend">
              <option value="process" ${(node.backend || 'process') === 'process' ? 'selected' : ''}>Plain java process</option>
              <option value="docker" ${node.backend === 'docker' ? 'selected' : ''}>Docker containers</option>
            </select></label>
          <label class="field">Container image <input id="eImage" value="${esc(node.dockerImage || 'eclipse-temurin:21-jre')}" placeholder="eclipse-temurin:21-jre"></label>
        </div>
        <div class="grid cols-3" style="gap:12px">
          <label class="field">Port range start <input type="number" id="eStart" value="${r.start}"></label>
          <label class="field">Port range end <input type="number" id="eEnd" value="${r.end}"></label>
          <label class="field">CPU limit (cores, 0 = none) <input type="number" id="eCpu" value="${node.cpuLimit || 0}"></label>
        </div>
        <div class="grid cols-3" style="gap:12px">
          <label class="field">Memory limit MB (0 = none) <input type="number" id="eMem" value="${node.memoryLimit || 0}"></label>
          <label class="field">Disk limit MB (0 = none) <input type="number" id="eDisk" value="${node.diskLimit || 0}"></label>
          <label class="field">Maintenance mode <select id="eMaint"><option value="false" ${node.maintenance ? '' : 'selected'}>off</option><option value="true" ${node.maintenance ? 'selected' : ''}>on (no new servers)</option></select></label>
        </div>
        <div class="tiny dim">Switching to containers requires a working Docker engine on that host - the panel checks it before saving and refuses with the exact error otherwise.
          Existing servers keep their own runtime; new servers placed here use the node default.</div>
      </div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveNode">Save changes</button>`,
      onMount(m, { close }) {
        m.querySelector('#saveNode').onclick = async () => {
          const body = {
            name: m.querySelector('#eName').value,
            description: m.querySelector('#eDesc').value,
            portRange: { start: parseInt(m.querySelector('#eStart').value, 10), end: parseInt(m.querySelector('#eEnd').value, 10) },
            backend: m.querySelector('#eBackend').value,
            dockerImage: m.querySelector('#eImage').value.trim(),
            cpuLimit: parseInt(m.querySelector('#eCpu').value, 10) || 0,
            memoryLimit: parseInt(m.querySelector('#eMem').value, 10) || 0,
            diskLimit: parseInt(m.querySelector('#eDisk').value, 10) || 0,
            maintenance: m.querySelector('#eMaint').value === 'true',
          };
          if (!node.local) {
            Object.assign(body, {
              fqdn: m.querySelector('#eFqdn').value.trim(),
              port: parseInt(m.querySelector('#ePort').value, 10),
              scheme: m.querySelector('#eScheme').value,
            });
          }
          try {
            await API.patch(`/nodes/${node.id}`, body);
            UI.toast('Node updated', 'success');
            close();
            load();
          } catch (err) { UI.toast(err.message, 'error'); }
        };
      },
    });
  }

  function openAdd() {
    UI.modal({
      title: 'Add a remote node',
      body: `<div class="col" style="gap:12px">
          <label class="field">Node name <input id="nName" placeholder="node-eu-1"></label>
          <label class="field">FQDN or IP <input id="nFqdn" placeholder="node1.example.com"></label>
          <div class="field-row">
            <label class="field">Agent port <input type="number" id="nPort" value="8443"></label>
            <label class="field">HTTP or HTTPS <select id="nScheme"><option>http</option><option>https</option></select></label>
          </div>
          <div class="field-row">
            <label class="field">Port range start <input type="number" id="nStart" value="25565"></label>
            <label class="field">Port range end <input type="number" id="nEnd" value="25665"></label>
          </div>
          <div class="tiny dim">After creating the node you get a one-line install command for that machine.</div>
        </div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doAddNode">Create node</button>`,
      onMount(m, { close }) {
        m.querySelector('#doAddNode').onclick = async () => {
          try {
            const res = await API.post('/nodes', {
              name: m.querySelector('#nName').value,
              fqdn: m.querySelector('#nFqdn').value,
              port: parseInt(m.querySelector('#nPort').value, 10),
              scheme: m.querySelector('#nScheme').value,
              portRange: { start: parseInt(m.querySelector('#nStart').value, 10), end: parseInt(m.querySelector('#nEnd').value, 10) },
            });
            close();
            UI.modal({
              title: 'Run this on the new machine',
              body: `<div class="copy-box"><span class="code grow">${esc(res.node.installCommand)}</span><button class="btn sm primary" data-copy="${esc(res.node.installCommand)}">Copy</button></div>
                <div class="tiny dim mt">It installs Node.js + Java, drops the agent and opens port ${res.node.port}. The node shows up here within 30 seconds.</div>`,
            });
            load();
          } catch (err) { UI.toast(err.message, 'error'); }
        };
      },
    });
  }

  await load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
})();
