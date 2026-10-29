#!/usr/bin/env node
'use strict';
/**
 * Builds the release archive and enforces the size budget.
 *
 *   node scripts/package.js                  # dist/zenith-panel-<version>.zip
 *   node scripts/package.js --with-deps      # also bundle production node_modules
 *   node scripts/package.js --budget 25      # fail if the archive is bigger (MB)
 *   node scripts/package.js --verify         # unpack to a temp dir, boot it, run the smoke test
 *
 * What is shipped: the code, the front-end, the installer, the tests and the
 * docs. What is not: node_modules (npm install), data/ servers/ backups/ logs/
 * (your servers and accounts), uploads/ (design references) and any managed JRE.
 *
 * The archive is a plain zip of the project rooted at `zenith-panel/`, so
 * `unzip zenith-panel-x.y.z.zip && cd zenith-panel && npm install && npm start`
 * is the whole install.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const argv = process.argv.slice(2);
const flagValue = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BUDGET_MB = Number(flagValue('budget', 25));
const WITH_DEPS = argv.includes('--with-deps');
const VERIFY = argv.includes('--verify');

const INCLUDE = [
  '.env.example', '.gitignore', '.devcontainer', 'Dockerfile', 'docker-compose.yml', 'ecosystem.config.cjs',
  'LICENSE', 'README.md', 'FILES.md', 'install.sh', 'uninstall.sh',
  'package.json', 'package-lock.json', 'server.js',
  'src', 'public', 'scripts', 'docs', 'tests', 'preview',
];
const EXCLUDE_DIRS = new Set([
  'node_modules', 'data', 'servers', 'backups', 'logs', 'uploads', 'dist',
  '.cache', '.npm', '.pm2', '.git', '.arena', 'tmp',
]);
const EXCLUDE_FILES = new Set(['.env']);

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function collect(target, out = [], relBase = '') {
  if (!fs.existsSync(target)) return out;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      collect(path.join(target, entry.name), out, rel);
    } else {
      if (EXCLUDE_FILES.has(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

function build() {
  const version = pkg.version;
  const name = `zenith-panel-${version}`;
  const distDir = path.join(ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const zipPath = path.join(distDir, `${name}.zip`);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const files = WITH_DEPS ? [...collect(path.join(ROOT, 'node_modules'), [], 'node_modules'), ...collect(ROOT)] : collect(ROOT);
  if (WITH_DEPS) {
    const rootFiles = collect(ROOT);
    files.length = 0;
    files.push(...rootFiles, ...collect(path.join(ROOT, 'node_modules'), [], 'node_modules'));
  }
  const unique = [...new Set(files)].sort();
  const missing = INCLUDE.filter((entry) => !fs.existsSync(path.join(ROOT, entry)));
  if (missing.length) {
    console.error(`missing from the project: ${missing.join(', ')}`);
    process.exit(1);
  }

  // build a staging tree so the archive has a single top-level folder
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-pack-'));
  const stageRoot = path.join(stage, name);
  fs.mkdirSync(stageRoot, { recursive: true });
  let bytes = 0;
  for (const rel of unique) {
    const from = path.join(ROOT, rel);
    const to = path.join(stageRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    // keep scripts executable
    if (rel.endsWith('.sh') || rel === 'scripts/zenith' || rel.startsWith('scripts/') && !rel.endsWith('.js')) {
      fs.chmodSync(to, 0o755);
    } else if (rel.endsWith('.sh')) {
      fs.chmodSync(to, 0o755);
    }
    bytes += fs.statSync(to).size;
  }

  let method = 'zip';
  try {
    execFileSync('zip', ['-qr', zipPath, name], { cwd: stage, stdio: 'ignore' });
  } catch (_) {
    method = 'tar.gz';
    execFileSync('tar', ['-czf', zipPath.replace(/\.zip$/, '.tar.gz'), name], { cwd: stage, stdio: 'ignore' });
  }
  const archive = method === 'zip' ? zipPath : zipPath.replace(/\.zip$/, '.tar.gz');
  const archiveBytes = fs.statSync(archive).size;
  fs.rmSync(stage, { recursive: true, force: true });

  console.log(`\npackaged ${unique.length} files`);
  console.log(`  payload   ${human(bytes)}`);
  console.log(`  archive   ${human(archiveBytes)}  (${method}: ${path.relative(ROOT, archive)})`);
  if (WITH_DEPS) console.log('  includes production node_modules');

  const budget = BUDGET_MB * 1024 * 1024;
  if (archiveBytes > budget) {
    console.error(`\nFAIL  archive is ${human(archiveBytes)}, budget is ${BUDGET_MB} MB`);
    process.exit(1);
  }
  console.log(`  budget    ${BUDGET_MB} MB - ${Math.round((archiveBytes / budget) * 100)}% used, ${human(budget - archiveBytes)} spare\n`);
  return { archive, name, method };
}

function verify({ archive, name, method }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-verify-'));
  console.log(`unpacking into ${dir}`);
  if (method === 'zip') execFileSync('unzip', ['-q', archive, '-d', dir]);
  else execFileSync('tar', ['-xzf', archive, '-C', dir]);
  const app = path.join(dir, name);
  for (const required of ['server.js', 'public/index.html', 'src/config.js', 'scripts/createuser.js', 'install.sh']) {
    if (!fs.existsSync(path.join(app, required))) {
      console.error(`FAIL  ${required} missing from the archive`);
      process.exit(1);
    }
  }
  console.log('  archive contents look complete');

  // install and boot it like a user would
  console.log('  npm ci --omit=dev --omit=optional ...');
  execFileSync('npm', ['ci', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund'], { cwd: app, stdio: 'ignore' });
  const port = 8098;
  const env = {
    ...process.env, PORT: String(port), DATA_DIR: path.join(app, 'data'),
    SERVER_DATA_DIR: path.join(app, 'servers'), BACKUP_DIR: path.join(app, 'backups'),
    SFTP_ENABLED: 'false', JAVA_DIR: path.join(dir, 'java'),
  };
  const child = require('child_process').spawn(process.execPath, ['server.js'], { cwd: app, env, stdio: 'ignore' });
  const started = Date.now();
  const waitFor = async (ms) => {
    while (Date.now() - started < ms) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/version`);
        if (res.ok) return await res.json();
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  return waitFor(20000).then(async (info) => {
    child.kill('SIGTERM');
    if (!info) {
      console.error('FAIL  the packaged panel did not answer on /api/version within 20s');
      process.exit(1);
    }
    console.log(`  packaged panel booted: ${info.name} v${info.version} on node ${info.node}`);
    console.log('  verify OK\n');
    // give the panel a moment to finish its shutdown (it flushes the DB)
    await new Promise((r) => setTimeout(r, 700));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      console.log(`  (left ${dir} behind: ${err.code})`);
    }
  });
}

(async () => {
  const built = build();
  if (VERIFY) await verify(built);
})().catch((err) => { console.error('packaging failed:', err.message); process.exit(1); });
