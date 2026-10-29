#!/usr/bin/env node
'use strict';
/**
 * Zenith node agent.
 *
 * Runs on a second machine so the panel can host Minecraft servers there as
 * well. The panel provisions a server, then drives it over this HTTP API; the
 * agent owns the process, the console buffer and the files on that box.
 *
 *   GET    /api/node/status                     host stats (panel ping + heartbeat)
 *   GET    /api/node/servers                    servers known to this node
 *   GET    /api/node/ports?start=&end=          first free port in a range
 *   POST   /api/node/servers/:id/provision      download jar (+ JRE), write eula/properties
 *   GET    /api/node/servers/:id/status         { running, pid, rss, ready }
 *   GET    /api/node/servers/:id/logs?since=n   incremental console lines
 *   POST   /api/node/servers/:id/start|stop|kill|command
 *   DELETE /api/node/servers/:id                stop + wipe the server directory
 *
 * Auth: `x-node-token: <token>` or `Authorization: Bearer <token>` on every
 * /api/node/* route. Env:
 *
 *   ZENITH_PANEL_URL   http://panel:8080      (heartbeat target, optional)
 *   ZENITH_NODE_TOKEN  <node token from the panel>
 *   NODE_PORT          8443
 *   NODE_DATA_DIR      <where servers live>   (default ./node-servers)
 *   JAVA_BIN           java                   (override the JVM used)
 */
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const PORT = parseInt(process.env.NODE_PORT || '8443', 10);
const PANEL_URL = (process.env.ZENITH_PANEL_URL || '').replace(/\/$/, '');
const TOKEN = process.env.ZENITH_NODE_TOKEN || '';
const ROOT = process.env.NODE_DATA_DIR || path.join(__dirname, 'node-servers');
const JAVA_BIN = process.env.JAVA_BIN || 'java';
const LOG_LIMIT = 4000;
const AGENT_NAME = process.env.NODE_NAME || os.hostname();
const RUNTIME = (process.env.NODE_RUNTIME || 'process').toLowerCase() === 'docker' ? 'docker' : 'process';
const DOCKER_IMAGE = process.env.NODE_DOCKER_IMAGE || 'eclipse-temurin:21-jre';
const DOCKER_OVERHEAD_MB = 384;

const servers = new Map(); // id -> { config, proc, logs, seq, ready, exitCode, startedAt }
const events = [];         // rolling agent-level log for /api/node/events (diagnostics)

function alog(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  events.push(line);
  if (events.length > 300) events.shift();
  console.log(`[zenith-agent] ${msg}`);
}

/* ------------------------------- helpers ------------------------------- */
function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function auth(req) {
  return Boolean(TOKEN) && (req.headers['x-node-token'] === TOKEN || req.headers['authorization'] === `Bearer ${TOKEN}`);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (_) { resolve({}); }
    });
  });
}

function serverDir(id) { return path.join(ROOT, id); }
function configPath(id) { return path.join(serverDir(id), 'zenith-node.json'); }

function loadConfig(id) {
  try { return JSON.parse(fs.readFileSync(configPath(id), 'utf8')); } catch (_) { return null; }
}

function saveConfig(id, config) {
  fs.mkdirSync(serverDir(id), { recursive: true });
  fs.writeFileSync(configPath(id), JSON.stringify(config, null, 2));
  return config;
}

function entryFor(id) {
  let entry = servers.get(id);
  if (!entry) {
    entry = {
      config: loadConfig(id) || { memory: 2048, jar: 'server.jar', port: 0 },
      proc: null, logs: [], seq: 0, ready: false, exitCode: null, startedAt: null,
    };
    servers.set(id, entry);
  }
  return entry;
}

function pushLog(id, chunk) {
  const entry = entryFor(id);
  const text = String(chunk).replace(/\r/g, '');
  for (const line of text.split('\n')) {
    if (line === '' && text.endsWith('\n')) continue;
    entry.logs.push(line);
    entry.seq += 1;
  }
  if (entry.logs.length > LOG_LIMIT) entry.logs.splice(0, entry.logs.length - LOG_LIMIT);
  if (/Done \([\d.]+s\)! For help, type "help"/.test(text)) entry.ready = true;
}

function tail(arr, n) { return arr.slice(Math.max(0, arr.length - n)); }

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const item of items) {
      const p = path.join(d, item.name);
      if (item.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch (_) {} }
    }
  };
  walk(dir);
  return total;
}

function hostStatus() {
  return {
    id: 'agent',
    name: AGENT_NAME,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cores: os.cpus().length,
    load: Number(os.loadavg()[0].toFixed(2)),
    memory: { total: os.totalmem(), free: os.freemem() },
    disk: diskInfo(),
    uptime: os.uptime(),
    agentUptime: process.uptime(),
    node: process.version,
    containerRuntime: dockerProbe(),
    containerImage: DOCKER_IMAGE,
    configuredRuntime: RUNTIME,
    running: [...servers.values()].filter((s) => s.proc).length,
    servers: [...servers.keys()].length,
    dataDir: ROOT,
  };
}

function diskInfo() {
  const res = spawnSync('df', ['-k', ROOT], { encoding: 'utf8' });
  const line = (res.stdout || '').split('\n')[1];
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  const total = parseInt(parts[1], 10) * 1024;
  const free = parseInt(parts[3], 10) * 1024;
  return { total, free, used: total - free, percent: total ? Math.round(((total - free) / total) * 100) : 0 };
}

/** Download a URL to a file, following redirects (Adoptium/GitHub use them). */
async function download(url, target, onProgress) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'zenith-node-agent/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const out = fs.createWriteStream(target);
  let received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (onProgress && total) onProgress(Math.round((received / total) * 100));
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  return { bytes: received, total };
}

function javaMajor(bin) {
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  const text = `${res.stdout || ''}${res.stderr || ''}`;
  const m = text.match(/version "?(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  return major === 1 ? parseInt(m[2] || '0', 10) : major;
}

function osSlug() {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}
function archSlug() {
  if (process.arch === 'arm64') return 'aarch64';
  if (process.arch === 'arm') return 'arm';
  return process.arch === 'x64' ? 'x64' : 'x64';
}

/** Make sure a JVM new enough is available on this box (downloads Temurin if not). */
async function ensureJava(major, note = () => {}) {
  const needed = Number(major || 21);
  const current = javaMajor(JAVA_BIN);
  if (current && current >= needed) return { bin: JAVA_BIN, major: current, managed: false };

  const managedDir = path.join(ROOT, '..', 'node-java', `jre-${needed}`);
  const managedBin = path.join(managedDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(managedBin)) return { bin: managedBin, major: needed, managed: true };

  const archiveExt = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const url = process.env.NODE_JAVA_URL ||
    `https://api.adoptium.net/v3/binary/latest/${needed}/ga/${osSlug()}/${archSlug()}/jre/hotspot/normal/eclipse`;
  note(`Downloading Temurin JRE ${needed} (no suitable system JVM found)`);
  const archive = path.join(ROOT, '.tmp', `temurin-${needed}.${archiveExt}`);
  await download(url, archive, (percent) => { if (percent % 25 === 0) note(`  java ${needed}: ${percent}%`); });

  fs.rmSync(managedDir, { recursive: true, force: true });
  fs.mkdirSync(managedDir, { recursive: true });
  note('Extracting Java runtime...');
  if (archiveExt === 'zip') {
    const res = spawnSync('unzip', ['-q', archive, '-d', managedDir]);
    if (res.status !== 0) throw new Error('unzip not available to extract the JRE');
  } else {
    const res = spawnSync('tar', ['-xzf', archive, '-C', managedDir]);
    if (res.status !== 0) throw new Error(`tar failed: ${res.stderr}`);
  }
  const entries = fs.readdirSync(managedDir);
  if (entries.length === 1 && fs.existsSync(path.join(managedDir, entries[0], 'bin'))) {
    const nested = path.join(managedDir, entries[0]);
    for (const item of fs.readdirSync(nested)) fs.renameSync(path.join(nested, item), path.join(managedDir, item));
    fs.rmSync(nested, { recursive: true, force: true });
  }
  fs.rmSync(archive, { force: true });
  if (!fs.existsSync(managedBin)) throw new Error('Java extraction produced no binary');
  fs.chmodSync(managedBin, 0o755);
  note(`Java ${needed} installed at ${managedBin}`);
  return { bin: managedBin, major: needed, managed: true };
}

const AIKAR_FLAGS = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs',
];

/* -------------------------------- docker -------------------------------- */
/**
 * Minimal docker CLI wrapper for the agent. Servers with `containerRuntime:
 * 'docker'` run in real containers; every docker error is returned verbatim.
 */
function dockerCli(args, { timeout = 120000, onLine } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (err) { return resolve({ code: -1, stdout: '', stderr: err.message }); }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => { if (!done) { try { child.kill('SIGKILL'); } catch (_) {} resolve({ code: -1, stdout, stderr: 'docker timed out' }); done = true; } }, timeout);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => { const t = d.toString('utf8'); stdout += t; if (onLine) t.split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l)); });
    child.stderr.on('data', (d) => { const t = d.toString('utf8'); stderr += t; if (onLine) t.split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l)); });
    child.on('error', (err) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + err.message }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
  });
}

let dockerProbeCache = { at: 0, value: null };
function dockerProbe({ force = false } = {}) {
  if (!force && dockerProbeCache.value && Date.now() - dockerProbeCache.at < 15000) return dockerProbeCache.value;
  const res = spawnSync('docker', ['version', '--format', '{{json .}}'], { encoding: 'utf8', timeout: 8000 });
  const stamp = new Date().toISOString();
  let value;
  if (res.status !== 0) {
    value = { available: false, engine: null, error: (res.stderr || res.error ? String(res.error && res.error.message || res.stderr) : 'docker unavailable').trim().split('\n')[0], checkedAt: stamp };
  } else {
    try {
      const parsed = JSON.parse(res.stdout);
      value = { available: Boolean(parsed.Server), engine: parsed.Server ? parsed.Server.Version : null, apiVersion: parsed.Server ? parsed.Server.APIVersion : null, storageDriver: parsed.Server ? parsed.Server.Driver : null, error: parsed.Server ? null : 'docker CLI answered but no daemon is reachable', checkedAt: stamp };
    } catch (err) {
      value = { available: false, engine: null, error: 'docker version returned unexpected output', checkedAt: stamp };
    }
  }
  dockerProbeCache = { at: Date.now(), value };
  return value;
}

function containerName(id) { return `zenith-${String(id).replace(/[^a-zA-Z0-9_.-]/g, '-')}`; }

async function ensureImage(tag, note) {
  const have = spawnSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 15000 });
  if (have.status === 0 && have.stdout.trim()) return { ok: true, pulled: false, tag };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    note(`Pulling ${tag} (attempt ${attempt}/3)...`);
    const res = await dockerCli(['pull', tag], { timeout: 20 * 60 * 1000, onLine: (l) => { if (/^[A-Za-z].*:/.test(l)) note(`  ${l}`); } });
    if (res.code === 0) return { ok: true, pulled: true, tag, attempts: attempt };
    if (attempt === 3) throw new Error(`docker pull ${tag} failed: ${(res.stderr || res.stdout).trim().split('\n').slice(-2).join(' ')}`);
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  return { ok: false, tag };
}

async function dockerStats(name) {
  const res = await dockerCli(['stats', '--no-stream', '--format', '{{json .}}', name], { timeout: 20000 });
  if (res.code !== 0) return null;
  try {
    const raw = JSON.parse(res.stdout.trim().split('\n').filter(Boolean).pop());
    const toBytes = (t) => {
      const m = String(t || '').trim().match(/^([\d.]+)\s*([KMGTP]?i?B)?/i);
      if (!m) return 0;
      const units = { b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 1048576, gb: 1e9, gib: 1073741824 };
      return Math.round(parseFloat(m[1]) * (units[(m[2] || 'B').toLowerCase()] || 1));
    };
    const [memUsed, memLimit] = String(raw.MemUsage || '').split('/').map(toBytes);
    return { cpu: parseFloat(String(raw.CPUPerc || '0')) || 0, rss: memUsed || 0, memoryLimit: memLimit || 0, pids: parseInt(raw.PIDs, 10) || 0, netIO: raw.NetIO, blockIO: raw.BlockIO };
  } catch (_) { return null; }
}

/* ------------------------------- actions ------------------------------- */
async function provision(id, body, note) {
  const config = {
    id,
    serverType: body.serverType || 'PAPER',
    version: body.version || 'latest',
    jar: body.jar || 'server.jar',
    jarUrl: body.jarUrl || '',
    jarName: body.jarName || '',
    memory: Math.max(256, parseInt(body.memory || 2048, 10)),
    port: parseInt(body.port || 0, 10) || 0,
    ip: body.ip || '0.0.0.0',
    maxPlayers: parseInt(body.maxPlayers || 20, 10),
    onlineMode: body.onlineMode !== false,
    motd: body.motd || 'A Zenith server',
    eula: body.eula !== false,
    javaMajor: parseInt(body.javaMajor || 21, 10),
    aikarFlags: body.aikarFlags !== false,
    updatedAt: new Date().toISOString(),
  };

  config.containerRuntime = body.containerRuntime === 'docker' || (!body.containerRuntime && RUNTIME === 'docker') ? 'docker' : 'process';
  config.dockerImage = body.dockerImage || DOCKER_IMAGE;

  const dir = serverDir(id);
  fs.mkdirSync(dir, { recursive: true });

  let java = { bin: JAVA_BIN, major: config.javaMajor, managed: false };
  if (config.containerRuntime === 'docker') {
    // 1. the container image brings its own JVM - verify it is really there
    note(`Container runtime selected (image ${config.dockerImage})`);
    const probe = dockerProbe({ force: true });
    if (!probe.available) throw new Error(`docker is required for this node but is not available: ${probe.error}`);
    await ensureImage(config.dockerImage, note);
    note(`Image ready: ${config.dockerImage}`);
    config.javaBin = null;
  } else {
    // 1. JVM first - fail early with a clear message when this box cannot run the game
    note(`Checking Java ${config.javaMajor}...`);
    java = await ensureJava(config.javaMajor, note);
    config.javaBin = java.bin;
    note(`Using ${java.bin} (Java ${java.major}${java.managed ? ', node-managed' : ', system'})`);
  }

  // 2. server jar (skip when the panel only changed memory/port - same URL = same jar)
  const target = path.join(dir, config.jar);
  if (config.jarUrl && !fs.existsSync(target)) {
    note(`Downloading ${config.jarName || config.jarUrl.split('/').pop()}...`);
    await download(config.jarUrl, target, (percent) => { if (percent % 20 === 0) note(`  download: ${percent}%`); });
    note(`Downloaded ${(fs.statSync(target).size / 1048576).toFixed(1)} MB`);
  }

  // Forge/NeoForge style installers build their own launcher + libraries
  if (body.installer && fs.existsSync(target)) {
    note('Running the mod-loader installer (this takes a few minutes)...');
    let res;
    if (config.containerRuntime === 'docker') {
      // run the installer inside the image so the container's JVM matches the game
      const run = spawnSync('docker', ['run', '--rm', '-w', '/data', '-v', `${dir}:/data`, config.dockerImage,
        'java', '-jar', path.basename(target), '--installServer', '/data'], { encoding: 'utf8', timeout: 45 * 60 * 1000 });
      res = { status: run.status, stdout: run.stdout, stderr: run.stderr };
    } else {
      res = spawnSync(config.javaBin, ['-jar', path.basename(target), '--installServer', dir], { cwd: dir, encoding: 'utf8' });
    }
    const out = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').slice(-4).join('\n');
    if (res.status !== 0) throw new Error(`installer failed: ${out}`);
    const launcher = fs.readdirSync(dir).find((f) => /^(forge|neoforge).*\.jar$/.test(f));
    if (launcher) { config.jar = launcher; note(`Launcher jar: ${launcher}`); }
    else if (fs.existsSync(path.join(dir, 'run.sh'))) { config.jar = 'run.sh'; fs.chmodSync(path.join(dir, 'run.sh'), 0o755); note('Launcher script: run.sh'); }
  }

  // 3. eula + server.properties so the server boots unattended
  fs.writeFileSync(path.join(dir, 'eula.txt'), `# Written by the Zenith node agent\neula=${config.eula ? 'true' : 'false'}\n`);
  const props = [
    `motd=${config.motd}`,
    `server-port=${config.port}`,
    `server-ip=${config.ip}`,
    `max-players=${config.maxPlayers}`,
    `online-mode=${config.onlineMode ? 'true' : 'false'}`,
    'gamemode=survival',
    'difficulty=easy',
    'pvp=true',
    'spawn-protection=16',
    'view-distance=10',
    'simulation-distance=10',
    `query.port=${config.port}`,
    'enable-rcon=false',
    'sync-chunk-writes=false',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'server.properties'), props);
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });

  if (config.containerRuntime === 'docker') {
    // (re)create the container now so `start` is instant and errors surface here
    const name = containerName(id);
    const existing = spawnSync('docker', ['inspect', name, '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 15000 });
    if (existing.status === 0) { spawnSync('docker', ['rm', '-f', '-v', name], { encoding: 'utf8', timeout: 30000 }); note('Replaced the previous container'); }
    const args = ['create', '--name', name, '-i', '-w', '/data', '-v', `${dir}:/data`,
      '--memory', `${config.memory + DOCKER_OVERHEAD_MB}m`, '--memory-swap', `${config.memory + DOCKER_OVERHEAD_MB}m`, '--restart', 'no'];
    if (config.port) args.push('-p', `${config.port}:${config.port}/tcp`, '-p', `${config.port}:${config.port}/udp`);
    if (body.cpuCores) args.push('--cpus', String(body.cpuCores));
    args.push('-e', 'HOME=/data', config.dockerImage);
    const jvm = [`-Xms${Math.min(config.memory, 512)}M`, `-Xmx${config.memory}M`];
    if (config.aikarFlags !== false) jvm.push(...AIKAR_FLAGS);
    jvm.push('-jar', path.basename(config.jar), 'nogui');
    args.push('java', ...jvm);
    const created = await dockerCli(args, { timeout: 60000 });
    if (created.code !== 0) throw new Error(`docker create failed: ${(created.stderr || created.stdout).trim().split('\n').slice(-2).join(' ')}`);
    note(`Container ${name} created (image ${config.dockerImage}, ${config.memory} MB + ${DOCKER_OVERHEAD_MB} MB overhead, port ${config.port})`);
  }

  saveConfig(id, config);
  const entry = entryFor(id);
  entry.config = config;
  note(`Provisioned in ${dir}`);
  return { config, dir, jar: config.jar, java: config.javaBin || null, javaMajor: config.javaMajor, containerRuntime: config.containerRuntime, dockerImage: config.containerRuntime === 'docker' ? config.dockerImage : null, diskUsed: dirSize(dir) };
}

function startServer(id, note = () => {}) {
  const entry = entryFor(id);
  if (entry.proc) throw Object.assign(new Error('already running'), { status: 409 });
  const config = entry.config || loadConfig(id);
  if (!config) throw Object.assign(new Error('server is not provisioned on this node'), { status: 409 });
  const dir = serverDir(id);
  const target = path.join(dir, config.jar || 'server.jar');
  if (!fs.existsSync(target)) throw Object.assign(new Error(`jar not found on the node (${config.jar}) - reinstall the software`), { status: 409 });

  const memory = Math.max(256, parseInt(config.memory || 2048, 10));
  const args = [`-Xms${Math.min(memory, 512)}M`, `-Xmx${memory}M`];
  if (config.aikarFlags !== false) args.push(...AIKAR_FLAGS);
  if (config.extraArgs) args.push(...String(config.extraArgs).split(/\s+/).filter(Boolean));

  let bin = config.javaBin || JAVA_BIN;
  if (config.javaMajor && !fs.existsSync(bin)) bin = JAVA_BIN;

  let proc;
  if (config.containerRuntime === 'docker') {
    const probe = dockerProbe({ force: true });
    if (!probe.available) throw Object.assign(new Error(`docker is not available on this node: ${probe.error}`), { status: 409 });
    const name = containerName(id);
    const inspect = spawnSync('docker', ['inspect', name, '--format', '{{.State.Running}}'], { encoding: 'utf8', timeout: 15000 });
    if (inspect.status !== 0) throw Object.assign(new Error(`container ${name} does not exist - re-provision this server`), { status: 409 });
    proc = spawn('docker', ['start', '-a', '-i', name], { stdio: ['pipe', 'pipe', 'pipe'] });
    args.push(`(container ${name} -> ${config.dockerImage})`);
  } else if ((config.jar || '').endsWith('.sh')) {
    proc = spawn('bash', [path.basename(config.jar)], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    args.push('-jar', path.basename(config.jar), 'nogui');
    proc = spawn(bin, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: dir } });
  }

  entry.proc = proc;
  entry.ready = false;
  entry.exitCode = null;
  entry.startedAt = Date.now();
  note(`Launched ${bin} ${args.join(' ')}`);

  proc.stdout.on('data', (d) => pushLog(id, d.toString('utf8')));
  proc.stderr.on('data', (d) => pushLog(id, d.toString('utf8')));
  proc.stdin.on('error', () => {});
  proc.on('error', (err) => { pushLog(id, `[agent] failed to launch: ${err.message}`); entry.exitCode = -1; });
  proc.on('exit', (code, signal) => {
    pushLog(id, `[agent] process exited (code ${code}${signal ? `, signal ${signal}` : ''})`);
    entry.proc = null;
    entry.exitCode = code;
    entry.startedAt = null;
    alog(`server ${id} exited (code ${code})`);
  });
  return { pid: proc.pid, memory, jar: config.jar, bin };
}

function stopServer(id, { force = false } = {}) {
  const entry = entryFor(id);
  if (!entry.proc && !(entry.config || {}).containerRuntime) return { ok: true, alreadyStopped: true };
  if ((entry.config || {}).containerRuntime === 'docker') {
    const name = containerName(id);
    try { if (entry.proc) entry.proc.stdin.write('stop\n'); } catch (_) {}
    const proc = entry.proc;
    setTimeout(() => {
      if (entry.proc === proc) {
        spawnSync('docker', ['stop', '-t', force ? '3' : '15', name], { encoding: 'utf8', timeout: 30000 });
        spawnSync('docker', ['kill', name], { encoding: 'utf8', timeout: 15000 });
      }
    }, force ? 500 : 1000);
    return { ok: true, stopping: true, container: name };
  }
  try { entry.proc.stdin.write('stop\n'); } catch (_) {}
  const proc = entry.proc;
  setTimeout(() => { try { if (entry.proc === proc) proc.kill('SIGKILL'); } catch (_) {} }, force ? 3000 : 20000);
  return { ok: true, stopping: true };
}

function serverStatus(id) {
  const entry = entryFor(id);
  let rss = null;
  if (entry.proc && process.platform === 'linux') {
    try {
      const statm = fs.readFileSync(`/proc/${entry.proc.pid}/statm`, 'utf8').trim().split(/\s+/);
      rss = parseInt(statm[1], 10) * 4096;
    } catch (_) {}
  } else if (entry.proc) {
    const res = spawnSync('ps', ['-o', 'rss=', '-p', String(entry.proc.pid)], { encoding: 'utf8' });
    rss = res.stdout ? parseInt(res.stdout.trim(), 10) * 1024 : null;
  }
  return {
    id,
    running: Boolean(entry.proc),
    pid: entry.proc ? entry.proc.pid : null,
    status: entry.proc ? (entry.ready ? 'running' : 'starting') : (entry.exitCode ? 'stopped' : 'offline'),
    ready: entry.ready,
    exitCode: entry.exitCode,
    startedAt: entry.startedAt ? new Date(entry.startedAt).toISOString() : null,
    uptimeMs: entry.startedAt ? Date.now() - entry.startedAt : 0,
    rss,
    diskUsed: fs.existsSync(serverDir(id)) ? dirSize(serverDir(id)) : 0,
    memoryLimit: (entry.config || {}).memory || null,
    restartCount: entry.restarts || 0,
    logSeq: entry.seq,
  };
}

function freePort(start, end) {
  return new Promise((resolve) => {
    const from = parseInt(start || '25565', 10);
    const to = parseInt(end || String(from + 100), 10);
    let port = from;
    const attempt = () => {
      if (port > to) return resolve(null);
      const probe = net.createServer();
      probe.once('error', () => { port += 1; setTimeout(attempt, 1); });
      probe.once('listening', () => probe.close(() => resolve(port)));
      try { probe.listen(port, '0.0.0.0'); } catch (_) { port += 1; setTimeout(attempt, 1); }
    };
    attempt();
  });
}

/* -------------------------------- router -------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (!url.pathname.startsWith('/api/node/')) return json(res, 404, { error: 'not found' });
  if (!auth(req)) return json(res, 401, { error: 'bad node token' });

  if (url.pathname === '/api/node/status') return json(res, 200, hostStatus());
  if (url.pathname === '/api/node/events') return json(res, 200, { events: tail(events, 100) });

  if (url.pathname === '/api/node/servers') {
    return json(res, 200, {
      servers: [...servers.keys()].map((id) => ({ ...serverStatus(id), diskUsed: dirSize(serverDir(id)) })),
    });
  }

  if (url.pathname === '/api/node/ports') {
    try {
      const port = await freePort(url.searchParams.get('start'), url.searchParams.get('end'));
      if (!port) return json(res, 409, { error: 'no free port in range' });
      return json(res, 200, { port });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (parts[2] === 'servers' && parts[3]) {
    const id = parts[3];
    const action = parts[4];

    try {
      if (action === 'provision' && req.method === 'POST') {
        const body = await readBody(req);
        const notes = [];
        const result = await provision(id, body, (m) => { notes.push(m); alog(`${id}: ${m}`); });
        return json(res, 200, { ok: true, ...result, notes });
      }

      if (action === 'status') return json(res, 200, serverStatus(id));

      if (action === 'logs') {
        const entry = entryFor(id);
        const since = parseInt(url.searchParams.get('since') || '0', 10);
        if (since > 0) {
          const fresh = entry.seq - since;
          return json(res, 200, { lines: fresh > 0 ? tail(entry.logs, fresh) : [], seq: entry.seq });
        }
        return json(res, 200, { lines: tail(entry.logs, 400), seq: entry.seq });
      }

      if (action === 'start' && req.method === 'POST') {
        const notes = [];
        const result = startServer(id, (m) => { notes.push(m); pushLog(id, `[agent] ${m}`); });
        alog(`${id} started (pid ${result.pid})`);
        return json(res, 200, { ok: true, ...result, notes });
      }

      if (action === 'stop' && req.method === 'POST') {
        const body = await readBody(req);
        const result = stopServer(id, { force: body.force });
        alog(`${id} stop requested`);
        return json(res, 200, result);
      }

      if (action === 'kill' && req.method === 'POST') {
        const entry = entryFor(id);
        if (entry.proc) entry.proc.kill('SIGKILL');
        return json(res, 200, { ok: true });
      }

      if (action === 'file' && req.method === 'POST') {
        // used by the panel's Modrinth tab to drop a plugin/mod jar on this node
        const body = await readBody(req);
        const dirRel = String(body.dir || 'plugins').replace(/^\.?\/+/, '');
        const filename = path.basename(String(body.filename || ''));
        if (!body.url || !filename) return json(res, 400, { error: 'url and filename are required' });
        const dir = path.join(serverDir(id), dirRel);
        if (!dir.startsWith(serverDir(id))) return json(res, 400, { error: 'bad path' });
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, filename);
        if (fs.existsSync(target) && body.backup !== false) fs.renameSync(target, `${target}.bak`);
        const notes = [];
        notes.push(`Downloading ${filename}...`);
        await download(body.url, target, (p2) => { if (p2 % 25 === 0) notes.push(`  ${filename}: ${p2}%`); });
        const stat = fs.statSync(target);
        notes.push(`Saved ${filename} (${(stat.size / 1048576).toFixed(2)} MB) to ${dirRel}/`);
        alog(`${id}: installed ${filename} into ${dirRel}/`);
        return json(res, 200, { ok: true, path: target, size: stat.size, dir: dirRel, filename, notes });
      }

      if (action === 'file' && req.method === 'DELETE') {
        const body = await readBody(req);
        const dirRel = String(body.dir || 'plugins').replace(/^\.?\/+/, '');
        const filename = path.basename(String(body.filename || ''));
        const target = path.join(serverDir(id), dirRel, filename);
        if (!target.startsWith(serverDir(id))) return json(res, 400, { error: 'bad path' });
        const existed = fs.existsSync(target);
        fs.rmSync(target, { force: true });
        alog(`${id}: removed ${dirRel}/${filename}`);
        return json(res, 200, { ok: true, removed: existed ? filename : null });
      }

      if (action === 'files' && req.method === 'GET') {
        const dirRel = String(url.searchParams.get('dir') || 'plugins').replace(/^\.?\/+/, '');
        const dir = path.join(serverDir(id), dirRel);
        if (!dir.startsWith(serverDir(id))) return json(res, 400, { error: 'bad path' });
        const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
          const st = fs.statSync(path.join(dir, e.name));
          return { name: e.name, size: st.size, modified: st.mtime.toISOString(), directory: e.isDirectory() };
        }) : [];
        return json(res, 200, { dir: dirRel, entries });
      }

      if (action === 'archive' && req.method === 'POST') {
        const body = await readBody(req);
        const entry = entryFor(id);
        const dir = serverDir(id);
        if (!fs.existsSync(dir)) return json(res, 404, { error: 'server directory does not exist' });
        const store = path.join(ROOT, '.archives', id);
        fs.mkdirSync(store, { recursive: true });
        const name = String(body.name || `backup-${Date.now()}`).replace(/[^\w.-]+/g, '_');
        const target = path.join(store, name.endsWith('.zip') ? name : `${name}.zip`);
        const ignores = ['-x', '.playit/*', 'logs/*.gz'];

        let ok = false;
        const zipped = spawnSync('zip', ['-r', '-q', '-1', target, '.', ...ignores], { cwd: dir, encoding: 'utf8' });
        if (zipped.status === 0) ok = true;
        let usedZip = ok;
        if (!ok) {
          // no zip on this box: fall back to a tarball
          const tarTarget = target.replace(/\.zip$/, '.tar.gz');
          const tarred = spawnSync('tar', ['-czf', tarTarget, '--exclude=.playit', '--exclude=logs/*.gz', '.'], { cwd: dir, encoding: 'utf8' });
          if (tarred.status !== 0) return json(res, 500, { error: `archive failed: ${(zipped.stderr || tarred.stderr || '').slice(0, 300)}` });
          const stat = fs.statSync(tarTarget);
          return json(res, 200, { ok: true, path: tarTarget, filename: path.basename(tarTarget), size: stat.size, format: 'tar.gz' });
        }
        const stat = fs.statSync(target);
        return json(res, 200, { ok: true, path: target, filename: path.basename(target), size: stat.size, format: usedZip ? 'zip' : 'tar.gz' });
      }

      if (action === 'archive' && req.method === 'GET') {
        const file = url.searchParams.get('path') || '';
        if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'archive not found' });
        const stat = fs.statSync(file);
        res.writeHead(200, {
          'Content-Type': file.endsWith('.zip') ? 'application/zip' : 'application/gzip',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
        });
        fs.createReadStream(file).pipe(res);
        return;
      }

      if (action === 'archive' && req.method === 'DELETE') {
        const body = await readBody(req);
        if (body.path) fs.rmSync(body.path, { force: true });
        return json(res, 200, { ok: true });
      }

      if (action === 'restore' && req.method === 'POST') {
        // raw body upload (application/octet-stream) of a .zip/.tar.gz the panel holds
        const dir = serverDir(id);
        const tmp = path.join(ROOT, '.archives', id, `restore-${Date.now()}.zip`);
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(tmp);
          req.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        });
        const isTar = (req.headers['x-archive-format'] || 'zip') === 'tar.gz';
        const target = isTar ? tmp.replace(/\.zip$/, '.tar.gz') : tmp;
        if (isTar) fs.renameSync(tmp, target);
        // wipe the previous files (keep the config + property file the panel owns)
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const res2 = isTar ? spawnSync('tar', ['-xzf', target, '-C', dir]) : spawnSync('unzip', ['-o', '-q', target, '-d', dir]);
        if (res2.status !== 0) {
          // unzip may be missing on tiny images - give the operator a clear message
          return json(res, 500, { error: `extract failed (${res2.stderr ? String(res2.stderr).slice(0, 200) : 'unzip/tar unavailable'})` });
        }
        fs.rmSync(target, { force: true });
        // keep the staging folder from growing on the node
        try {
          const store = path.join(ROOT, '.archives', id);
          for (const f of fs.readdirSync(store)) {
            const p2 = path.join(store, f);
            if (Date.now() - fs.statSync(p2).mtimeMs > 3600e3) fs.rmSync(p2, { force: true });
          }
        } catch (_) {}
        const config = loadConfig(id) || {};
        saveConfig(id, config);
        entryFor(id).config = config;
        return json(res, 200, { ok: true, restored: path.basename(target), diskUsed: dirSize(dir) });
      }

      if (action === 'command' && req.method === 'POST') {
        const { command } = await readBody(req);
        const entry = entryFor(id);
        if (!entry.proc) return json(res, 409, { error: 'server is not running' });
        if (!command) return json(res, 400, { error: 'empty command' });
        entry.proc.stdin.write(`${command}\n`);
        pushLog(id, `> ${command}`);
        return json(res, 200, { ok: true });
      }

      if (action === 'config' && req.method === 'POST') {
        const patch = await readBody(req);
        const entry = entryFor(id);
        const config = saveConfig(id, { ...(entry.config || loadConfig(id) || {}), ...patch, updatedAt: new Date().toISOString() });
        entry.config = config;
        return json(res, 200, { ok: true, config });
      }

      if (!action && req.method === 'DELETE') {
        const entry = entryFor(id);
        if (entry.proc) { try { entry.proc.kill('SIGKILL'); } catch (_) {} }
        servers.delete(id);
        fs.rmSync(serverDir(id), { recursive: true, force: true });
        alog(`${id} deleted`);
        return json(res, 200, { ok: true, removed: id });
      }

      return json(res, 404, { error: `unknown action ${action || '(none)'}` });
    } catch (err) {
      alog(`${id} ${action} failed: ${err.message}`);
      return json(res, err.status || 500, { error: err.message });
    }
  }

  return json(res, 404, { error: 'not found' });
});

/* ------------------------------- lifecycle ------------------------------- */
server.listen(PORT, '0.0.0.0', async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  alog(`listening on :${PORT} | data: ${ROOT} | java: ${JAVA_BIN} (major ${javaMajor(JAVA_BIN) || 'unknown'})`);
  alog('endpoints: status, servers, ports, provision, start/stop/kill/command, logs, archive, restore');
  if (!TOKEN) alog('WARNING: no ZENITH_NODE_TOKEN set - the panel cannot reach this node');

  // adopt servers that were left in the config from a previous agent run
  for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    const config = loadConfig(dir.name);
    if (config) { const e = entryFor(dir.name); e.config = config; }
  }

  // report what the container runtime really is (never assumed)
  const probe = dockerProbe({ force: true });
  alog(probe.available ? `docker available (engine ${probe.engine}, default image ${DOCKER_IMAGE})` : `docker not available: ${probe.error}`);

  // a container that was still running when the agent restarted keeps running -
  // say so honestly and let the panel decide what to do with it
  if (probe.available) {
    const ps = spawnSync('docker', ['ps', '--filter', 'name=zenith-', '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 15000 });
    const names = String(ps.stdout || '').split('\n').filter(Boolean);
    if (names.length) alog(`found ${names.length} existing zenith container(s): ${names.join(', ')}`);
  }

  if (PANEL_URL && TOKEN) {
    const beat = async () => {
      try {
        const res = await fetch(`${PANEL_URL}/api/nodes/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-node-token': TOKEN },
          body: JSON.stringify({ token: TOKEN, name: AGENT_NAME, fqdn: os.hostname(), stats: hostStatus() }),
        });
        if (!res.ok) alog(`heartbeat rejected: HTTP ${res.status}`);
      } catch (err) {
        alog(`heartbeat failed: ${err.message}`);
      }
    };
    beat();
    setInterval(beat, 30000);
  }
});

function shutdown(signal) {
  alog(`${signal} received - stopping ${[...servers.values()].filter((s) => s.proc).length} server(s)`);
  for (const entry of servers.values()) {
    if (entry.proc) { try { entry.proc.stdin.write('stop\n'); } catch (_) {} }
  }
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
