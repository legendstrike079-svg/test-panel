#!/usr/bin/env node
'use strict';
/**
 * TEST DOUBLE - not part of the panel runtime.
 *
 * Creates a throwaway directory containing a `docker` executable that behaves
 * like the real CLI for the subset the panel uses, so the Docker backend can be
 * exercised on a machine without Docker installed (CI, the dev sandbox, ...).
 *
 *   node scripts/fake-docker.js --print-path        # create + print the bin dir
 *   PATH="$(node scripts/fake-docker.js)":$PATH node server.js
 *
 * Every state change is written to real files under the fake root, and
 * `start -a -i` really spawns a process that prints a boot log and answers
 * commands on stdin, so the panel's console pipeline is genuinely tested.
 * The panel never ships or calls this file; it exists purely for tests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.FAKE_DOCKER_ROOT || path.join(os.tmpdir(), 'zenith-fake-docker');
const BIN = path.join(ROOT, 'bin');
const STATE = path.join(ROOT, 'state');

fs.mkdirSync(BIN, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });

const shim = `#!/usr/bin/env node
'use strict';
/* fake docker CLI - see scripts/fake-docker.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.FAKE_DOCKER_ROOT || ${JSON.stringify(ROOT)};
const STATE = path.join(ROOT, 'state');
const IMAGES = JSON.parse(process.env.FAKE_DOCKER_IMAGES || '["eclipse-temurin:21-jre","eclipse-temurin:17-jre","eclipse-temurin:8-jre","ubuntu:22.04","ubuntu:20.04","debian:12","debian:11","python:3.12-slim","node:20-bookworm-slim","cm2network/steamcmd:latest"]');
const FAIL_PULL = process.env.FAKE_DOCKER_FAIL_PULL === '1';
// images "pulled" during this run are remembered, exactly like a daemon would
function localImages() {
  try { return IMAGES.concat(JSON.parse(fs.readFileSync(path.join(STATE, 'images.json'), 'utf8'))); }
  catch (_) { return IMAGES.slice(); }
}
const NO_DAEMON = process.env.FAKE_DOCKER_NO_DAEMON === '1';

const args = process.argv.slice(2);
const cmd = args[0];
function out(s) { process.stdout.write(String(s).endsWith('\\n') ? s : s + '\\n'); }
function err(s) { process.stderr.write(String(s).endsWith('\\n') ? s : s + '\\n'); }
function fail(message, code = 1) { err(message); process.exit(code); }
function containerFile(name) { return path.join(STATE, 'containers', name + '.json'); }
function networkFile(name) { return path.join(STATE, 'networks', name + '.json'); }
function read(name) { try { return JSON.parse(fs.readFileSync(containerFile(name), 'utf8')); } catch (_) { return null; } }
function readNetwork(name) { try { return JSON.parse(fs.readFileSync(networkFile(name), 'utf8')); } catch (_) { return null; } }
function write(name, data) { fs.mkdirSync(path.dirname(containerFile(name)), { recursive: true }); fs.writeFileSync(containerFile(name), JSON.stringify(data, null, 2)); }
function writeNetwork(name, data) { fs.mkdirSync(path.dirname(networkFile(name)), { recursive: true }); fs.writeFileSync(networkFile(name), JSON.stringify(data, null, 2)); }

if (cmd !== 'version' && cmd !== 'info' && cmd !== 'pull' && cmd !== 'images' && NO_DAEMON) {
  fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
}

switch (cmd) {
  case 'version': {
    const fmt = args[2] || '';
    const payload = { Client: { Version: '27.0.0-fake', ApiVersion: '1.46', Os: 'linux', Arch: 'amd64' }, Server: { Version: '27.0.0-fake', ApiVersion: '1.46', Os: 'linux', Arch: 'amd64', Driver: 'overlayfs-fake' } };
    out(fmt.includes('json') ? JSON.stringify(payload) : 'Client: 27.0.0-fake\\nServer: 27.0.0-fake');
    process.exit(0);
  }
  case 'info': {
    out(JSON.stringify({
      ServerVersion: '27.0.0-fake', Driver: 'overlayfs-fake', DockerRootDir: path.join(ROOT, 'data'),
      NCPU: require('os').cpus().length, MemTotal: require('os').totalmem(), Containers: fs.existsSync(path.join(STATE, 'containers')) ? fs.readdirSync(path.join(STATE, 'containers')).length : 0,
      ContainersRunning: 0, Images: localImages().length, OperatingSystem: 'Fake Linux', KernelVersion: require('os').release(), Architecture: require('os').arch(),
    }));
    process.exit(0);
  }
  case 'pull': {
    const tag = args[1];
    if (FAIL_PULL) fail('Error response from daemon: pull access denied for ' + tag + ', repository does not exist or may require docker login');
    // a registry only has what it has: unknown repositories fail like the real thing
    if (!IMAGES.includes(tag) && !localImages().includes(tag)) {
      fail('Error response from daemon: pull access denied for ' + tag + ', repository does not exist or may require docker login');
    }
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, 'images.json'), JSON.stringify([...new Set(localImages().concat([tag]))]));
    out('Pulling from ' + tag);
    out('Digest: sha256:' + 'a'.repeat(64));
    out('Status: Downloaded newer image for ' + tag);
    process.exit(0);
  }
  case 'run': {
    // SteamCMD installer jobs are short lived. The double does not download a
    // game, but preserves the successful real-CLI contract so runtime tests can
    // exercise progress/status paths without network-heavy Steam installs.
    const image = args.find((arg) => String(arg).startsWith('cm2network/steamcmd:'));
    if (!image) fail('fake docker run supports SteamCMD installer jobs only');
    const appAt = args.indexOf('+app_update');
    const appId = appAt >= 0 ? args[appAt + 1] : 'unknown';
    out('SteamCMD fake installer: app ' + appId + ' installed into /data');
    process.exit(0);
  }
  case 'network': {
    const sub = args[1];
    if (sub === 'inspect') {
      const name = args.find((a, i) => i > 1 && !a.startsWith('-') && a !== '{{.Id}}') || args[2];
      const network = readNetwork(name);
      if (!network) fail('Error response from daemon: network ' + name + ' not found');
      const formatAt = args.indexOf('--format');
      if (formatAt !== -1 && args[formatAt + 1] === '{{.Id}}') out(network.id);
      else out(JSON.stringify({ Id: network.id, Name: network.name, Driver: 'bridge', Internal: false }));
      process.exit(0);
    }
    if (sub === 'create') {
      const name = args[args.length - 1];
      if (readNetwork(name)) { out(readNetwork(name).id); process.exit(0); }
      const id = require('crypto').randomBytes(32).toString('hex');
      writeNetwork(name, { id, name, driver: 'bridge' });
      out(id); process.exit(0);
    }
    if (sub === 'rm') {
      const name = args[2];
      if (!readNetwork(name)) fail('Error response from daemon: network ' + name + ' not found');
      fs.unlinkSync(networkFile(name)); out(name); process.exit(0);
    }
    fail('fake docker network supports inspect/create/rm only');
  }
  case 'image': {
    const tag = args[2];
    if (localImages().includes(tag)) { out('sha256:' + 'b'.repeat(64)); process.exit(0); }
    fail('Error response from daemon: No such image: ' + tag);
  }
  case 'images': {
    for (const tag of [...new Set(localImages())]) out(JSON.stringify({ Repository: tag.split(':')[0], Tag: tag.split(':')[1], ID: 'sha256:' + 'b'.repeat(64), Size: '420MB' }));
    process.exit(0);
  }
  case 'inspect': {
    // Real docker accepts flags before the name too:
    //   docker inspect -f '{{.State.Running}}' zenith-x
    // so this double does as well, and it resolves --format templates for the
    // fields the panel and the tests actually ask for.
    let name = null; let format = null;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === '-f' || a === '--format') { format = args[++i]; continue; }
      if (a.startsWith('--format=')) { format = a.slice('--format='.length); continue; }
      if (a.startsWith('-')) continue;
      if (!name) name = a;
    }
    const c = read(name);
    if (!c) fail('Error: No such object: ' + name);
    const doc = {
      Id: c.id, Name: '/' + name, Config: { Image: c.image, Cmd: c.command, Entrypoint: c.entrypoint || null, Hostname: c.hostname || name },
      State: { Running: Boolean(c.running), Status: c.running ? 'running' : (c.exitCode ? 'exited' : 'created'), ExitCode: c.exitCode || 0, StartedAt: c.startedAt || null, FinishedAt: c.finishedAt || null, Error: '' },
      HostConfig: { Memory: c.memoryMb * 1024 * 1024, MemorySwap: c.memoryMb * 1024 * 1024, NanoCpus: c.cpuCores ? Math.round(c.cpuCores * 1e9) : 0, PidsLimit: c.pidsLimit || 0, PidMode: c.pidMode || '', UTSMode: c.utsMode || '', IpcMode: c.ipcMode || '', NetworkMode: c.network || 'default', Privileged: false, SecurityOpt: c.securityOpt || [], CapDrop: c.capDrop || [], Dns: c.dns || [], PortBindings: c.ports },
      Mounts: (c.mounts || []).map((mount) => ({ Type: 'bind', Source: mount.source, Destination: mount.destination, RW: true, Propagation: mount.propagation || 'rprivate' })),
      GraphDriver: { Name: 'overlayfs-fake', Data: { LowerDir: '/fake/image', UpperDir: '/fake/container/' + c.id } },
      NetworkSettings: { Ports: Object.fromEntries((c.ports || []).map((p) => [p + '/tcp', [{ HostIp: '0.0.0.0', HostPort: String(p) }]])) },
    };
    if (!format) { out(JSON.stringify(doc)); process.exit(0); }
    if (format === '{{json .}}' || format === 'json') { out(JSON.stringify(doc)); process.exit(0); }
    if (format === '{{json .Config.Cmd}}') { out(JSON.stringify(doc.Config.Cmd)); process.exit(0); }
    const resolved = format.replace(/\{\{\s*\.([A-Za-z0-9_.]+)\s*\}\}/g, (_, pathStr) => {
      const value = pathStr.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), doc);
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
    if (/\{\{/.test(resolved)) fail('template parsing error: unsupported format ' + format);
    out(resolved);
    process.exit(0);
  }
  case 'create': {
    let name = null, image = null, memoryMb = 0, cpuCores = 0, ports = [], command = [], env = {}, hostname = '', network = 'default', pidMode = '', utsMode = '', ipcMode = '', pidsLimit = 0, securityOpt = [], capDrop = [], dns = [], entrypoint = null;
    const mounts = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === '--name') name = args[++i];
      else if (a === '--memory' || a === '--memory-swap') { const v = args[++i]; if (a === '--memory') memoryMb = parseInt(v, 10) || 0; }
      else if (a === '--cpus') cpuCores = parseFloat(args[++i]) || 0;
      else if (a === '--hostname') hostname = args[++i];
      else if (a === '--network') network = args[++i];
      else if (a === '--dns') dns.push(args[++i]);
      else if (a === '--pid') { pidMode = args[++i]; if (pidMode === 'private') fail("docker: --pid: invalid PID mode. Run 'docker create --help' for more information"); }
      else if (a === '--uts') utsMode = args[++i];
      else if (a === '--ipc') ipcMode = args[++i];
      else if (a === '--pids-limit') pidsLimit = parseInt(args[++i], 10) || 0;
      else if (a === '--security-opt') securityOpt.push(args[++i]);
      else if (a === '--cap-drop') capDrop.push(args[++i]);
      else if (a === '--mount') { const parts = args[++i].split(','); const values = Object.fromEntries(parts.map((part) => { const at = part.indexOf('='); return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)]; })); mounts.push({ source: values.src || values.source || '', destination: values.dst || values.target || '', propagation: values['bind-propagation'] || 'rprivate' }); }
      else if (a === '-p') ports.push(parseInt(args[++i].split(':')[0], 10));
      else if (a === '-v') { const volume = args[++i]; const [source, destination] = volume.split(':'); mounts.push({ source, destination, propagation: 'rprivate' }); }
      else if (a === '--entrypoint') entrypoint = args[++i];
      else if (a === '-e' || a === '-w' || a === '--user') args[++i];
      else if (a === '-i' || a === '-t' || a === '--rm') { }
      else if (a === '--restart') i++;
      else if (!image && !a.startsWith('-')) image = a;
      else if (image) command.push(a);
    }
    if (!name) fail('"docker create" requires a --name argument');
    const dir = mounts[0] ? mounts[0].source : '';
    if (dir && !fs.existsSync(dir)) fail('Error response from daemon: invalid mount config: bind source path does not exist: ' + dir);
    const genericWorkload = command.some((part) => String(part).includes('sleep infinity'));
    const botWorkload = command.some((part) => String(part).includes('[Zenith bot]'));
    const gameWorkload = command.some((part) => String(part).includes('.zenith-game-start.sh'));
    const target = path.join(dir, (command.find((c) => c.endsWith('.jar')) || 'server.jar'));
    if (!genericWorkload && !botWorkload && !gameWorkload && !fs.existsSync(target)) fail('Error response from daemon: OCI runtime create failed: exec: "' + (command[command.indexOf('-jar') + 1] || 'server.jar') + '": stat ' + (command[command.indexOf('-jar') + 1] || 'server.jar') + ': no such file or directory');
    const id = require('crypto').randomBytes(32).toString('hex');
    write(name, { name, id, image, memoryMb, cpuCores, ports, command, entrypoint, env, dir, mounts, hostname, network, pidMode, utsMode, ipcMode, pidsLimit, securityOpt, capDrop, dns, created: new Date().toISOString(), running: false, exitCode: null });
    out(id);
    process.exit(0);
  }
  case 'exec': {
    // docker exec -i -w /data <name> /bin/sh -lc <command>
    const marker = args.indexOf('/bin/sh');
    const name = marker > 0 ? args[marker - 1] : null;
    const command = marker > 0 ? args.slice(marker + 2).join(' ') : '';
    const c = read(name);
    if (!c) fail('Error response from daemon: No such container: ' + name);
    if (!c.running) fail('Error response from daemon: container ' + name + ' is not running');
    if (command.includes('OS_PRETTY_NAME') || command.includes('MEMORY_LIMIT') || command.includes('os-release')) {
      const image = String(c.image || '');
      const ubuntu = image.startsWith('ubuntu:');
      const id = ubuntu ? 'ubuntu' : 'debian';
      const version = ubuntu ? image.split(':')[1] : (image.includes('debian:11') ? '11' : '12');
      out('HOSTNAME=' + (c.hostname || name));
      out('OS_ID=' + id);
      out('OS_VERSION_ID=' + version);
      out('OS_PRETTY_NAME=' + (ubuntu ? 'Ubuntu ' + version : 'Debian GNU/Linux ' + version));
      out('MEMORY_LIMIT=' + (c.memoryMb * 1024 * 1024));
      out('CPU_LIMIT=' + (c.cpuCores ? Math.round(c.cpuCores * 100000) + ' 100000' : 'max 100000'));
    }
    else if (/^pwd\s*$/.test(command)) out('/data');
    else if (/^echo\s+/.test(command)) out(command.replace(/^echo\s+/, '').replace(/^['"]|['"]$/g, ''));
    else if (/python(?:3)?\\s+--version/.test(command)) out('Python 3.12.0-fake');
    else if (/node\\s+--version/.test(command)) out('v20.0.0-fake');
    else if (/git\\s+--version/.test(command)) out('git version 2.43.0-fake');
    else if (/^false\s*$/.test(command)) fail('command exited with status 1');
    else out('[fake-container exec] ' + command);
    process.exit(0);
  }
  case 'start':
  case 'attach': {
    // The panel uses the real Docker lifecycle in two explicit stages:
    // docker start confirms a running container before docker attach -i
    // streams logs/stdin. Preserve both contracts in the test double.
    // The real docker attach command uses stdin by default and rejects
    // the -i short flag; only docker start accepts it. Keep the shim strict
    // so a broken attachment argument cannot pass runtime regression tests.
    if (cmd === 'attach' && args.includes('-i')) fail("unknown shorthand flag: 'i' in -i\\nUsage:  docker attach [OPTIONS] CONTAINER");
    const attach = cmd === 'attach' || args.includes('-a') || args.includes('-i');
    const name = args[args.length - 1];
    const c = read(name);
    if (!c) fail('Error response from daemon: No such container: ' + name);
    if (cmd === 'start') {
      c.running = true; c.startedAt = new Date().toISOString(); c.exitCode = null;
      write(name, c);
    } else if (!c.running) {
      fail('Error response from daemon: container ' + name + ' is not running');
    }
    if (!attach) { out(name); process.exit(0); }

    // The payload: the real java command cannot run (no jar/JVM in tests), so the
    // shim runs a tiny stand-in that speaks the Minecraft console protocol, reads
    // stdin and honours "stop" - enough to test the panel's console pipeline.
    const genericWorkload = (c.command || []).some((part) => String(part).includes('sleep infinity'));
    const botWorkload = (c.command || []).some((part) => String(part).includes('[Zenith bot]'));
    const gameWorkload = (c.command || []).some((part) => String(part).includes('.zenith-game-start.sh'));
    const boot = genericWorkload ? [
      '[fake-container] mount ' + c.dir + ' -> /data',
      '[fake-container] ' + (c.command || []).join(' '),
      'Container supervisor started; SSHX browser session starting.',
      'https://sshx.io/s/fake-' + name,
    ] : botWorkload ? [
      '[fake-container] mount ' + c.dir + ' -> /data',
      '[Zenith bot] Dependencies installed from the managed bot profile',
      '[Zenith bot] Bot process started; application logs stream here.',
    ] : gameWorkload ? [
      '[fake-container] mount ' + c.dir + ' -> /data',
      '[fake-container] game launcher ' + (c.command || []).join(' '),
      'Dedicated game server ready on assigned game ports',
    ] : [
      '[fake-container] mount ' + c.dir + ' -> /data',
      '[fake-container] ' + (c.command || []).join(' '),
      'Starting minecraft server version 1.21.4',
      'Loading libraries, please wait...',
      'Preparing level "world"',
      'Done (1.234s)! For help, type "help"',
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i < boot.length) { out(boot[i++]); return; }
      clearInterval(timer);
    }, 120);
    process.stdin.on('data', (buf) => {
      for (const line of buf.toString('utf8').split(/\\r?\\n/).filter(Boolean)) {
        out('[fake-container] issued server command: /' + line);
        if (line.trim() === 'list') out('There are 2 of a max of 20 players online: Notch, Steve');
        if (line.trim().startsWith('op ')) out('Made ' + line.trim().slice(3) + ' a server operator');
        if (line.trim().startsWith('give ')) out('Gave 1 [Diamond] to ' + line.trim().split(/\s+/)[1]);
        if (line.trim() === 'stop') {
          out('Stopping the server');
          clearInterval(timer);
          c.running = false; c.exitCode = 0; c.finishedAt = new Date().toISOString();
          write(name, c);
          setTimeout(() => process.exit(0), 60);
        }
      }
    });
    process.stdin.on('end', () => {
      c.running = false; c.exitCode = 0; write(name, c); process.exit(0);
    });
    return;
  }
  case 'stop': {
    const name = args[args.length - 1];
    const c = read(name);
    if (!c) fail('Error response from daemon: No such container: ' + name);
    if (!c.running) { out(name); process.exit(0); }
    c.running = false; c.exitCode = 0; c.finishedAt = new Date().toISOString();
    write(name, c);
    out(name);
    process.exit(0);
  }
  case 'kill': {
    const name = args[args.length - 1];
    const c = read(name);
    if (!c) fail('Error response from daemon: No such container: ' + name);
    if (!c.running) fail('Error response from daemon: Cannot kill container: ' + name + ': container is not running');
    c.running = false; c.exitCode = 137; c.finishedAt = new Date().toISOString();
    write(name, c);
    out(name);
    process.exit(0);
  }
  case 'rm': {
    const name = args[args.length - 1];
    try { fs.rmSync(containerFile(name)); } catch (_) { fail('Error response from daemon: No such container: ' + name); }
    out(name);
    process.exit(0);
  }
  case 'ps': {
    const dir = path.join(STATE, 'containers');
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => read(f.replace(/\\.json$/, ''))).filter(Boolean) : [];
    for (const c of all) {
      out(JSON.stringify({ Names: c.name, ID: c.id.slice(0, 12), Image: c.image, Status: c.running ? 'Up 2 minutes' : 'Exited (0) 5 seconds ago', State: c.running ? 'running' : 'exited', Ports: (c.ports || []).map((p) => '0.0.0.0:' + p + '->' + p + '/tcp').join(', '), CreatedAt: c.created }));
    }
    process.exit(0);
  }
  case 'logs': {
    const name = args[args.length - 1];
    const c = read(name);
    if (!c) fail('Error: No such container: ' + name);
    out('[fake-container] last boot log for ' + name);
    process.exit(0);
  }
  case 'stats': {
    const name = args[args.length - 1];
    const c = read(name);
    if (!c) fail('Error response from daemon: No such container: ' + name);
    if (!c.running) fail('Error response from daemon: No such container: ' + name);
    // deterministic but varying "real" numbers: read the fake JVM's rss when present
    let rss = 380 * 1024 * 1024;
    const pidFile = path.join(STATE, 'pids', name);
    if (fs.existsSync(pidFile)) {
      try {
        const statm = fs.readFileSync('/proc/' + fs.readFileSync(pidFile, 'utf8').trim() + '/statm', 'utf8').trim().split(/\\s+/);
        rss = parseInt(statm[1], 10) * 4096;
      } catch (_) {}
    }
    const limit = (c.memoryMb || 2455) * 1024 * 1024;
    out(JSON.stringify({
      Name: name, CPUPerc: '3.50%', MemUsage: (rss / 1048576).toFixed(1) + 'MiB / ' + (limit / 1048576).toFixed(0) + 'MiB',
      MemPerc: ((rss / limit) * 100).toFixed(2) + '%', NetIO: '1.2MB / 840kB', BlockIO: '0B / 4.1MB', PIDs: 28,
    }));
    process.exit(0);
  }
  default:
    fail('fake docker: unsupported command "' + cmd + '"');
}
`;

fs.writeFileSync(path.join(BIN, 'docker'), shim);
fs.chmodSync(path.join(BIN, 'docker'), 0o755);

if (process.argv.includes('--print-path')) process.stdout.write(BIN);
else console.log(`fake docker CLI ready\n  PATH="${BIN}:$PATH"\n  state: ${STATE}`);
