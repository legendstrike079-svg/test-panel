/* API keys page: create, inspect and revoke the keys that drive the HTTP API. */
(async function () {
  const root = document.getElementById('keysContent');
  try { await bootstrap({ active: 'apikeys.html' }); }
  catch (err) {
    // Do not leave the API screen blank when a session has expired or the
    // panel cannot be reached — the exact problem must remain visible.
    root.innerHTML = `<div class="card"><div class="banner-note red">${ICONS.warn}<div><b>API Keys could not be opened</b><div class="tiny mt">${esc(err && err.message ? err.message : String(err))}</div><a class="btn sm mt" href="index.html">Sign in again</a></div></div></div>`;
    return;
  }

  const copyText = async (value) => {
    const text = String(value || '');
    if (!text) throw new Error('Nothing to copy');
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    // GitHub's embedded/mobile browser can deny Clipboard API access. The
    // fallback keeps Copy controls working rather than failing silently.
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(area); area.select();
    const copied = document.execCommand && document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('Clipboard access was denied. Select and copy the value manually.');
  };
  const bindCopy = (scope) => scope.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    try { await copyText(b.dataset.copy); UI.toast('Copied', 'success'); }
    catch (err) { UI.toast(err.message || 'Could not copy', 'error'); }
  });

  Layout.title('API keys', 'drive the panel from scripts, bots and CI');
  Layout.actions(`<button class="btn sm primary" id="newKey">${ICONS.plus} Create key</button>
    <button class="btn sm" id="refreshKeys">${ICONS.refresh} Refresh</button>`);
  document.getElementById('refreshKeys').onclick = () => load(true);
  document.getElementById('newKey').onclick = openNew;

  const SCOPES = [
    ['read', 'Read only', 'GET endpoints: servers, stats, logs, files list'],
    ['console', 'Console', 'Send commands, start/stop/restart'],
    ['files', 'Files', 'Upload, edit, delete files'],
    ['admin', 'Admin', 'Nodes, users, settings (admins only)'],
  ];

  async function load(toast) {
    let data;
    try { data = await API.get('/keys'); }
    catch (err) { root.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>${esc(err.message)}</div></div>`; return; }
    const keys = data.apiKeys || [];
    root.innerHTML = `
      <div class="stack api-keys-page">
        <div class="card">
          <div class="row between">
            <div>
              <h3 style="margin:0">Your keys (${keys.length})</h3>
              <div class="tiny dim">Send one as <span class="mono">X-API-Key: zen_...</span> or <span class="mono">?apikey=zen_...</span>.
                Keys are stored hashed - the full value is shown only once, right after creation.</div>
            </div>
          </div>
          <div class="mt">
            ${keys.length ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Name</th><th>Prefix</th><th>Owner</th><th>Created</th><th>Last used</th><th style="text-align:right">Actions</th></tr></thead>
              <tbody>${keys.map((k) => `<tr>
                <td data-label="Name" style="font-weight:600">${esc(k.name)}${k.revoked ? ' <span class="badge red">revoked</span>' : ''}</td>
                <td data-label="Prefix" class="mono tiny">${esc(k.prefix)}…</td>
                <td data-label="Owner" class="tiny">${esc(k.username || store.user.username)}</td>
                <td data-label="Created" class="tiny dim">${fmt.date(k.createdAt)}</td>
                <td data-label="Last used" class="tiny dim">${k.lastUsedAt ? fmt.timeAgo(k.lastUsedAt) : 'never'}</td>
                <td data-label="Actions" style="text-align:right">${k.revoked ? '<span class="tiny dim">revoked</span>' : `<button class="btn sm ghost" data-revoke="${esc(k.id)}">revoke</button>`}</td>
              </tr>`).join('')}</tbody></table></div>`
              : UI.empty('No API keys yet', 'Create one to script the panel: backups, restarts, stats, file syncs.')}
          </div>
        </div>

        <div class="grid cols-2" style="gap:14px">
          <div class="card">
            <h3 style="margin:0">Quick start</h3>
            <div class="col" style="gap:10px;margin-top:10px">
              <div><div class="tiny dim">List your servers</div>
                <div class="copy-box"><span class="code grow">curl -H "X-API-Key: $ZENITH_KEY" ${location.origin}/api/servers</span>
                  <button class="btn sm" data-copy='curl -H "X-API-Key: $ZENITH_KEY" ${location.origin}/api/servers'>Copy</button></div></div>
              <div><div class="tiny dim">Send a console command</div>
                <div class="copy-box"><span class="code grow">curl -X POST -H "X-API-Key: $ZENITH_KEY" -H "Content-Type: application/json" -d '{"command":"say hi"}' ${location.origin}/api/servers/&lt;id&gt;/command</span>
                  <button class="btn sm" data-copy='curl -X POST -H "X-API-Key: $ZENITH_KEY" -H "Content-Type: application/json" -d "{\"command\":\"say hi\"}" ${location.origin}/api/servers/<id>/command'>Copy</button></div></div>
              <div><div class="tiny dim">Start a server</div>
                <div class="copy-box"><span class="code grow">curl -X POST -H "X-API-Key: $ZENITH_KEY" ${location.origin}/api/servers/&lt;id&gt;/start</span>
                  <button class="btn sm" data-copy="curl -X POST -H \"X-API-Key: \$ZENITH_KEY\" ${location.origin}/api/servers/<id>/start">Copy</button></div></div>
              <div class="tiny dim">The same server id works with SFTP (<span class="mono">sftp -P 2022 ${esc(store.user.username)}.&lt;id&gt;@host</span>) using an API key as the password.</div>
            </div>
          </div>
          <div class="card">
            <h3 style="margin:0">Security notes</h3>
            <div class="muted tiny" style="line-height:1.8;margin-top:8px">
              * A key inherits the permissions of the account that created it - a key made by a user with access to two servers
              can only reach those two.<br>
              * Revoking takes effect immediately: the key is marked and every request with it returns 401.<br>
              * Keys are never written to logs, and the hashed form is what the panel stores.<br>
              * Prefer one key per integration so you can revoke a single one without breaking the others.
            </div>
          </div>
        </div>
      </div>`;
    bindCopy(root);
    root.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm('Revoke this key? Anything using it stops working immediately.', { confirmText: 'Revoke key' }))) return;
      try { await API.del(`/keys/${b.dataset.revoke}`); UI.toast('Key revoked', 'success'); load(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    if (toast) UI.toast('Keys refreshed', 'success');
  }

  function openNew() {
    UI.modal({
      title: 'Create an API key',
      body: `<div class="col" style="gap:12px">
        <label class="field">Name <input id="keyName" placeholder="grafana-bot / deploy-script"></label>
        <div>
          <div class="label tiny dim" style="margin-bottom:6px">What it is for</div>
          <div class="kv">${SCOPES.map(([id, label, hint]) => `<dt class="mono">${id}</dt><dd>${esc(label)} - ${esc(hint)}</dd>`).join('')}</div>
          <div class="tiny dim mt">Keys always carry the permissions of your own account; the list above is a reminder of what the API exposes.</div>
        </div>
      </div>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doKey">Create key</button>`,
      onMount(m, { close }) {
        m.querySelector('#doKey').onclick = async () => {
          try {
            const res = await API.post('/keys', { name: m.querySelector('#keyName').value || 'API key' });
            const raw = (res.apiKey && res.apiKey.token) || res.token || '';
            if (!raw || !/^zen_/.test(raw)) throw new Error('The panel did not return a usable API key. No key value has been shown.');
            close();
            UI.modal({
              title: 'Copy your key now',
              body: `<div class="banner-note yellow">${ICONS.warn}<div>This is the only time the full key is shown - it is stored hashed.</div></div>
                <div class="copy-box mt"><span class="code grow">${esc(raw)}</span>
                  <button class="btn sm primary" data-copy="${esc(raw)}">Copy</button></div>
                <div class="tiny dim mt">Prefix <span class="mono">${esc((res.apiKey && res.apiKey.prefix) || '')}</span> - you can identify it in the list later by this.</div>`,
              onMount(mm) { bindCopy(mm); },
            });
            load();
          } catch (err) { UI.toast(err.message, 'error'); }
        };
      },
    });
  }

  await load();
})();
