#!/usr/bin/env node
'use strict';
/**
 * Zenith Panel - end-to-end smoke test.
 *
 * Logs into a running panel and walks the whole public API surface plus the
 * websocket console handshake, so you can prove an install works in one command:
 *
 *   node scripts/smoke.js                                  # http://localhost:8080, prompts for nothing
 *   node scripts/smoke.js --url http://panel:8080 --user admin --pass secret
 *   ZENITH_URL=... ZENITH_USER=... ZENITH_PASS=... node scripts/smoke.js
 *
 * Exit code 0 = everything passed, 1 = at least one check failed.
 */
const http = require('http');
const https = require('https');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  return fallback;
};

const BASE = (flag('url', process.env.ZENITH_URL || 'http://localhost:8080')).replace(/\/$/, '');
const USER = flag('user', process.env.ZENITH_USER || 'admin');
const PASS = flag('pass', process.env.ZENITH_PASS || '');
const SKIP_NET = args.includes('--offline');

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', n: '\x1b[0m' }
  : { g: '', y: '', r: '', d: '', b: '', n: '' };

let token = null;
const results = [];

function record(name, ok, detail = '', skipped = false) {
  results.push({ name, ok, detail, skipped });
  const tag = skipped ? `${C.y}skip${C.n}` : ok ? `${C.g}pass${C.n}` : `${C.r}FAIL${C.n}`;
  console.log(`  ${tag}  ${name}${detail ? `  ${C.d}${detail}${C.n}` : ''}`);
}

async function api(method, path, body, { auth = true, headers = {} } = {}) {
  const url = `${BASE}${path}`;
  const opts = { method, headers: { ...headers } };
  if (auth && token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* html or empty */ }
  return { status: res.status, json, text };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    if (detail === '__skip__') return record(name, true, 'skipped', true);
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (err) {
    record(name, false, err.message);
  }
}

function need(cond, message) {
  if (!cond) throw new Error(message);
}

function wsCheck(serverId) {
  return new Promise((resolve, reject) => {
    let WebSocket;
    try { WebSocket = require('ws'); } catch (_) { return reject(new Error('ws module missing')); }
    const proto = BASE.startsWith('https') ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${BASE.replace(/^https?:\/\//, '')}/ws?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => { try { socket.close(); } catch (_) {} reject(new Error('no hello frame within 8s')); }, 8000);
    socket.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.type === 'hello') {
        clearTimeout(timer);
        const who = (msg.user && msg.user.username) || (msg.data && msg.data.user && msg.data.user.username) || 'unknown';
        const servers = (msg.servers || []).length;
        socket.close();
        resolve(`hello from ${who}${servers ? `, ${servers} server(s) in view` : ''}`);
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
    if (serverId) socket.on('open', () => socket.send(JSON.stringify({ type: 'subscribe', serverId })));
  });
}

(async function main() {
  console.log(`\n${C.b}Zenith Panel smoke test${C.n}  ${C.d}${BASE}${C.n}\n`);

  await check('panel answers (/api/version)', async () => {
    const r = await api('GET', '/api/version', null, { auth: false });
    need(r.status === 200 && r.json && r.json.version, `HTTP ${r.status}`);
    return `${r.json.name} v${r.json.version} on node ${r.json.node}`;
  });

  await check('public panel info (/api/auth/panel)', async () => {
    const r = await api('GET', '/api/auth/panel', null, { auth: false });
    need(r.status === 200, `HTTP ${r.status}`);
    return `registration ${r.json.allowRegistration ? 'open' : 'closed'}`;
  });

  await check('auth rejects anonymous access', async () => {
    const r = await api('GET', '/api/servers', null, { auth: false });
    need(r.status === 401, `expected 401, got ${r.status}`);
    return '401 without a token';
  });

  if (!PASS) {
    record('login', false, 'no --pass/ZENITH_PASS given');
  } else {
    await check(`login as ${USER}`, async () => {
      const r = await api('POST', '/api/auth/login', { username: USER, password: PASS }, { auth: false });
      need(r.status === 200 && r.json.token, `HTTP ${r.status} ${(r.json && r.json.error) || ''}`);
      token = r.json.token;
      return `role ${r.json.user.role}`;
    });
  }

  if (token) {
    await check('session (/api/auth/me)', async () => {
      const r = await api('GET', '/api/auth/me');
      need(r.status === 200, `HTTP ${r.status}`);
      return r.json.user.username;
    });

    let firstServer = null;
    await check('server list', async () => {
      const r = await api('GET', '/api/servers');
      need(r.status === 200 && Array.isArray(r.json.servers), `HTTP ${r.status}`);
      firstServer = r.json.servers[0] || null;
      return `${r.json.total} server(s), ${r.json.running} running`;
    });

    if (firstServer) {
      await check(`server detail (${firstServer.name})`, async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}`);
        need(r.status === 200 && r.json.server, `HTTP ${r.status}`);
        return `status ${r.json.live.status}, node ${r.json.node.name}`;
      });
      await check('console log ring buffer', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/logs?since=0`);
        need(r.status === 200 && r.json.lines, `HTTP ${r.status}`);
        return `${r.json.lines.length} lines buffered`;
      });
      await check('file manager listing', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/files?path=/`);
        need(r.status === 200, `HTTP ${r.status}`);
        return `${(r.json.entries || []).length} entries`;
      });
      await check('player list + action catalogue', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/players`);
        need(r.status === 200 && Array.isArray(r.json.players), `HTTP ${r.status}`);
        need(Array.isArray(r.json.actions) && r.json.actions.length >= 10, 'action catalogue missing');
        return `${r.json.players.length} online, ${r.json.actions.length} actions`;
      });
      await check('player action endpoint validates requests', async () => {
        const r = await api('POST', `/api/servers/${firstServer.id}/players/Notch/action`, { action: 'give', item: 'diamond; rm -rf /' });
        need(r.status === 400, `HTTP ${r.status} (expected 400)`);
        return r.json.error;
      });
      await check('world manager (list + active world)', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/worlds`);
        need(r.status === 200 && Array.isArray(r.json.worlds), `HTTP ${r.status}`);
        return `${r.json.worlds.length} world(s), active: ${r.json.active}`;
      });
      await check('server.properties editor', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/properties`);
        if (r.status === 404) return 'no server.properties yet (server never started) - endpoint answered correctly';
        need(r.status === 200 && typeof r.json.raw === 'string', `HTTP ${r.status}`);
        return `${Object.keys(r.json.properties || {}).length} keys`;
      });
      await check('sftp connection details', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/sftp`);
        need(r.status === 200 && r.json.username, `HTTP ${r.status}`);
        return `${r.json.status} on port ${r.json.port}, user ${r.json.username}`;
      });
      await check('console live snapshot (stats + disk + network)', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/live`);
        need(r.status === 200 && r.json.stats, `HTTP ${r.status}`);
        need(typeof r.json.memoryLimitBytes === 'number', 'memory limit missing');
        need(r.json.disk === null || typeof r.json.disk.pretty === 'string', 'disk shape');
        // network is either the container's own counters or the node's, and it says which
        need(r.json.net === null || ['container', 'node'].includes(r.json.net.scope), 'network scope missing');
        const scope = r.json.net ? r.json.net.scope : 'not measured';
        return `${r.json.status}, ${r.json.stats.cpu}% cpu, disk ${r.json.disk ? r.json.disk.pretty : 'n/a'}, net ${scope}`;
      });
      await check('subdomain list', async () => {
        const r = await api('GET', `/api/servers/${firstServer.id}/subdomains`);
        need(r.status === 200 && Array.isArray(r.json.subdomains), `HTTP ${r.status}`);
        return `${r.json.subdomains.length} hostname(s), provider ${r.json.provider}`;
      });
      await check('websocket console handshake', async () => wsCheck(firstServer.id));
    } else {
      record('server detail', true, 'no servers yet', true);
      record('websocket console handshake', true, 'no servers yet', true);
    }

    await check('docker engine status (real probe)', async () => {
      const r = await api('GET', '/api/system/docker');
      need(r.status === 200 && typeof r.json.available === 'boolean', `HTTP ${r.status}`);
      return r.json.available ? `engine ${r.json.engine} (${r.json.containerCount ?? 0} panel container(s))` : `not available: ${r.json.error}`;
    });
    await check('sftp subsystem status', async () => {
      const r = await api('GET', '/api/system/sftp');
      need(r.status === 200 && typeof r.json.available === 'boolean', `HTTP ${r.status}`);
      return r.json.running ? `listening on ${r.json.port}` : `${r.json.reason}${r.json.error ? `: ${r.json.error}` : ''}`;
    });
    await check('host detection (cpu/ram/disk/ip/java/docker)', async () => {
      const r = await api('GET', '/api/nodes/detect');
      if (r.status === 403) return 'not available for this role';
      need(r.status === 200 && r.json.cores > 0 && r.json.memory.total > 0, `HTTP ${r.status}`);
      return `${r.json.cores} cores, ${Math.round(r.json.memory.total / 1048576)} MB, java ${r.json.java.available ? 'yes' : 'no'}, docker ${r.json.docker.available ? 'yes' : 'no'}`;
    });
    await check('local node health check (measured)', async () => {
      const r = await api('POST', '/api/nodes/local/health-check', {});
      if (r.status === 403) return 'not available for this role';
      need(r.status === 200 || r.status === 409, `HTTP ${r.status}`);
      const failedChecks = (r.json.checks || []).filter((c) => !c.ok).map((c) => c.name);
      return r.json.ok ? `${r.json.checks.length} checks passed in ${r.json.latencyMs} ms` : `offline: ${failedChecks.join(', ') || r.json.error}`;
    });
    await check('host history (metrics ring buffer)', async () => {
      const r = await api('GET', '/api/system/history?minutes=5');
      need(r.status === 200 && Array.isArray(r.json.series), `HTTP ${r.status}`);
      need(r.json.summary && typeof r.json.summary.cpuAvg === 'number', 'no summary');
      return `${r.json.points} points, cpu avg ${r.json.summary.cpuAvg}%`;
    });

    await check('port allocations', async () => {
      const r = await api('GET', '/api/system/allocations');
      need(r.status === 200 && Array.isArray(r.json.nodes), `HTTP ${r.status}`);
      const n = r.json.nodes[0];
      need(n && typeof n.total === 'number', 'no node ranges');
      return `${r.json.totalUsed}/${r.json.totalPorts} ports used across ${r.json.nodes.length} node(s)`;
    });

    await check('dns / subdomain settings', async () => {
      const r = await api('GET', '/api/system/dns');
      need(r.status === 200 && r.json.settings, `HTTP ${r.status}`);
      need(r.json.settings.tokenSet === undefined || typeof r.json.settings.tokenSet === 'boolean', 'token flag missing');
      return `${r.json.settings.provider} mode, ${r.json.configured ? 'configured' : 'not configured'}`;
    });

    await check('discord bot status + command reference', async () => {
      const r = await api('GET', '/api/system/discord');
      need(r.status === 200 && r.json.status, `HTTP ${r.status}`);
      need(Array.isArray(r.json.reference) && r.json.reference.length >= 10, 'command reference missing');
      need(!('token' in r.json), 'token leaked in status');
      return `${r.json.status}, ${r.json.reference.length} commands, prefix ${r.json.prefix}`;
    });

    await check('settings hide secrets', async () => {
      const r = await api('GET', '/api/settings');
      need(r.status === 200, `HTTP ${r.status}`);
      need(!('dnsToken' in r.json.settings) && !('discordToken' in r.json.settings), 'raw token returned');
      need('discordTokenSet' in r.json.settings, 'token flags missing');
      return 'tokens masked, flags exposed';
    });

    await check('system stats', async () => {
      const r = await api('GET', '/api/system/stats');
      need(r.status === 200, `HTTP ${r.status}`);
      const host = r.json.host || r.json.stats || r.json;
      return `cpu ${host.cpu}%, ram ${host.memory ? host.memory.percent : '?'}%, ${host.cores} cores`;
    });

    await check('software catalogue', async () => {
      const r = await api('GET', '/api/system/catalogue');
      need(r.status === 200, `HTTP ${r.status}`);
      const types = r.json.catalogue || r.json.types || [];
      return `${types.length} server types`;
    });

    let nodeList = [];
    await check('nodes', async () => {
      const r = await api('GET', '/api/nodes');
      need(r.status === 200 && r.json.nodes.length, `HTTP ${r.status}`);
      nodeList = r.json.nodes;
      return nodeList.map((n) => `${n.name}:${n.status}`).join(', ');
    });

    await check('nodes expose their runtime (process | docker)', async () => {
      need(nodeList.length > 0, 'no nodes');
      const missing = nodeList.filter((n) => !['process', 'docker'].includes(n.backend || 'process'));
      need(missing.length === 0, `unexpected backend on ${missing.map((n) => n.name).join(', ')}`);
      return nodeList.map((n) => `${n.name}:${n.backend || 'process'}`).join(', ');
    });

    await check('auto-register is refused without the owner secret', async () => {
      const r = await api('POST', '/api/nodes/auto-register', { name: 'intruder' }, { auth: false });
      need(r.status === 401 || r.status === 403, `HTTP ${r.status} (expected 401/403)`);
      return `HTTP ${r.status}`;
    });

    await check('auto-register is idempotent for the local node (installer path)', async () => {
      const body = { name: 'Local Node', local: true, backend: 'process', fqdn: '127.0.0.1', port: 8443 };
      const first = await api('POST', '/api/nodes/auto-register', body);
      need(first.status === 200 || first.status === 201, `HTTP ${first.status}`);
      const id = first.json.node.id;
      const second = await api('POST', '/api/nodes/auto-register', body);
      need(second.json.node.id === id, `a second registration created ${second.json.node.id} instead of reusing ${id}`);
      need(second.json.created === false, 'a re-run reported a new node record');
      const all = await api('GET', '/api/nodes');
      const dupes = all.json.nodes.filter((n) => n.local);
      need(dupes.length === 1, `${dupes.length} local nodes after two registrations`);
      return `${id}: created=${first.json.created}, re-run created=${second.json.created}`;
    });

    // every remote node should also answer on its own agent API
    for (const node of nodeList.filter((n) => !n.local)) {
      await check(`node agent "${node.name}" (${node.fqdn}:${node.port})`, async () => {
        const scheme = node.scheme || 'http';
        const res = await fetch(`${scheme}://${node.fqdn}:${node.port}/api/node/status`, { headers: { 'x-node-token': node.token || '' } });
        if (res.status === 401) throw new Error('agent rejected the panel token');
        need(res.ok, `HTTP ${res.status}`);
        const status = await res.json();
        return `${status.cores} cores, ${Math.round(status.memory.total / 1073741824 * 10) / 10} GB RAM, ${status.running} running`;
      });
    }

    await check('java runtimes', async () => {
      const r = await api('GET', '/api/system/java');
      need(r.status === 200, `HTTP ${r.status}`);
      const list = r.json.available || r.json.java || r.json.runtimes || [];
      const needed = r.json.required ? `, Minecraft-level java ${r.json.required}` : '';
      return `${list.length} found${needed}`;
    });

    await check('activity log', async () => {
      const r = await api('GET', '/api/system/activity?limit=1');
      need(r.status === 200, `HTTP ${r.status}`);
      return `${(r.json.activity || []).length} entries`;
    });

    if (firstServer) {
      await check('modrinth packages are scoped per type (plugins vs mods)', async () => {
        const r = await api('GET', `/api/modrinth/servers/${firstServer.id}/packages?type=mod`);
        need(r.status === 200, `HTTP ${r.status}`);
        need(r.json.projectType === 'mod', `projectType came back as ${r.json.projectType}`);
        const p = await api('GET', `/api/modrinth/servers/${firstServer.id}/packages?type=plugin`);
        need(p.json.projectType === 'plugin', `projectType came back as ${p.json.projectType}`);
        return `${r.json.packages.length} mod(s) / ${p.json.packages.length} plugin(s) installed`;
      });
    }

    if (SKIP_NET) {
      record('modrinth search', true, 'skipped (--offline)', true);
    } else {
      await check('modrinth search (plugin browser)', async () => {
        const r = await api('GET', '/api/modrinth/search?query=essentialsx&type=plugin');
        need(r.status === 200, `HTTP ${r.status}`);
        const hits = (r.json.hits || []).length;
        need(hits > 0, 'no results');
        return `${hits} hits`;
      });
    }
  }

  for (const asset of ['/', '/css/app.css', '/js/app.js', '/node.sh', '/node-agent.js', '/install.sh',
    '/dashboard.html', '/analytics.html', '/servers.html', '/server.html', '/nodes.html', '/allocations.html',
    '/admin.html', '/account.html', '/apikeys.html', '/register.html', '/js/nodes.js', '/js/server.js', '/js/apikeys.js', '/js/components.js', '/js/servers.js']) {
    await check(`asset ${asset}`, async () => {
      const r = await api('GET', asset, null, { auth: false });
      need(r.status === 200, `HTTP ${r.status}`);
      return `${r.text.length} bytes`;
    });
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${C.b}${passed} passed${C.n}${skipped ? `, ${skipped} skipped` : ''}${failed.length ? `, ${C.r}${failed.length} failed${C.n}` : ''}\n`);
  if (failed.length) {
    for (const f of failed) console.log(`  ${C.r}x${C.n} ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log(`${C.g}All checks passed.${C.n}\n`);
})();
