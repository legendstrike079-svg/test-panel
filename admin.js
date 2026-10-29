/* Administration: users, all servers, panel settings, java, activity */
(async function () {
  const body = document.getElementById('adminBody');
  try { await bootstrap({ active: 'admin.html' }); } catch (_) { return; }
  if (!['admin', 'owner'].includes(store.user.role)) {
    Layout.title('Administration', 'restricted');
    body.innerHTML = `<div class="banner-note red">${ICONS.warn}<div>You need administrator rights to view this page.</div></div>`;
    return;
  }
  Layout.title('Administration', 'users, settings and audit log');

  function openTab(name, { updateHash = true } = {}) {
    const btn = document.querySelector(`[data-atab="${name}"]`) || document.querySelector('[data-atab="users"]');
    document.querySelectorAll('[data-atab]').forEach((x) => x.classList.toggle('active', x === btn));
    if (updateHash) history.replaceState(null, '', `#${btn.dataset.atab}`);
    PAGE[btn.dataset.atab]();
  }
  document.querySelectorAll('[data-atab]').forEach((b) => b.onclick = () => openTab(b.dataset.atab));
  const hash = (location.hash || '').slice(1);

  /* ------------------------------- users ------------------------------- */
  const PAGE = {};
  PAGE.users = async function () {
    body.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    const data = await API.get('/users');
    Layout.actions(`<button class="btn sm primary" id="newUser">${ICONS.plus} New user</button>`);
    document.getElementById('newUser').onclick = () => userModal();
    body.innerHTML = `
      <div class="card flush">
        <div class="card-head"><div><h3>Panel users</h3><div class="tiny dim">${data.users.length} account(s) · roles: owner &gt; admin &gt; user</div></div></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>User</th><th>Role</th><th>Servers</th><th>Subuser of</th><th>Last login</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${data.users.map((u) => `<tr>
            <td><div class="row" style="gap:9px"><div class="avatar">${esc(u.username[0].toUpperCase())}</div>
              <div><div style="font-weight:600">${esc(u.username)}${u.suspended ? ' <span class="badge red">suspended</span>' : ''}</div>
              <div class="tiny dim">${esc(u.email || 'no e-mail')}</div></div></div></td>
            <td><span class="badge ${u.role === 'owner' ? 'violet' : u.role === 'admin' ? 'blue' : ''}">${esc(u.role)}</span></td>
            <td class="mono tiny">${u.servers || 0}${u.maxServers ? ` <span class="dim">/ ${u.maxServers}</span>` : ''}</td>
            <td class="mono">${u.subOf}</td>
            <td class="tiny dim">${u.lastLoginAt ? fmt.timeAgo(u.lastLoginAt) : 'never'}</td>
            <td class="tiny dim">${fmt.date(u.createdAt).split(',')[0]}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn sm ghost" data-edit-user="${esc(u.id)}">edit</button>
              <button class="btn sm ghost" data-reset-pass="${esc(u.id)}">password</button>
              ${u.role === 'owner' || u.id === store.user.id ? '' : `<button class="btn sm ghost" data-del-user="${esc(u.id)}">${ICONS.trash}</button>`}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card mt">
        <h3>Permissions model</h3>
        <div class="muted" style="font-size:13px;line-height:1.8">
          <b>owner</b> - everything, including creating other admins/owners and exporting panel config.<br>
          <b>admin</b> - manages every server, user and panel setting.<br>
          <b>user</b> - sees only servers they own or were invited to as a subuser; per-server permissions are set in the server's <span class="mono">People</span> tab.
        </div>
      </div>`;

    body.querySelectorAll('[data-edit-user]').forEach((b) => b.onclick = () => {
      const u = data.users.find((x) => x.id === b.dataset.editUser);
      userModal(u);
    });
    body.querySelectorAll('[data-reset-pass]').forEach((b) => b.onclick = async () => {
      const u = data.users.find((x) => x.id === b.dataset.resetPass);
      const pass = prompt(`New password for ${u.username} (min 8 chars):`);
      if (!pass) return;
      try { await API.patch(`/users/${u.id}`, { password: pass }); UI.toast(`Password changed for ${u.username}`, 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    body.querySelectorAll('[data-del-user]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm('Delete this user? Their servers are not deleted automatically.', { confirmText: 'Delete user' }))) return;
      try { await API.del(`/users/${b.dataset.delUser}`); UI.toast('User deleted', 'success'); PAGE.users(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });

    function userModal(user) {
      const editing = !!user;
      UI.modal({
        title: editing ? `Edit ${user.username}` : 'Create user',
        body: `<div class="col" style="gap:12px">
            <label class="field">Username <input id="uName" value="${editing ? esc(user.username) : ''}" ${editing && user.role === 'owner' ? 'disabled' : ''}></label>
            <label class="field">E-mail <input id="uEmail" value="${editing ? esc(user.email || '') : ''}"></label>
            <div class="field-row">
              <label class="field">Role <select id="uRole">
                ${['user', 'admin', 'owner'].map((r) => `<option ${editing && user.role === r ? 'selected' : ''} ${r === 'owner' && store.user.role !== 'owner' ? 'disabled' : ''}>${r}</option>`).join('')}
              </select></label>
              <label class="field">${editing ? 'New password (blank = unchanged)' : 'Password'} <input type="password" id="uPass" placeholder="••••••••"></label>
              <label class="field">Server limit <input type="number" id="uMax" min="0" value="${editing ? (user.maxServers || 0) : 0}" placeholder="0 = default"></label>
            </div>
            <div class="hint tiny dim">Server limit 0 uses the panel-wide default from Settings.</div>
            ${editing ? `<label class="checkbox"><input type="checkbox" id="uSuspended" ${user.suspended ? 'checked' : ''}> <span>Suspend this account (blocks login)</span></label>` : ''}
          </div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveUser">${editing ? 'Save changes' : 'Create user'}</button>`,
        onMount(m, { close }) {
          m.querySelector('#saveUser').onclick = async () => {
            const payload = {
              username: m.querySelector('#uName').value,
              email: m.querySelector('#uEmail').value,
              role: m.querySelector('#uRole').value,
              maxServers: parseInt(m.querySelector('#uMax').value || '0', 10) || 0,
            };
            const pass = m.querySelector('#uPass').value;
            if (pass) payload.password = pass;
            if (editing) payload.suspended = m.querySelector('#uSuspended').checked;
            try {
              if (editing) await API.patch(`/users/${user.id}`, payload);
              else await API.post('/users', payload);
              UI.toast(editing ? 'User updated' : 'User created', 'success');
              close(); PAGE.users();
            } catch (err) { UI.toast(err.message, 'error'); }
          };
        },
      });
    }
  };

  /* ------------------------------- servers ------------------------------- */
  PAGE.servers = async function () {
    body.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    const data = await API.get('/servers?withUsage=disk');
    Layout.actions(`<a class="btn sm primary" href="servers.html?create=1">${ICONS.plus} New server</a>`);
    body.innerHTML = `
      <div class="grid cols-4">
        <div class="card stat"><span class="label">Total servers</span><div class="value">${data.total}</div></div>
        <div class="card stat"><span class="label">Running</span><div class="value" style="color:var(--green)">${data.running}</div></div>
        <div class="card stat"><span class="label">Total players</span><div class="value">${data.servers.reduce((a, s) => a + (s.players || 0), 0)}</div></div>
        <div class="card stat"><span class="label">Allocated RAM</span><div class="value">${fmt.bytes(data.servers.reduce((a, s) => a + (s.memory || 0), 0) * 1048576)}</div></div>
      </div>
      <div class="card flush mt-lg">
        <div class="card-head"><h3>Every server on this panel</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Server</th><th>Owner</th><th>Status</th><th>CPU</th><th>RAM</th><th>Disk</th><th>Port</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${data.servers.map((s) => `<tr>
            <td><a href="server.html?id=${s.id}" style="font-weight:600">${esc(s.name)}</a>
              <div class="tiny dim mono">${esc(s.serverType)} ${esc(s.version || '')} · ${esc(s.nodeName || '')}</div></td>
            <td class="tiny">${esc(s.ownerName || '')}</td>
            <td>${statusBadge(s.status)}</td>
            <td class="mono tiny">${(s.stats && s.stats.cpu || 0).toFixed(1)}%</td>
            <td class="mono tiny">${(s.stats && s.stats.memoryBytes) ? fmt.bytes(s.stats.memoryBytes) : '-'}</td>
            <td class="mono tiny">${s.disk ? s.disk.pretty : '-'}</td>
            <td class="mono tiny">${s.port}</td>
            <td style="text-align:right;white-space:nowrap">
              ${s.status === 'running'
                ? `<button class="btn sm ghost" data-power="stop" data-id="${s.id}">stop</button>`
                : `<button class="btn sm ghost" data-power="start" data-id="${s.id}">start</button>`}
              <button class="btn sm ghost" data-suspend="${s.id}" data-state="${s.suspended}">${s.suspended ? 'unsuspend' : 'suspend'}</button>
              <button class="btn sm ghost" data-del-server="${esc(s.id)}" data-name="${esc(s.name)}">${ICONS.trash}</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    body.querySelectorAll('[data-power]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await API.post(`/servers/${b.dataset.id}/${b.dataset.power}`); UI.toast('Command sent', 'success'); setTimeout(PAGE.servers, 1500); }
      catch (err) { UI.toast(err.message, 'error'); b.disabled = false; }
    });
    body.querySelectorAll('[data-suspend]').forEach((b) => b.onclick = async () => {
      try {
        await API.post(`/servers/${b.dataset.suspend}/suspend`, { suspended: b.dataset.state !== 'true' });
        UI.toast('Updated', 'success'); PAGE.servers();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    body.querySelectorAll('[data-del-server]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm(`Delete ${b.dataset.name} with all files and backups?`, { confirmText: 'Delete forever' }))) return;
      try { await API.del(`/servers/${b.dataset.delServer}`); UI.toast('Server deleted', 'success'); PAGE.servers(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
  };

  /* ------------------------------- settings ------------------------------- */
  PAGE.settings = async function () {
    body.innerHTML = `<div class="skeleton" style="height:340px"></div>`;
    const [{ settings }, config] = await Promise.all([API.get('/settings'), API.get('/system/config')]);
    Layout.actions('');

    const themes = [
      { id: 'midnight', name: 'Midnight', note: 'Blue-black control room' },
      { id: 'obsidian', name: 'Obsidian', note: 'Deep, high-contrast black' },
      { id: 'graphite', name: 'Graphite', note: 'Neutral professional grey' },
      { id: 'ocean', name: 'Ocean', note: 'Cool navy workspace' },
    ];
    let selectedTheme = themes.some((t) => t.id === settings.theme) ? settings.theme : 'midnight';
    let pendingLogo = settings.panelLogo || '';
    let pendingBackground = settings.panelBackground || '';
    const normalOpacity = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 28;
    };
    const logo = () => {
      const source = window.panelLogoSource ? window.panelLogoSource(pendingLogo) : (pendingLogo || 'assets/zenith-panel-logo.webp');
      return `<img src="${esc(source)}" alt="Panel logo">`;
    };

    body.innerHTML = `
      <div class="settings-page">
        <section class="card brand-studio-card">
          <div class="settings-section-head">
            <div><span class="eyebrow">Appearance</span><h2>Brand studio</h2><p>Set the panel identity your users see on every page. Changes are previewed here before you save.</p></div>
            <span class="badge blue">Live preview</span>
          </div>
          <div class="brand-studio-layout">
            <div class="brand-preview" id="brandPreview">
              <div class="brand-preview-orb"></div>
              <div class="brand-preview-nav"><div class="brand-preview-mark" id="brandPreviewLogo">${logo()}</div><div><b id="brandPreviewName">${esc(settings.panelName || 'Zenith Panel')}</b><small>SERVER CONTROL</small></div></div>
              <div class="brand-preview-line"></div>
              <div class="brand-preview-content"><span></span><span></span><span></span></div>
            </div>
            <div class="brand-form-stack">
              <label class="field">Panel name <input id="setPanelName" maxlength="64" value="${esc(settings.panelName || '')}" placeholder="Your hosting panel"></label>
              <div class="logo-field">
                <div class="logo-field-copy"><span class="label tiny dim">Panel logo</span><span class="tiny dim">Square PNG, JPEG or WebP. Stored locally in panel settings.</span></div>
                <div class="row wrap" style="gap:8px"><button class="btn sm" id="choosePanelLogo">${ICONS.upload} Upload logo</button><button class="btn sm ghost" id="resetPanelLogo" ${pendingLogo ? '' : 'disabled'}>Reset</button></div>
              </div>
              <div class="background-field">
                <div class="background-field-copy"><span class="label tiny dim">Panel background</span><span class="tiny dim">PNG, JPEG or WebP. Optimised locally and used behind every panel page.</span></div>
                <div class="background-controls"><div class="row wrap" style="gap:8px"><button class="btn sm" id="choosePanelBackground">${ICONS.upload} Upload background</button><button class="btn sm ghost" id="resetPanelBackground" ${pendingBackground ? '' : 'disabled'}>Remove</button></div><label class="background-opacity">Opacity <input type="range" id="setBackgroundOpacity" min="0" max="100" step="1" value="${normalOpacity(settings.panelBackgroundOpacity)}"><output id="backgroundOpacityValue">${normalOpacity(settings.panelBackgroundOpacity)}%</output></label></div>
              </div>
              <label class="field accent-field">Accent colour <span class="accent-inputs"><input type="color" id="setAccent" value="${esc(/^#[0-9a-f]{6}$/i.test(settings.accentColor || '') ? settings.accentColor : '#3b82f6')}"><output id="accentValue">${esc(/^#[0-9a-f]{6}$/i.test(settings.accentColor || '') ? settings.accentColor : '#3b82f6')}</output></span></label>
            </div>
          </div>
          <div class="theme-picker" id="themePicker">
            ${themes.map((theme) => `<button class="theme-choice ${theme.id === selectedTheme ? 'active' : ''}" type="button" data-theme-choice="${theme.id}" aria-pressed="${theme.id === selectedTheme}">
              <span class="theme-swatch ${theme.id}"><i></i><i></i><i></i></span><span><b>${theme.name}</b><small>${theme.note}</small></span><span class="theme-check">${ICONS.check}</span>
            </button>`).join('')}
          </div>
        </section>

        <div class="settings-grid">
          <section class="card settings-card">
            <div class="settings-section-head compact"><div><span class="eyebrow">Access</span><h3>Account policy</h3></div></div>
            <div class="setting-rows">
              <label class="setting-row"><span><b>Public registration</b><small>Keep this off to ensure only accounts you create in Users can sign in.</small></span><span class="switch"><input type="checkbox" id="setRegistration" ${settings.allowRegistration ? 'checked' : ''}><i class="track"></i></span></label>
              <label class="setting-row"><span><b>Automatic Java</b><small>Download a matching Temurin runtime only when a server needs it.</small></span><span class="switch"><input type="checkbox" id="setJavaAuto" ${settings.installJavaAutomatically ? 'checked' : ''}><i class="track"></i></span></label>
              <label class="setting-row"><span><b>Crash recovery</b><small>Restart a server after an unexpected runtime exit.</small></span><span class="switch"><input type="checkbox" id="setAutoRestart" ${settings.autoRestartOnCrash ? 'checked' : ''}><i class="track"></i></span></label>
            </div>
          </section>

          <section class="card settings-card wide identity-provider-card">
            <div class="settings-section-head compact"><div><span class="eyebrow">Identity</span><h3>Google &amp; Discord sign-in</h3><p>Enable real provider authentication only after adding your own Firebase or Discord app credentials.</p></div><span class="badge ${settings.firebaseGoogleEnabled || settings.discordOAuthEnabled ? 'green' : 'dim'}">${settings.firebaseGoogleEnabled || settings.discordOAuthEnabled ? 'Configured' : 'Optional'}</span></div>
            <div class="identity-provider-grid">
              <article class="identity-provider">
                <div class="identity-provider-head"><span class="identity-provider-icon google">G</span><div><b>Google via Firebase</b><small>Firebase verifies the Google account; Zenith verifies its signed ID token again on the server.</small></div><label class="switch" aria-label="Enable Google sign-in via Firebase" title="Enable Google sign-in via Firebase"><input type="checkbox" id="setFirebaseGoogle" ${settings.firebaseGoogleEnabled ? 'checked' : ''}><i class="track"></i></label></div>
                <div class="identity-provider-fields">
                  <label class="field">Web API key <input id="setFirebaseApiKey" value="${esc(settings.firebaseApiKey || '')}" placeholder="AIza…"></label>
                  <label class="field">Project ID <input id="setFirebaseProjectId" value="${esc(settings.firebaseProjectId || '')}" placeholder="my-hosting-panel"></label>
                  <label class="field">Auth domain <input id="setFirebaseAuthDomain" value="${esc(settings.firebaseAuthDomain || '')}" placeholder="my-hosting-panel.firebaseapp.com"></label>
                  <label class="field">App ID <input id="setFirebaseAppId" value="${esc(settings.firebaseAppId || '')}" placeholder="1:123:web:abc…"></label>
                </div>
                <p class="identity-provider-guide">Firebase: enable the Google provider in Authentication, then add this panel’s public domain to Authorized domains.</p>
              </article>
              <article class="identity-provider">
                <div class="identity-provider-head"><span class="identity-provider-icon discord">◉</span><div><b>Discord OAuth2</b><small>The OAuth client secret stays server-side and is never sent back to the browser.</small></div><label class="switch" aria-label="Enable Discord OAuth sign-in" title="Enable Discord OAuth sign-in"><input type="checkbox" id="setDiscordOAuth" ${settings.discordOAuthEnabled ? 'checked' : ''}><i class="track"></i></label></div>
                <div class="identity-provider-fields">
                  <label class="field">Client ID <input id="setDiscordOAuthClientId" value="${esc(settings.discordOAuthClientId || '')}" inputmode="numeric" placeholder="Discord application client ID"></label>
                  <label class="field">Client secret <span class="identity-secret-field"><input id="setDiscordOAuthClientSecret" type="password" autocomplete="new-password" placeholder="${settings.discordOAuthClientSecretSet ? 'Saved — leave blank to keep it' : 'Discord application client secret'}"><button type="button" class="btn sm ghost" id="clearDiscordOAuthSecret" ${settings.discordOAuthClientSecretSet ? '' : 'disabled'}>Clear</button></span></label>
                </div>
                <p class="identity-provider-guide">Discord: create an OAuth2 application and add the callback URL shown below under Redirects.</p>
              </article>
            </div>
            <div class="identity-provider-foot">
              <label class="setting-row"><span><b>Allow provider sign-up</b><small>When off, Google and Discord can sign in only to an existing account with the same verified e-mail. When on, a new ordinary user account is created from the verified identity.</small></span><span class="switch"><input type="checkbox" id="setOAuthRegistration" ${settings.oauthAllowRegistration ? 'checked' : ''}><i class="track"></i></span></label>
              <div class="identity-callback"><label class="field identity-url-field">Public panel URL <input id="setPanelUrl" type="url" autocomplete="url" value="${esc(config.panelUrl || '')}" placeholder="https://your-panel.example"><small>Use your public HTTPS origin, not localhost. It controls the Discord callback shown below.</small></label><b>Discord callback URL</b><code>${esc(config.panelUrl)}/api/auth/discord/callback</code><button type="button" class="btn primary sm" id="saveIdentityProviders">${ICONS.save} Save sign-in settings</button><small id="providerSaveHint">Save after toggling a provider. Invalid or incomplete settings show a specific fix.</small></div>
            </div>
          </section>

          <section class="card settings-card">
            <div class="settings-section-head compact"><div><span class="eyebrow">Defaults</span><h3>New server policy</h3></div></div>
            <div class="field-row">
              <label class="field">Runtime<select id="setRuntime"><option value="process" ${settings.dockerBackend === 'docker' ? '' : 'selected'}>Java process</option><option value="docker" ${settings.dockerBackend === 'docker' ? 'selected' : ''}>Docker container</option></select></label>
              <label class="field">Default memory <input type="number" id="setMemory" min="256" value="${settings.defaultMemory}"><span class="hint">MB per new server</span></label>
              <label class="field">Server limit <input type="number" id="setMaxServers" min="0" value="${settings.maxServersPerUser}"><span class="hint">0 = no default cap</span></label>
              <label class="field">Container image <input id="setImage" value="${esc(settings.dockerImage || 'eclipse-temurin:21-jre')}"></label>
            </div>
          </section>

          <section class="card settings-card wide">
            <div class="settings-section-head compact"><div><span class="eyebrow">File access</span><h3>SFTP service</h3><p>Real SFTP access remains separate from the browser preview port.</p></div><span class="tiny dim" id="sftpState">Checking service…</span></div>
            <div class="sftp-settings-row">
              <label class="setting-row"><span><b>Enable SFTP</b><small>Users access only the files for servers they are allowed to manage.</small></span><span class="switch"><input type="checkbox" id="setSftp" ${settings.sftpEnabled === false ? '' : 'checked'}><i class="track"></i></span></label>
              <label class="field sftp-port">Port <input type="number" id="setSftpPort" min="1" max="65535" value="${settings.sftpPort || 2023}"></label>
              <button class="btn" id="sftpRestart">${ICONS.refresh} Restart SFTP</button>
            </div>
          </section>
        </div>

        <section class="settings-savebar">
          <div><b>Ready to publish?</b><span>Your visual identity and operational defaults save together.</span></div>
          <button class="btn primary" id="saveSettings">${ICONS.save} Save changes</button>
        </section>

        <div class="grid cols-2 mt">
          <div class="card compact-info-card"><h3>Panel runtime</h3><dl class="kv"><dt>Panel URL</dt><dd>${esc(config.panelUrl)}</dd><dt>Data directory</dt><dd>${esc(config.dataDir)}</dd><dt>Upload limit</dt><dd>${esc(config.maxUploadPretty)}</dd><dt>Version</dt><dd>v${esc(config.version)}</dd></dl></div>
          <div class="card compact-info-card"><h3>Maintenance</h3><div class="col" style="gap:10px"><button class="btn" id="exportConfig">${ICONS.download} Export panel configuration</button><div class="tiny dim">Use your service manager to restart the panel after environment-level changes. Theme and branding updates apply without a restart.</div></div></div>
        </div>
      </div>`;

    const accent = body.querySelector('#setAccent');
    const backgroundOpacity = body.querySelector('#setBackgroundOpacity');
    const setPreviewBackground = () => {
      const image = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(pendingBackground) ? pendingBackground : '';
      const previewCard = body.querySelector('#brandPreview');
      previewCard.style.setProperty('--brand-bg-image', image ? `url("${image}")` : 'none');
      previewCard.style.setProperty('--brand-bg-opacity', String(normalOpacity(backgroundOpacity.value) / 100));
    };
    const preview = () => {
      const name = body.querySelector('#setPanelName').value.trim() || 'Zenith Panel';
      body.querySelector('#brandPreviewName').textContent = name;
      body.querySelector('#brandPreviewLogo').innerHTML = logo();
      body.querySelector('#accentValue').textContent = accent.value;
      body.querySelector('#backgroundOpacityValue').textContent = `${normalOpacity(backgroundOpacity.value)}%`;
      setPreviewBackground();
      body.querySelectorAll('[data-theme-choice]').forEach((el) => {
        const active = el.dataset.themeChoice === selectedTheme;
        el.classList.toggle('active', active);
        el.setAttribute('aria-pressed', String(active));
      });
      // Preview at the same token level the saved panel will use, including
      // the full-page background visible outside this settings card.
      if (window.applyAppearance) window.applyAppearance({
        theme: selectedTheme, accentColor: accent.value,
        panelBackground: pendingBackground, panelBackgroundOpacity: backgroundOpacity.value,
      });
    };
    const readFile = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The selected background could not be read'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const loadImage = (source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The selected file is not a readable image'));
      image.src = source;
    });
    async function optimiseBackground(file) {
      if (!file) throw new Error('Choose an image file first');
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Panel background must be a PNG, JPEG or WebP image');
      if (file.size > 8 * 1024 * 1024) throw new Error('Panel background must be 8 MB or smaller before optimisation');
      const image = await loadImage(await readFile(file));
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('The selected image has no usable dimensions');
      let scale = Math.min(1, 1920 / image.naturalWidth, 1080 / image.naturalHeight);
      for (let pass = 0; pass < 7; pass += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const compact = canvas.toDataURL('image/jpeg', Math.max(.54, .84 - pass * .045));
        if (compact.length <= 1300000) return compact;
        scale *= .80;
      }
      throw new Error('The image remains too large after optimisation; choose a smaller or simpler background');
    }
    function chooseBackground() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async () => {
        try {
          pendingBackground = await optimiseBackground(input.files && input.files[0]);
          body.querySelector('#resetPanelBackground').disabled = false;
          preview();
          UI.toast('Background optimised locally; save changes to publish it', 'success');
        } catch (err) { UI.toast(err.message, 'error'); }
      };
      input.click();
    }
    let clearDiscordOAuthSecret = false;
    const clearDiscordSecret = body.querySelector('#clearDiscordOAuthSecret');
    if (clearDiscordSecret) clearDiscordSecret.onclick = () => {
      clearDiscordOAuthSecret = true;
      body.querySelector('#setDiscordOAuthClientSecret').value = '';
      clearDiscordSecret.disabled = true;
      UI.toast('Discord OAuth secret will be removed when you save', 'warn');
    };
    body.querySelectorAll('[data-theme-choice]').forEach((button) => button.onclick = () => { selectedTheme = button.dataset.themeChoice; preview(); });
    body.querySelector('#setPanelName').addEventListener('input', preview);
    accent.addEventListener('input', preview);
    backgroundOpacity.addEventListener('input', preview);
    body.querySelector('#choosePanelLogo').onclick = () => {
      Cropper.open({ size: 160, title: 'Crop panel logo', onDone(dataUrl) {
        pendingLogo = dataUrl;
        body.querySelector('#resetPanelLogo').disabled = false;
        preview();
      } });
    };
    body.querySelector('#resetPanelLogo').onclick = () => { pendingLogo = ''; body.querySelector('#resetPanelLogo').disabled = true; preview(); };
    body.querySelector('#choosePanelBackground').onclick = chooseBackground;
    body.querySelector('#resetPanelBackground').onclick = () => { pendingBackground = ''; body.querySelector('#resetPanelBackground').disabled = true; preview(); };
    preview();

    (async () => {
      const el = body.querySelector('#sftpState');
      try {
        const st = await API.get('/system/sftp');
        el.innerHTML = st.running
          ? `<span class="badge green"><i class="dot green"></i>Listening on ${st.port}</span>`
          : `<span class="badge red"><i class="dot red"></i>${esc(st.reason || 'Stopped')}</span>`;
      } catch (err) { el.textContent = err.message; }
    })();
    body.querySelector('#sftpRestart').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const st = await API.post('/system/sftp/restart');
        UI.toast(st.running ? `SFTP restarted on port ${st.port}` : `SFTP did not start: ${st.error || st.reason}`, st.running ? 'success' : 'error');
        PAGE.settings();
      } catch (err) { UI.toast(err.message, 'error'); }
      btn.disabled = false;
    };
    const saveIdentityProviders = body.querySelector('#saveIdentityProviders');
    if (saveIdentityProviders) saveIdentityProviders.onclick = () => body.querySelector('#saveSettings').click();
    for (const toggle of body.querySelectorAll('#setFirebaseGoogle, #setDiscordOAuth')) {
      toggle.addEventListener('change', () => {
        const hint = body.querySelector('#providerSaveHint');
        if (hint) hint.textContent = 'Change pending — select Save sign-in settings to activate this provider.';
      });
    }
    body.querySelector('#saveSettings').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const payload = {
          panelName: body.querySelector('#setPanelName').value,
          panelUrl: body.querySelector('#setPanelUrl').value.trim(),
          panelLogo: pendingLogo,
          panelBackground: pendingBackground,
          panelBackgroundOpacity: normalOpacity(backgroundOpacity.value),
          theme: selectedTheme,
          accentColor: accent.value,
          allowRegistration: body.querySelector('#setRegistration').checked,
          oauthAllowRegistration: body.querySelector('#setOAuthRegistration').checked,
          firebaseGoogleEnabled: body.querySelector('#setFirebaseGoogle').checked,
          firebaseApiKey: body.querySelector('#setFirebaseApiKey').value.trim(),
          firebaseProjectId: body.querySelector('#setFirebaseProjectId').value.trim(),
          firebaseAuthDomain: body.querySelector('#setFirebaseAuthDomain').value.trim(),
          firebaseAppId: body.querySelector('#setFirebaseAppId').value.trim(),
          discordOAuthEnabled: body.querySelector('#setDiscordOAuth').checked,
          discordOAuthClientId: body.querySelector('#setDiscordOAuthClientId').value.trim(),
          installJavaAutomatically: body.querySelector('#setJavaAuto').checked,
          autoRestartOnCrash: body.querySelector('#setAutoRestart').checked,
          defaultMemory: parseInt(body.querySelector('#setMemory').value, 10),
          maxServersPerUser: parseInt(body.querySelector('#setMaxServers').value, 10),
          dockerBackend: body.querySelector('#setRuntime').value,
          dockerImage: body.querySelector('#setImage').value.trim(),
          sftpEnabled: body.querySelector('#setSftp').checked,
          sftpPort: parseInt(body.querySelector('#setSftpPort').value, 10) || 2023,
        };
        const discordOAuthSecret = body.querySelector('#setDiscordOAuthClientSecret').value.trim();
        if (discordOAuthSecret || clearDiscordOAuthSecret) payload.discordOAuthClientSecret = clearDiscordOAuthSecret ? '' : discordOAuthSecret;
        const result = await API.patch('/settings', payload);
        store.settings = { ...store.settings, ...result.settings };
        applyAppearance(store.settings);
        Layout.render('admin.html');
        UI.toast('Panel settings saved. Sign-in providers update immediately.', 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
      btn.disabled = false;
    };
    body.querySelector('#exportConfig').onclick = () => { window.location = `/api/settings/export?token=${store.token}`; };
  };

  /* ------------------------------- java ------------------------------- */
  PAGE.java = async function () {
    body.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    const data = await API.get('/system/java');
    Layout.actions('');
    body.innerHTML = `
      <div class="card flush">
        <div class="card-head"><div><h3>Detected Java runtimes</h3><div class="tiny dim">Managed runtimes live in ${esc(data.managedDir)}</div></div>
          <div class="row"><input type="number" id="jvInstall" value="21" style="width:90px"><button class="btn sm primary" id="doInstallJava">${ICONS.download} Install JRE</button></div>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Runtime</th><th>Version</th><th>Path</th><th>Source</th></tr></thead>
          <tbody>${data.available.map((j) => `<tr>
            <td style="font-weight:600">Java ${j.major || '?'}</td>
            <td class="tiny mono">${esc(j.raw || '')}</td>
            <td class="tiny mono dim">${esc(j.path)}</td>
            <td>${j.managed ? '<span class="badge violet">panel-managed</span>' : '<span class="badge">system</span>'}</td>
          </tr>`).join('') || `<tr><td colspan="4">${UI.empty('No Java found', 'Install one above - servers need Java to run.')}</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="card mt-lg">
        <div class="row between wrap" style="gap:10px">
          <div>
            <h3 style="margin:0">Disk usage</h3>
            <div class="tiny dim mt">${data.usage.entries.length
              ? `${fmt.bytes(data.usage.totalBytes)} of managed runtimes · ${fmt.bytes(data.usage.unusedBytes)} can be freed`
              : 'No panel-managed runtimes on disk - system Java is used.'}</div>
          </div>
          <div class="row" style="gap:8px">
            ${data.usage.unusedBytes > 0 ? `<button class="btn sm" id="pruneJava">${ICONS.trash} Free ${fmt.bytes(data.usage.unusedBytes)}</button>` : ''}
            ${data.usage.entries.length ? `<button class="btn sm ghost" id="pruneJavaAll" title="Remove every managed runtime - they re-download when needed">Remove all</button>` : ''}
          </div>
        </div>
        ${data.usage.entries.length ? `<div class="table-wrap mt"><table class="data">
          <thead><tr><th>Runtime</th><th>Disk</th><th>Used by</th><th></th></tr></thead>
          <tbody>${data.usage.entries.map((e) => `<tr>
            <td class="mono">jre-${e.major}</td>
            <td class="mono tiny">${fmt.bytes(e.bytes)}</td>
            <td class="tiny">${e.used ? `<span class="badge green">${e.servers || 1} server(s)</span>` : '<span class="badge">unused</span>'}</td>
            <td class="tiny dim mono truncate" style="max-width:340px">${esc(e.path)}</td>
          </tr>`).join('')}</tbody></table></div>` : ''}
        <div class="tiny dim mt">Keep runtimes outside the project folder with <span class="mono">JAVA_DIR=/var/lib/zenith/java</span> in <span class="mono">.env</span> - they are the biggest thing a panel stores (50-160 MB each).</div>
      </div>

      <div class="card mt-lg">
        <h3>Version mapping</h3>
        <div class="muted" style="font-size:13px;line-height:1.8">
          The panel picks a JRE per server automatically: 26.x &rarr; Java 25, 1.20.5+/1.21+ &rarr; Java 21,
          1.18 - 1.20.4 &rarr; Java 17, older &rarr; Java 8. Downloading a runtime here installs Temurin into
          <span class="mono">data/java/jre-&lt;major&gt;</span> so it is reused by every server that needs it.
        </div>
      </div>`;

    const prune = async (all) => {
      const label = all ? 'every managed runtime' : 'the runtimes no server uses';
      if (!(await UI.confirm(`Remove ${label}? Runtimes are re-downloaded when a server needs them.`, { confirmText: 'Remove', danger: true }))) return;
      try {
        const res = await API.post('/system/java/prune', { all });
        UI.toast(res.freed ? `Freed ${res.freedPretty}` : 'Nothing to remove', 'success');
        PAGE.java();
      } catch (err) { UI.toast(err.message, 'error'); }
    };
    const pruneBtn = body.querySelector('#pruneJava');
    if (pruneBtn) pruneBtn.onclick = () => prune(false);
    const pruneAll = body.querySelector('#pruneJavaAll');
    if (pruneAll) pruneAll.onclick = () => prune(true);

    body.querySelector('#doInstallJava').onclick = async (e) => {
      const btn = e.target.closest('button');
      btn.disabled = true; btn.innerHTML = `${UI.spinner(13)} Installing...`;
      try {
        await API.post('/system/java/install', { version: parseInt(body.querySelector('#jvInstall').value, 10) });
        UI.toast('Java install started - refresh in a minute', 'success');
        setTimeout(PAGE.java, 15000);
      } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = `${ICONS.download} Install JRE`; }
    };
  };

  /* ------------------------------- activity ------------------------------- */
  PAGE.activity = async function () {
    body.innerHTML = `<div class="skeleton" style="height:240px"></div>`;
    const data = await API.get('/system/activity?limit=150');
    Layout.actions(`<button class="btn sm" id="reloadActivity">${ICONS.refresh} Reload</button>`);
    document.getElementById('reloadActivity').onclick = PAGE.activity;
    body.innerHTML = `<div class="card flush">
        <div class="card-head"><h3>Audit log</h3><span class="badge">${data.activity.length} entries</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Server</th><th>Detail</th></tr></thead>
          <tbody>${data.activity.map((a) => `<tr>
            <td class="tiny dim mono">${fmt.date(a.at)}</td>
            <td class="tiny">${esc(a.actor || 'system')}</td>
            <td class="tiny"><span class="chip">${esc(a.action)}</span></td>
            <td class="tiny">${a.serverName ? esc(a.serverName) : '-'}</td>
            <td class="tiny dim">${esc(a.detail || '')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  };

  /* --------------------------- integrations --------------------------- */
  PAGE.integrations = async function () {
    body.innerHTML = `<div class="skeleton" style="height:260px"></div>`;
    Layout.actions('');
    const [{ settings }, dnsConfig, bot] = await Promise.all([
      API.get('/settings'),
      API.get('/system/dns'),
      API.get('/system/discord'),
    ]);
    const dns = dnsConfig.settings;

    body.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <div class="row between">
            <div><h3 style="margin:0">${ICONS.globe} Subdomains (DNS)</h3>
              <div class="tiny dim mt">Give each server a hostname like <span class="mono">survival.example.com</span>. With a Cloudflare token the panel creates the A + SRV records itself.</div></div>
            <span class="badge ${dnsConfig.configured ? 'green' : ''}">${dnsConfig.configured ? 'automatic' : 'manual'}</span>
          </div>
          <div class="col mt" style="gap:12px">
            <label class="field">Mode
              <select id="dnsProvider">
                <option value="manual" ${dns.provider !== 'cloudflare' ? 'selected' : ''}>Manual - the panel shows the records to copy</option>
                <option value="cloudflare" ${dns.provider === 'cloudflare' ? 'selected' : ''}>Cloudflare - create and delete records automatically</option>
              </select>
            </label>
            <label class="field">Base domain <input id="dnsDomain" value="${esc(dns.domain || '')}" placeholder="example.com"></label>
            <label class="field">Cloudflare API token <input id="dnsToken" type="password" placeholder="${dns.tokenSet ? 'saved - type to replace' : 'paste a token with Zone.DNS edit rights'}"></label>
            <div class="field-row">
              <label class="field">Node public IPv4 <input id="dnsIp" value="${esc(dns.ip || '')}" placeholder="203.0.113.10"></label>
              <label class="field">TTL <input id="dnsTtl" type="number" value="${dns.ttl || 300}" min="60"></label>
            </div>
            <div class="row wrap" style="gap:8px">
              <button class="btn primary" id="saveDns">${ICONS.save} Save DNS settings</button>
              <button class="btn" id="verifyDns">${ICONS.check} Test connection</button>
            </div>
            <div class="tiny dim">Tokens are stored in the panel data file and never sent back to the browser.
              Cloudflare tokens need <span class="mono">Zone → DNS → Edit</span> on the zone that holds your domain.</div>
          </div>
        </div>

        <div class="card">
          <div class="row between">
            <div><h3 style="margin:0">${ICONS.discord} Discord bot</h3>
              <div class="tiny dim mt">Manage the panel from your Discord server: create servers, start/stop them, run player actions.</div></div>
            <span class="badge ${bot.status === 'online' ? 'green' : bot.status === 'error' ? 'red' : ''}" id="botStatus">${esc(bot.status)}</span>
          </div>
          <div class="col mt" style="gap:12px">
            <label class="field">Bot token <input id="botToken" type="password" placeholder="${bot.tokenSet ? 'saved - type to replace' : 'from the Discord developer portal'}"></label>
            <div class="field-row">
              <label class="field">Server (guild) id <input id="botGuild" value="${esc(bot.guildId || '')}" placeholder="123456789012345678"></label>
              <label class="field">Command prefix <input id="botPrefix" value="${esc(bot.prefix || '!')}" maxlength="3"></label>
            </div>
            <div class="field-row">
              <label class="field">Admin role name <input id="botRole" value="${esc(bot.adminRole || '')}" placeholder="optional, e.g. owner"></label>
              <label class="field">Notify channel id <input id="botNotif" value="${esc(bot.notifChannelId || '')}" placeholder="server events are posted here"></label>
            </div>
            <div class="field-row">
              <label class="field">Default software <input id="botType" value="${esc(settings.discordDefaultType || 'PAPER')}"></label>
              <label class="field">Default memory (MB) <input id="botMemory" type="number" value="${settings.discordDefaultMemory || 2048}"></label>
            </div>
            <label class="checkbox"><input type="checkbox" id="botRegistration" ${settings.discordAllowRegistration !== false ? 'checked' : ''}> <span>Let a linked panel administrator using <span class="mono">!newserver</span> register a new owner account</span></label>
            <div class="row wrap" style="gap:8px">
              <button class="btn primary" id="saveBot">${ICONS.save} Save</button>
              <button class="btn green" id="startBot">${ICONS.play} Start</button>
              <button class="btn red" id="stopBot">${ICONS.stop} Stop</button>
              <button class="btn" id="testBot">${ICONS.discord} Test message</button>
            </div>
            <div class="tiny dim">In the Discord developer portal enable the <b>Message Content</b> intent, otherwise commands arrive empty.</div>
          </div>
        </div>
      </div>

      <div class="grid cols-2 mt-lg">
        <div class="card">
          <h3>Bot commands</h3>
          <div class="cmd-ref mt">${(bot.reference || []).map((c) => `<div><code>${esc(bot.prefix || '!')}${esc(c.name)}${c.usage ? ` ${esc(c.usage)}` : ''}</code>${c.adminOnly ? ' <span class="badge tiny blue">admin</span>' : ''}<div class="tiny dim">${esc(c.help)}</div></div>`).join('')}</div>
        </div>
        <div class="card">
          <div class="row between"><h3 style="margin:0">Bot log</h3><span class="tiny dim mono" id="botStats">${bot.commandsHandled || 0} commands handled</span></div>
          <div class="bot-log mt" id="botLog">${(bot.log || []).map((l) => `<div class="${l.level}">${new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${esc(l.line)}</div>`).join('') || '<div class="dim">No events yet.</div>'}</div>
        </div>
      </div>`;

    const dnsPayload = () => ({
      dnsProvider: body.querySelector('#dnsProvider').value,
      dnsDomain: body.querySelector('#dnsDomain').value.trim(),
      dnsIp: body.querySelector('#dnsIp').value.trim(),
      dnsTtl: parseInt(body.querySelector('#dnsTtl').value, 10) || 300,
      ...(body.querySelector('#dnsToken').value ? { dnsToken: body.querySelector('#dnsToken').value.trim() } : {}),
    });
    body.querySelector('#saveDns').onclick = async () => {
      try { await API.patch('/settings', dnsPayload()); UI.toast('DNS settings saved', 'success'); PAGE.integrations(); }
      catch (err) { UI.toast(err.message, 'error'); }
    };
    body.querySelector('#verifyDns').onclick = async () => {
      try { await API.patch('/settings', dnsPayload()); } catch (_) {}
      try { const res = await API.post('/system/dns/verify'); UI.toast(res.message || (res.ok ? 'Connected' : 'Not connected'), res.ok ? 'success' : 'warn'); PAGE.integrations(); }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    const botPayload = () => ({
      discordGuildId: body.querySelector('#botGuild').value.trim(),
      discordPrefix: body.querySelector('#botPrefix').value.trim() || '!',
      discordAdminRole: body.querySelector('#botRole').value.trim(),
      discordNotifChannelId: body.querySelector('#botNotif').value.trim(),
      discordDefaultType: body.querySelector('#botType').value.trim().toUpperCase() || 'PAPER',
      discordDefaultMemory: parseInt(body.querySelector('#botMemory').value, 10) || 2048,
      discordAllowRegistration: body.querySelector('#botRegistration').checked,
      ...(body.querySelector('#botToken').value ? { discordToken: body.querySelector('#botToken').value.trim() } : {}),
    });
    body.querySelector('#saveBot').onclick = async () => {
      try { await API.patch('/settings', botPayload()); UI.toast('Bot settings saved', 'success'); setTimeout(PAGE.integrations, 1500); }
      catch (err) { UI.toast(err.message, 'error'); }
    };
    body.querySelector('#startBot').onclick = async (e) => {
      try {
        await API.patch('/settings', { ...botPayload(), discordEnabled: true });
        e.target.disabled = true; e.target.innerHTML = `${UI.spinner(13)} Connecting…`;
        const res = await API.post('/system/discord/start');
        UI.toast(res.status === 'online' ? `Bot online as ${res.user?.username || 'bot'}` : `Bot ${res.status}${res.lastError ? `: ${res.lastError}` : ''}`, res.status === 'online' ? 'success' : 'warn');
      } catch (err) { UI.toast(err.message, 'error'); }
      setTimeout(PAGE.integrations, 1500);
    };
    body.querySelector('#stopBot').onclick = async () => {
      try { await API.post('/system/discord/stop'); UI.toast('Bot stopped', 'info'); } catch (err) { UI.toast(err.message, 'error'); }
      setTimeout(PAGE.integrations, 800);
    };
    body.querySelector('#testBot').onclick = async () => {
      try { await API.post('/system/discord/test'); UI.toast('Test message sent', 'success'); } catch (err) { UI.toast(err.message, 'error'); }
    };
  };

  /* --------------------------- allocations --------------------------- */
  PAGE.allocations = async function () {
    body.innerHTML = `<div class="skeleton" style="height:220px"></div>`;
    Layout.actions(`<a class="btn sm" href="allocations.html">${ICONS.ports} Full allocations page</a>`);
    const data = await API.get('/system/allocations');
    body.innerHTML = `
      <div class="grid cols-4">
        <div class="card"><span class="label tiny dim">Ports tracked</span><div class="stat-row mt"><b>${data.totalPorts}</b><span class="dim">all nodes</span></div></div>
        <div class="card"><span class="label tiny dim">Assigned</span><div class="stat-row mt"><b>${data.totalUsed}</b><span class="dim">to servers</span></div></div>
        <div class="card"><span class="label tiny dim">Free</span><div class="stat-row mt"><b>${data.totalPorts - data.totalUsed}</b><span class="dim">available</span></div></div>
        <div class="card"><span class="label tiny dim">Nodes</span><div class="stat-row mt"><b>${data.nodes.length}</b><span class="dim">${data.nodes.filter((n) => n.status === 'online').length} online</span></div></div>
      </div>
      ${data.nodes.map((n) => `
        <div class="card">
          <div class="row between wrap" style="gap:10px">
            <div><b>${esc(n.name)}</b> <span class="badge tiny ${n.local ? '' : 'blue'}">${n.local ? 'panel host' : 'remote agent'}</span>
              <div class="tiny dim mono mt">${n.range.start}–${n.range.end} · ${n.usedCount}/${n.total} used · next free ${n.nextFree ?? 'none'}</div></div>
            <span class="badge ${n.status === 'online' ? 'green' : 'red'}">${esc(n.status)}</span>
          </div>
          <table class="data mt">
            <thead><tr><th>Port</th><th>Server</th><th>Owner</th><th>Software</th><th>Status</th></tr></thead>
            <tbody>${n.used.length ? n.used.map((u) => `<tr>
              <td class="mono">${u.port}</td>
              <td><a href="server.html?id=${u.serverId}">${esc(u.name)}</a></td>
              <td>${esc(u.owner || '')}</td>
              <td class="mono tiny">${esc(u.serverType || '')} ${esc(u.version || '')}</td>
              <td>${statusBadge(u.status || 'offline')}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="tiny dim">No servers on this node.</td></tr>'}</tbody>
          </table>
        </div>`).join('')}`;
  };

  if (hash && document.querySelector(`[data-atab="${hash}"]`)) openTab(hash, { updateHash: false });
  else PAGE.users();
})();
