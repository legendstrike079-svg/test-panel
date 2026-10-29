'use strict';
/**
 * Tiny dependency-free JSON database.
 * Whole DB lives in data/db.json, written atomically with a debounce.
 * Good for a self-hosted panel (thousands of servers) and zero setup.
 */
const path = require('path');
const cfg = require('./config');
const { writeJson, readJson, ensureDir } = require('./utils');

const FILE = path.join(cfg.dataDir, 'db.json');

const DEFAULTS = {
  users: [],
  servers: [],
  nodes: [],
  apiKeys: [],
  activity: [],
  settings: {
    panelName: cfg.panelName,
    allowRegistration: cfg.allowRegistration,
    defaultJava: cfg.javaBin,
    defaultMemory: 2048,
    defaultPort: 25565,
    maxServersPerUser: 5,
    // Branding is data, never a baked-in demo skin. Fresh panels are closed
    // to public sign-up until an owner deliberately opens registration.
    theme: 'midnight',
    accentColor: '#3b82f6',
    panelLogo: '',
    // A panel-wide, admin supplied backdrop. The image lives in db.json so it
    // applies consistently to authenticated and public entry pages.
    panelBackground: '',
    panelBackgroundOpacity: 28,
    // Optional public origin used for OAuth callbacks and node install links.
    // Empty deliberately falls back to the PANEL_URL environment setting.
    panelUrl: '',
    installJavaAutomatically: true,
    autoRestartOnCrash: false,
    // External identity providers are deliberately off until the owner enters
    // their own Firebase/Discord credentials in Administration → Settings.
    oauthAllowRegistration: false,
    firebaseGoogleEnabled: false,
    firebaseApiKey: '',
    firebaseAuthDomain: '',
    firebaseProjectId: '',
    firebaseAppId: '',
    discordOAuthEnabled: false,
    discordOAuthClientId: '',
    discordOAuthClientSecret: '',
  },
};

let data = structuredClone(DEFAULTS);
let dirty = false;
let timer = null;

function applyDisk(disk) {
  data = { ...structuredClone(DEFAULTS), ...disk };
  for (const key of Object.keys(DEFAULTS)) {
    if (data[key] === undefined || data[key] === null) data[key] = structuredClone(DEFAULTS[key]);
  }
  data.settings = { ...DEFAULTS.settings, ...(disk.settings || {}) };
}

function load() {
  const disk = require('fs').existsSync(FILE) ? readJsonSync(FILE) : null;
  if (disk && typeof disk === 'object') applyDisk(disk);
  noteOwnWrite();
  return data;
}

function readJsonSync(file) {
  try { return JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Re-read data/db.json when another process changed it (the CLI
 * `scripts/createuser.js`, or `install.sh` creating the owner while the panel
 * is already up). Without this, "the installer created my account but login
 * says invalid credentials" happens: the panel holds an older copy in memory
 * and its next flush would erase the new account.
 *
 * Safety rules: never reload while we have unsaved local changes (that would
 * drop them), and never reload a file we cannot parse.
 */
let lastStat = { mtimeMs: 0, size: -1 };

function reloadIfChanged() {
  if (dirty || timer) return false;          // our own writes are pending - keep them
  let st;
  try { st = require('fs').statSync(FILE); } catch { return false; }
  if (st.mtimeMs === lastStat.mtimeMs && st.size === lastStat.size) return false;
  const disk = readJsonSync(FILE);
  if (!disk || typeof disk !== 'object') return false;
  lastStat = { mtimeMs: st.mtimeMs, size: st.size };
  applyDisk(disk);
  return true;
}

function noteOwnWrite() {
  try {
    const st = require('fs').statSync(FILE);
    lastStat = { mtimeMs: st.mtimeMs, size: st.size };
  } catch { lastStat = { mtimeMs: 0, size: -1 }; }
}

function scheduleFlush() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      await ensureDir(path.dirname(FILE));
      await writeJson(FILE, data);
      noteOwnWrite();
    } catch (err) {
      console.error('[db] flush failed:', err.message);
    }
  }, 250);
}

async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  dirty = false;
  await ensureDir(path.dirname(FILE));
  await writeJson(FILE, data);
  noteOwnWrite();
}

const db = {
  load,
  flush,
  reloadIfChanged,
  noteOwnWrite,
  /** raw collection accessor */
  get(key) { return data[key]; },
  set(key, value) { data[key] = value; scheduleFlush(); return value; },

  /* ------- generic helpers ------- */
  find(key, predicate) { return (data[key] || []).find(predicate); },
  filter(key, predicate) { return (data[key] || []).filter(predicate); },
  insert(key, doc) { (data[key] = data[key] || []).push(doc); scheduleFlush(); return doc; },
  update(key, id, patch) {
    const list = data[key] || [];
    const i = list.findIndex((d) => d.id === id);
    if (i === -1) return null;
    list[i] = { ...list[i], ...patch };
    scheduleFlush();
    return list[i];
  },
  remove(key, id) {
    const list = data[key] || [];
    const i = list.findIndex((d) => d.id === id);
    if (i === -1) return null;
    const [doc] = list.splice(i, 1);
    scheduleFlush();
    return doc;
  },
  settings() { return data.settings; },
  setSettings(patch) { data.settings = { ...data.settings, ...patch }; scheduleFlush(); return data.settings; },

  /** activity log, capped at 500 entries */
  log(entry) {
    data.activity.unshift({ id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), ...entry });
    if (data.activity.length > 500) data.activity.length = 500;
    scheduleFlush();
  },
};

module.exports = db;
