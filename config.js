'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const abs = (p, fallback) => path.resolve(root, p || fallback);

const cfg = {
  root,
  panelName: process.env.PANEL_NAME || 'Zenith Panel',
  panelUrl: (process.env.PANEL_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',

  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  allowRegistration: String(process.env.ALLOW_REGISTRATION || 'false') === 'true',
  loginMaxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '8', 10),
  loginWindowMs: parseInt(process.env.LOGIN_WINDOW_MS || '900000', 10),

  dataDir: abs(process.env.DATA_DIR, './data'),
  serverDataDir: abs(process.env.SERVER_DATA_DIR, './servers'),
  backupDir: abs(process.env.BACKUP_DIR, './backups'),
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(5 * 1024 * 1024 * 1024), 10),

  javaBin: process.env.JAVA_BIN || 'java',
  javaDir: abs(process.env.JAVA_DIR, './data/java'),
  stopTimeout: parseInt(process.env.STOP_TIMEOUT || '20', 10),
  logBufferLines: parseInt(process.env.LOG_BUFFER_LINES || '3000', 10),
  autostart: String(process.env.AUTOSTART_SERVERS || 'true') === 'true',

  modrinthApi: process.env.MODRINTH_API || 'https://api.modrinth.com/v2',
  modrinthUA: process.env.MODRINTH_USER_AGENT || 'zenith-panel/1.0.0 (self-hosted)',

  playitBinDir: abs(process.env.PLAYIT_BIN_DIR, './data/bin'),
  playitGlobalSecret: process.env.PLAYIT_GLOBAL_SECRET || '',

  nodeSecret: process.env.NODE_SECRET || '',
  version: require('../package.json').version,
};

/* ---- safety: never boot in production with a weak/absent secret ---- */
if (!cfg.jwtSecret || cfg.jwtSecret.length < 16) {
  const generated = crypto.randomBytes(32).toString('hex');
  const envPath = path.join(root, '.env');
  try {
    if (fs.existsSync(envPath)) {
      let txt = fs.readFileSync(envPath, 'utf8');
      if (/^JWT_SECRET=/m.test(txt)) {
        txt = txt.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${generated}"`);
      } else {
        txt += `\nJWT_SECRET="${generated}"\n`;
      }
      fs.writeFileSync(envPath, txt);
    } else {
      fs.writeFileSync(envPath, `JWT_SECRET="${generated}"\n`);
    }
  } catch (_) { /* read-only fs - fall back to memory only */ }
  cfg.jwtSecret = generated;
  cfg.generatedSecret = true;
}

for (const dir of [cfg.dataDir, cfg.serverDataDir, cfg.backupDir, cfg.playitBinDir, path.join(cfg.dataDir, 'tmp')]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = cfg;
