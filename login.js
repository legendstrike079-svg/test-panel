/* Login / register page */
(function () {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const title = document.getElementById('authTitle');
  const sub = document.getElementById('authSub');
  const switchEl = document.getElementById('authSwitch');
  const alertEl = document.getElementById('authAlert');
  const params = new URLSearchParams(location.search);

  let registrationOpen = true;
  let mode = 'login';

  function alertBox(message, type = 'red') {
    alertEl.innerHTML = `<div class="banner-note ${type}">${ICONS.warn}<div>${esc(message)}</div></div>`;
  }
  function clearAlert() { alertEl.innerHTML = ''; }
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
      onError: (err) => alertBox(err.message || 'External sign-in failed', 'red'),
    });
  }

  function render() {
    const isLogin = mode === 'login';
    loginForm.style.display = isLogin ? '' : 'none';
    registerForm.style.display = isLogin ? 'none' : '';
    title.textContent = isLogin ? 'Sign in' : 'Create your account';
    sub.textContent = isLogin ? 'Welcome back. Enter your panel credentials.' : 'The first account created becomes the panel owner.';
    switchEl.innerHTML = isLogin
      ? (registrationOpen ? 'No account yet? <a href="#" id="toRegister">Create one</a>' : 'Registration is disabled - ask an administrator for an account')
      : 'Already registered? <a href="#" id="toLogin">Sign in</a>';
    const toRegister = document.getElementById('toRegister');
    const toLogin = document.getElementById('toLogin');
    if (toRegister) toRegister.onclick = (e) => { e.preventDefault(); mode = 'register'; clearAlert(); render(); };
    if (toLogin) toLogin.onclick = (e) => { e.preventDefault(); mode = 'login'; clearAlert(); render(); };
  }

  if (params.get('expired')) alertBox('Your session expired - please sign in again.', 'yellow');
  if (window.OAuthLogin) window.OAuthLogin.completeDiscordRedirect({
    onSuccess: finishExternalLogin,
    onError: (err) => alertBox(err.message || 'Discord sign-in failed', 'red'),
  });

  // panel info + is registration allowed?
  fetch('/api/auth/panel').then((r) => r.json()).then((d) => {
    registrationOpen = !!d.allowRegistration;
    mountProviders(d.authProviders);
    if (window.applyAppearance) window.applyAppearance(d);
    // Keep the public entry screen aligned with the branding selected in
    // Administration → Panel settings, without ever exposing credentials.
    document.querySelectorAll('.brand-text b').forEach((el) => { el.textContent = d.panelName || 'Zenith Panel'; });
    document.querySelectorAll('.brand-mark').forEach((el) => {
      const source = window.panelLogoSource ? window.panelLogoSource(d.panelLogo) : (d.panelLogo || 'assets/zenith-panel-logo.webp');
      el.innerHTML = `<img src="${esc(source)}" alt="${esc(d.panelName || 'Zenith Panel')} logo">`;
    });
    document.getElementById('serverInfo').textContent = `${d.panelName} v${d.version} · Node ${d.node}`;
    if (d.needsSetup) {
      mode = 'register';
      alertBox('No accounts exist yet - the first account you create becomes the panel owner.', 'yellow');
    }
    render();
  }).catch(() => {
    registrationOpen = true;
    document.getElementById('serverInfo').textContent = 'Panel not reachable - is server.js running?';
    render();
  });
  render();

  if (params.get('register') === '1') { mode = 'register'; render(); }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.innerHTML = `${UI.spinner(14)} <span>Signing in...</span>`;
    try {
      const data = await API.post('/auth/login', {
        username: loginForm.username.value.trim(),
        password: loginForm.password.value,
      });
      store.token = data.token;
      location.href = 'dashboard.html';
    } catch (err) {
      alertBox(err.message + (err.data && err.data.attemptsLeft !== undefined ? ` (${err.data.attemptsLeft} attempts left)` : ''), 'red');
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const btn = document.getElementById('registerBtn');
    btn.disabled = true; btn.innerHTML = `${UI.spinner(14)} <span>Creating...</span>`;
    try {
      const data = await API.post('/auth/register', {
        username: registerForm.username.value.trim(),
        email: registerForm.email.value.trim(),
        password: registerForm.password.value,
      });
      store.token = data.token;
      location.href = 'dashboard.html';
    } catch (err) {
      alertBox(err.message, 'red');
      btn.disabled = false; btn.textContent = 'Create account';
    }
  });
})();
