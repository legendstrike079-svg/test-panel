/* Account: profile, password, API keys, my servers */
(async function () {
  const body = document.getElementById('accountBody');
  try { await bootstrap({ active: 'account.html' }); } catch (_) { return; }
  Layout.title('Account', store.user.username);

  async function render() {
    const [me, keys, servers] = await Promise.all([
      API.get('/auth/me'),
      API.get('/keys'),
      API.get('/servers'),
    ]);
    const u = me.user;
    body.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <div class="row" style="gap:13px">
            <div class="avatar user-avatar" style="width:52px;height:52px;flex:0 0 52px;font-size:20px">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : esc(u.username[0].toUpperCase())}</div>
            <div>
              <div class="row" style="gap:8px"><h2 style="margin:0">${esc(u.username)}</h2>
                <span class="badge ${u.role === 'owner' ? 'violet' : u.role === 'admin' ? 'blue' : ''}">${esc(u.role)}</span></div>
              <div class="tiny dim">member since ${fmt.date(u.createdAt).split(',')[0]} · last login ${fmt.timeAgo(u.lastLoginAt)}</div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="col" style="gap:12px">
            <label class="field">E-mail <input id="acEmail" value="${esc(u.email || '')}" placeholder="you@example.com"></label>
            <div class="row wrap" style="gap:8px">
              <button class="btn" id="saveProfile">${ICONS.save} Save profile</button>
              <button class="btn sm" id="uploadAvatar">${ICONS.upload} Upload photo</button>
              ${u.avatar ? '<button class="btn sm ghost" id="removeAvatar">Remove photo</button>' : ''}
            </div>
            <div class="tiny dim">Profile photos are cropped to a square in your browser and stored on the panel - max 6 MB upload.</div>
          </div>
        </div>

        <div class="card">
          <h3>Change password</h3>
          <div class="col" style="gap:12px">
            <label class="field">Current password <input type="password" id="pwCurrent" autocomplete="current-password"></label>
            <label class="field">New password <input type="password" id="pwNew" autocomplete="new-password" placeholder="min 8 characters"></label>
            <button class="btn primary" id="changePassword">Update password</button>
            <div class="tiny dim">Changing your password signs out every other session.</div>
          </div>
        </div>
      </div>

      <div class="card flush">
        <div class="card-head">
          <div><h3 id="keysCard">API keys</h3><div class="tiny dim">Use with <span class="mono">X-API-Key: &lt;key&gt;</span> for scripts, bots and the CLI</div></div>
          <button class="btn sm primary" id="newKey">${ICONS.plus} Create key</button>
        </div>
        ${keys.apiKeys.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${keys.apiKeys.map((k) => `<tr>
            <td style="font-weight:600">${esc(k.name)}${k.revoked ? ' <span class="badge red">revoked</span>' : ''}</td>
            <td class="mono tiny">${esc(k.prefix)}…</td>
            <td class="tiny dim">${fmt.date(k.createdAt)}</td>
            <td class="tiny dim">${k.lastUsedAt ? fmt.timeAgo(k.lastUsedAt) : 'never'}</td>
            <td style="text-align:right">${k.revoked ? '' : `<button class="btn sm ghost" data-revoke="${esc(k.id)}">revoke</button>`}</td>
          </tr>`).join('')}</tbody></table></div>`
        : UI.empty('No API keys yet', 'Create one to drive the panel from scripts.')}
      </div>

      <div class="card">
        <div class="row between wrap" style="gap:10px">
          <div>
            <h3 style="margin:0">Panel tour</h3>
            <div class="tiny dim mt">Six quick steps over the sidebar, server cards, page actions and notifications.</div>
          </div>
          <button class="btn sm" id="replayTutorial">${ICONS.play} Take the tour again</button>
        </div>
      </div>

      <div class="card flush">
        <div class="card-head"><h3>My servers</h3><span class="badge">${servers.servers.length}</span></div>
        ${servers.servers.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Server</th><th>Role</th><th>Status</th><th>Port</th><th></th></tr></thead>
          <tbody>${servers.servers.map((s) => `<tr>
            <td><a href="server.html?id=${s.id}" style="font-weight:600">${esc(s.name)}</a><div class="tiny dim mono">${esc(s.serverType)} ${esc(s.version || '')}</div></td>
            <td class="tiny">${s.isOwner ? '<span class="badge">owner</span>' : '<span class="badge blue">subuser</span>'}</td>
            <td>${statusBadge(s.status)}</td>
            <td class="mono tiny">${s.port}</td>
            <td style="text-align:right"><a class="btn sm ghost" href="server.html?id=${s.id}">open</a></td>
          </tr>`).join('')}</tbody></table></div>` : UI.empty('You have no servers yet', 'Create one from the Servers page.')}
      </div>`;

    body.querySelector('#saveProfile').onclick = async (e) => {
      const btn = e.target.closest('button');
      btn.disabled = true;
      try { await API.patch('/auth/profile', { email: body.querySelector('#acEmail').value }); UI.toast('Profile saved', 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
      btn.disabled = false;
    };

    const saveAvatar = async (dataUrl) => {
      try {
        const res = await API.patch('/auth/profile', { avatar: dataUrl });
        store.user = res.user;
        UI.toast(dataUrl ? 'Profile photo updated' : 'Profile photo removed', 'success');
        const chip = document.querySelector('.user-chip .avatar');
        if (chip) chip.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : esc(res.user.username[0].toUpperCase());
        render();
      } catch (err) { UI.toast(err.message, 'error'); }
    };
    body.querySelector('#uploadAvatar').onclick = () => Cropper.open({
      title: 'Profile photo',
      size: 256,
      onDone: (dataUrl) => saveAvatar(dataUrl),
    });
    const rm = body.querySelector('#removeAvatar');
    if (rm) rm.onclick = async () => {
      if (!(await UI.confirm('Remove your profile photo?', { confirmText: 'Remove', danger: false }))) return;
      saveAvatar('');
    };

    body.querySelector('#changePassword').onclick = async (e) => {
      const btn = e.target.closest('button');
      btn.disabled = true;
      try {
        await API.post('/auth/password', {
          currentPassword: body.querySelector('#pwCurrent').value,
          newPassword: body.querySelector('#pwNew').value,
        });
        UI.toast('Password updated - please sign in again', 'success');
        setTimeout(() => { store.token = ''; location.href = 'index.html'; }, 1800);
      } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; }
    };

    body.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm('Revoke this API key?', { confirmText: 'Revoke' }))) return;
      try { await API.del(`/keys/${b.dataset.revoke}`); UI.toast('Key revoked', 'success'); render(); }
      catch (err) { UI.toast(err.message, 'error'); }
    });

    body.querySelector('#newKey').onclick = () => {
      UI.modal({
        title: 'Create API key',
        narrow: true,
        body: `<label class="field">Key name <input id="keyName" placeholder="deploy-bot"></label>
               <div class="tiny dim mt">The key inherits your account permissions. Treat it like a password.</div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="doCreateKey">Create key</button>`,
        onMount(m, { close }) {
          m.querySelector('#doCreateKey').onclick = async () => {
            try {
              const res = await API.post('/keys', { name: m.querySelector('#keyName').value || 'API key' });
              close();
              UI.modal({
                title: 'Your new API key',
                body: `<div class="banner-note yellow">${ICONS.warn}<div>Copy it now - it is only shown once.</div></div>
                  <div class="copy-box mt"><span class="code grow">${esc(res.apiKey.token)}</span><button class="btn sm primary" data-copy="${esc(res.apiKey.token)}">Copy</button></div>
                  <div class="code mt">curl -H "X-API-Key: ${esc(res.apiKey.token)}" ${esc(location.origin)}/api/servers</div>`,
              });
              render();
            } catch (err) { UI.toast(err.message, 'error'); }
          };
        },
      });
    };
  }

  await render();
  if (location.hash === '#keys') {
    const card = document.getElementById('keysCard');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.closest('.card')?.animate([{ boxShadow: '0 0 0 0 var(--blue-dim)' }, { boxShadow: '0 0 0 6px var(--blue-dim)' }, { boxShadow: '0 0 0 0 var(--blue-dim)' }], { duration: 1400 });
    }
  }
})();
