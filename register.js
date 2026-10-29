/* Standalone registration page (mirrors the JTG panel's /register). */
(async function () {
  const form = document.getElementById('registerForm');
  const alertBox = document.getElementById('authAlert');
  const info = document.getElementById('serverInfo');
  const btn = document.getElementById('registerBtn');

  function alert(kind, message) {
    alertBox.innerHTML = `<div class="banner-note ${kind === 'error' ? 'red' : kind === 'info' ? 'blue' : 'green'}">
      <div>${esc(message)}</div></div>`;
  }
  function finishExternalLogin(data) {
    if (!data || !data.token) throw new Error('The identity provider did not return a panel session');
    store.token = data.token;
    store.user = data.user || null;
    location.href = 'dashboard.html';
  }
  function mountProviders(providers) {
    if (!window.OAuthLogin) return;
    window.OAuthLogin.mount(document.getElementById('oauthProviders'), providers, {
      onSuccess: finishExternalLogin,
      onError: (err) => alert('error', err.message || 'External sign-in failed'),
    });
  }

  if (window.OAuthLogin) window.OAuthLogin.completeDiscordRedirect({
    onSuccess: finishExternalLogin,
    onError: (err) => alert('error', err.message || 'Discord sign-in failed'),
  });

  // If the owner already has a session, don't make them register again.
  if (store.token) {
    try {
      await API.get('/auth/me');
      location.href = 'dashboard.html';
      return;
    } catch (_) { store.token = ''; }
  }

  // The panel tells us whether registration is open and what it is called.
  let panel = { panelName: 'Zenith Panel', registrationOpen: false, discordEnabled: false };
  try {
    panel = { ...panel, ...(await API.get('/auth/panel')) };
    mountProviders(panel.authProviders);
    // Public branding includes the panel-wide background, not just the signed-in shell.
    if (window.applyAppearance) window.applyAppearance(panel);
    document.querySelectorAll('.brand-text b').forEach((el) => { el.textContent = panel.panelName || 'Zenith Panel'; });
    document.querySelectorAll('.brand-mark').forEach((el) => {
      const source = window.panelLogoSource ? window.panelLogoSource(panel.panelLogo) : (panel.panelLogo || 'assets/zenith-panel-logo.webp');
      el.innerHTML = `<img src="${esc(source)}" alt="${esc(panel.panelName || 'Zenith Panel')} logo">`;
    });
    document.title = `${panel.panelName} - Create account`;
    info.textContent = `${panel.panelName}${panel.version ? ` v${panel.version}` : ''} - registration is ${panel.registrationOpen ? 'open' : 'closed'}`;
  } catch (_) {
    info.textContent = 'the panel did not answer - try again in a moment';
  }

  if (!panel.registrationOpen) {
    form.style.display = 'none';
    document.getElementById('registerSub').style.display = 'none';
    const providers = panel.authProviders || {};
    const providerSignup = Boolean(panel.oauthRegistrationOpen && ((providers.google && providers.google.enabled) || (providers.discord && providers.discord.enabled)));
    alert('info', providerSignup
      ? 'Password registration is closed, but this panel accepts new accounts through the configured verified identity provider below.'
      : 'Registration is closed on this panel. Ask the owner for an account (Admin → Settings → Allow registration opens it again).');
    info.innerHTML = '<a href="index.html">Back to sign in</a>';
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (password !== form.password2.value) return alert('error', 'The two passwords do not match.');
    if (password.length < 8) return alert('error', 'Use at least 8 characters for the password.');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
      const data = await API.post('/auth/register', { username, email, password });
      if (data.token) {
        store.token = data.token;
        store.user = data.user;
        alert('success', `Welcome, ${username}. Taking you to the dashboard...`);
        setTimeout(() => { location.href = 'dashboard.html'; }, 700);
      } else {
        alert('success', 'Account created - sign in to continue.');
        setTimeout(() => { location.href = 'index.html'; }, 900);
      }
    } catch (err) {
      alert('error', err.message);
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  });
})();
