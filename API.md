# Zenith Panel REST API

Base URL: `http://<panel>:8080/api` — every response is JSON.
Auth: `Authorization: Bearer <jwt>` **or** `X-API-Key: <key>` (create keys in Account → API keys)
**or** `?token=<jwt>` (used by download links opened in a new tab).

Errors: `{ "error": "human readable message" }` with 4xx/5xx status.

---

## Auth

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/auth/panel` | public: panel name, version, whether registration is open, `needsSetup` |
| POST | `/auth/login` | `{ username, password }` → `{ token, user }` (throttled per IP+user) |
| POST | `/auth/register` | `{ username, password, email? }` → `{ token, user }` (first user becomes owner) |
| POST | `/auth/firebase/google` | `{ idToken }` → verifies a Firebase Google ID token on the server and signs in/creates a permitted account |
| GET | `/auth/discord/start` | starts the Discord OAuth2 `identify email` flow |
| GET | `/auth/discord/callback` | validates state + exchanges the Discord code, then redirects with a one-time browser exchange code |
| POST | `/auth/oauth/complete` | `{ code }` → consumes that one-time Discord exchange and returns `{ token, user }` |
| GET | `/auth/me` | current user + visible server count + public settings |
| POST | `/auth/password` | `{ currentPassword, newPassword }` (invalidates other sessions) |
| PATCH | `/auth/profile` | `{ email?, avatarColor? }` |

## Servers

| Method | Path | Notes |
|---|---|---|
| GET | `/servers` | query: `search, status, nodeId, ownerId, sort=name\|status\|created, withUsage=disk` |
| POST | `/servers` | Minecraft: `{ name, serverType, version, memory, port?, maxPlayers?, eulaAccepted, autoStart?, install?, nodeId?, javaVersion?, aikarFlags?, javaArgs?, description? }` → creates the record and (unless `install:false`) downloads software. Admin-only general workload: `{ workloadType:"container", containerTemplate:"ubuntu-22.04"\|"ubuntu-20.04"\|"debian-11"\|"debian-12"\|"python-3.12"\|"node-20", name, memory, cpuLimit?, diskLimit?, ownerId?, install? }` → pulls and starts the selected local Docker image |
| GET | `/servers/:id` | full detail + `playit` status + `node` + live block + permissions map |
| PATCH | `/servers/:id` | `name, description, memory, cpuLimit, diskLimit, maxPlayers, onlineMode, javaArgs, aikarFlags, eulaAccepted, autoStart, autoBackup, stopCommand, javaVersion, javaPath, ip, port` (needs `settings`) |
| DELETE | `/servers/:id` | `?files=false&backups=false` to keep data |
| POST | `/servers/:id/start\|stop\|restart\|kill` | power actions (needs `console`) |
| POST | `/servers/:id/suspend` | admin only, `{ suspended: true\|false }` |
| GET | `/servers/:id/logs?since=<seq>` | `{ lines:[{seq,line,at}], seq, status, players, stats, installProgress }` — polling fallback |
| POST | `/servers/:id/logs/clear` | clears the in-memory buffer |
| POST | `/servers/:id/command` | `{ command }` → writes to Minecraft stdin |
| POST | `/servers/:id/terminal` | **Retired**: returns `410 Gone`; use the real SSHX browser-session URL in the Docker workload’s Console payload instead. Commands are no longer accepted by the panel. |
| GET | `/servers/:id/stats` | live CPU/mem/uptime/players/disk |
| GET | `/servers/:id/versions` | versions available from the server's software API + required Java |
| POST | `/servers/:id/reinstall` | `{ version?, serverType?, wipe? }` |
| POST | `/servers/:id/migrate` | `{ version, serverType? }` → verifies the live upstream release, attempts a safety backup, then reinstalls asynchronously; returns `backup` or exact `backupWarning` |
| POST | `/servers/:id/jar` | multipart `jar` (+ optional `version`, `serverType`) — upload a custom jar |
| GET | `/servers/:id/properties` | parsed `server.properties` + raw text |
| PUT | `/servers/:id/properties` | `{ properties: { key: value } }` |
| GET | `/servers/:id/java` | required Java, pinned runtime, all detected runtimes |
| POST | `/servers/:id/java/install` | `{ version }` → downloads a Temurin JRE |
| GET | `/servers/:id/activity` | audit trail for this server |

### Players (permission `console`) — `/servers/:id/players`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/servers/:id/players` | `{ players:[{name,joinedAt,onlineFor}], count, max, status, actions:[…] }` — the `actions` array is the catalogue the UI renders |
| POST | `/servers/:id/players/refresh` | sends `list` so the server prints its roster (parsed back into the player list) |
| POST | `/servers/:id/players/:name/action` | `{ action, …args }` — one action for one player, e.g. `{"action":"give","item":"diamond","count":8}` |
| POST | `/servers/:id/players/bulk` | `{ action, players:[…], args:{…} }` — up to 50 players, per-player result array |
| GET | `/servers/:id/players/recent` | recent `player.*` audit entries |

Actions: `op`, `deop`, `heal`, `feed`, `give` (`item`,`count`), `gamemode` (`mode`), `xp` (`levels`),
`fly`, `clear`, `kick` (`reason`), `ban` (`reason`), `unban`, `whitelistAdd`, `whitelistRemove`,
`tp`, `kill`, `playtime`. Input is validated server-side (player names `^[A-Za-z0-9_]{3,16}$`, item
ids normalised to `minecraft:<a-z0-9_>`, counts clamped to 1–2304, gamemode from a fixed list,
reasons truncated) before anything is written to the console. Works on local and remote (agent
proxied) servers.

### Console data (permission `console`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/servers/:id/live` | everything the console page draws in one poll: `status`, `uptime`, `players`, `backend`, `container`, `memoryLimitBytes`, `disk` + `diskLimitBytes`, `stats` (cpu/memory/network from the runtime), `net` (`{in, out, scope}` where `scope` is `container` when the runtime reports per-container counters and `node` when only the host counters exist), `host` (node cpu/memory/network) and `at` |
| `GET` | `/servers/:id/stats` | the same raw sample without the host/disk extras (kept for compatibility) |

Network numbers are never invented: a Java-process server has no per-process traffic counters, so the
page labels the node's own rate as `node in/out (panel host)` instead of pretending it is the server's.

### Worlds (permission `files`, write actions need `settings`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/servers/:id/worlds` | every folder containing a `level.dat` + sizes, region counts, last played, which one is active |
| `POST` | `/servers/:id/worlds/:name/activate` | rewrites `level-name` in `server.properties`; `restartRequired` when it is running |
| `GET` | `/servers/:id/worlds/:name/download` | real zip stream of the world directory |
| `POST` | `/servers/:id/worlds/import` | `multipart/form-data` (`file` = world .zip, optional `name`); traversal-safe, requires `level.dat` |
| `POST` | `/servers/:id/worlds/:name/duplicate` | copies the world to `<name>-copy` |
| `DELETE` | `/servers/:id/worlds/:name` | refuses the active world; removes `_nether` / `_the_end` alongside it |

### server.properties (permission `settings`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/servers/:id/properties` | `{ properties: {...}, raw: "..." }` (404 until the file exists) |
| `PUT` | `/servers/:id/properties` | `{ properties: { motd: "hi" } }` merges keys, or `{ raw: "..." }` replaces the file. Keeps `server.properties.bak`, rejects invalid names/junk, returns `changed[]` and `restartRequired` |

### SFTP (permission `files`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/servers/:id/sftp` | host, port, `username` (`<panel user>.<server id>`), real listener status, session counts |

Panel-wide (admin): `GET /api/system/sftp`, `POST /api/system/sftp/{start,stop,restart}`.

### Subdomains (permission `network`) — `/servers/:id/subdomains`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/servers/:id/subdomains` | `{ subdomains, baseDomain, provider, configured, suggested, serverIp }` |
| POST | `/servers/:id/subdomains` | `{ sub, ip? }` → creates the `A` + `_minecraft._tcp` `SRV` records; Cloudflare mode talks to the API, manual mode returns the record set (and `manual: true`) |
| DELETE | `/servers/:id/subdomains/:subId` | removes the panel record and, in Cloudflare mode, the DNS records |

### Subusers (permission `subusers`)

| Method | Path | Notes |
|---|---|---|
| POST | `/servers/:id/subusers` | `{ username \| email, permissions: [...] }` |
| PATCH | `/servers/:id/subusers/:userId` | `{ permissions: [...] }` |
| DELETE | `/servers/:id/subusers/:userId` | |

Permissions: `console, files, backups, plugins, network, settings, schedules, subusers, *`

### Schedules (permission `schedules`)

| Method | Path | Notes |
|---|---|---|
| GET | `/servers/:id/schedules` | tasks + human-readable cron |
| POST | `/servers/:id/schedules` | `{ name, action, cron, payload?, enabled? }`, action ∈ `start, restart, stop, backup, command` |
| PATCH/DELETE | `/servers/:id/schedules/:taskId` | |
| POST | `/servers/:id/schedules/:taskId/run` | run immediately → `{ result }` |

## Files (permission `files`) — mounted at `/servers/:id/files`

| Method | Path | Notes |
|---|---|---|
| GET | `/?path=` | directory listing (type, size, mtime, editable, archive) |
| GET | `/content?path=&tail=` | read a text file (≤5 MB, text only) |
| POST | `/content` | `{ path, content }` write/save |
| POST | `/mkdir` · `/rename` · `/copy` · `/zip` · `/unzip` · `/delete` | `{ path }` / `{ from, to }` / `{ paths: [] }` |
| POST | `/upload` | multipart `files[]` + `path` (max `MAX_UPLOAD_SIZE`) |
| POST | `/pull` | `{ url, path?, filename? }` — server-side download straight into the folder |
| GET | `/search?q=&path=` | recursive name search |
| GET | `/download?path=` | file download, or a folder zipped on the fly |

## Backups (permission `backups`)

| Method | Path | Notes |
|---|---|---|
| GET | `/servers/:id/backups` | list |
| POST | `/servers/:id/backups` | `{ note? }` → creates synchronously |
| POST | `/servers/:id/backups/stream` | returns immediately, progress goes to the console websocket |
| GET | `/servers/:id/backups/:backupId/download` | |
| POST | `/servers/:id/backups/:backupId/restore` | `{ force: true }` to stop a running server automatically |
| PATCH | `/servers/:id/backups/:backupId` | `{ locked: true\|false }` |
| DELETE | `/servers/:id/backups/:backupId` | |
| POST | `/servers/:id/backups/prune` | `{ keep: 10 }` |

## Modrinth (permission `plugins`)

| Method | Path | Notes |
|---|---|---|
| GET | `/modrinth/search` | `q, projectType(=plugin\|mod\|datapack), loader, gameVersion, limit, offset, sort(relevance\|downloads\|updated\|newest)` |
| GET | `/modrinth/project/:idOrSlug` | project details |
| GET | `/modrinth/versions/:idOrSlug?loader=&gameVersion=` | compatible versions |
| GET | `/modrinth/servers/:id/browse` | search pre-filtered for that server |
| GET | `/modrinth/servers/:id/packages` | installed plugins/mods (+ jars dropped in manually). `?type=plugin` / `?type=mod` scopes the listing to that folder and sets `projectType` in the answer |
| POST | `/modrinth/servers/:id/packages` | `{ projectId, versionId?, type?, resolveDependencies? }` — installs in the background, logs to console |
| GET | `/modrinth/servers/:id/packages/updates` | update check with compatible versions |
| POST | `/modrinth/servers/:id/packages/update` | `{ id, versionId? }` |
| POST | `/modrinth/servers/:id/packages/toggle` | `{ id, enabled }` → renames to `.disabled` |
| DELETE | `/modrinth/servers/:id/packages/:packageId` | |

## playit.gg (permission `network`) — `/servers/:id/playit`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | status: `running, pendingClaim, claimUrl, claimCode, tunnels, publicAddress, localAddress, lastLine, error, hasSecret, autostart` |
| POST | `/start` | starts the daemon, or starts the claim flow if no secret exists yet |
| POST | `/stop` | stops daemon + cancels a pending claim |
| POST | `/claim-url` | generate a fresh `https://playit.gg/claim/<code>` link |
| POST | `/claim` | mark the account as linked manually |
| POST | `/secret` | `{ secret }` — use an existing playit secret key |
| POST | `/autostart` | `{ autostart }` |
| POST | `/install` | download/refresh the agent + CLI binaries |
| GET | `/logs` | only the `[playit]` lines from the console buffer |

## System

| Method | Path | Notes |
|---|---|---|
| GET | `/version` | public: name/version/node/hostname |
| GET | `/health` | liveness |
| GET | `/system/stats` | host CPU/RAM/disk/load + panel + server aggregates |
| GET | `/system/servers/live` | per-server live rows (dashboard polling) |
| GET | `/system/catalogue` | server types + defaults |
| GET | `/system/versions/:type` | versions for `VANILLA\|PAPER\|PURPUR\|FABRIC\|QUILT\|FORGE\|NEOFORGE\|SPIGOT\|BUNGEECORD\|VELOCITY` |
| GET | `/system/java` · POST `/system/java/install` | runtimes / download a Temurin JRE |
| GET | `/system/config` | paths, limits, panel URL |
| GET | `/system/activity?limit=` | audit log |
| GET | `/system/proxy/image?url=` | allow-listed image proxy (Modrinth CDN, minotar, mc-heads) |

| GET | `/system/history?minutes=30&points=120` | host history from the 5 s ring buffer (max 720 min / 400 points) → `{ series:[{at,cpu,memory,disk,servers,running,players,load}], summary:{cpuAvg,cpuPeak,memoryAvg,memoryPeak,playersPeak,disk} }` |
| GET | `/system/allocations` | admin: per-node port ranges with used/free counts, next free port and the server holding each port |
| GET | `/system/dns` | admin: subdomain provider config (`tokenSet` flag instead of the token) |
| POST | `/system/dns/verify` | admin: checks the Cloudflare token/zone and reports what the panel can do |
| GET | `/system/discord` | admin: bot status (state, user, guild, prefix, commands handled, log tail) + the command reference |
| POST | `/system/discord/start\|stop\|restart` | admin: lifecycle control (start also flips `discordEnabled`) |
| POST | `/system/discord/test` | admin: posts a test embed to the notify channel (`{ channelId? }`) |

## Docker & container runtime

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/system/docker` | engine probe (`available`, `engine`, `apiVersion`, `storageDriver`, exact `error`), `containerCount`, `runningCount`, `containers[]`, `backend` |
| `POST` | `/api/system/docker/verify` | re-probe + list panel containers |
| `GET` | `/api/system/docker/images` | images on the host |
| `POST` | `/api/system/docker/pull` | `{ "image": "eclipse-temurin:21-jre" }` → real pull (validated reference) |

Server records expose the runtime they use: `server.backend` (`process`/`docker`), `server.dockerImage`,
`live.backend`, `live.container`, `live.containerId`.

## Admin

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/users` | list / create (`{ username, password, email?, role, maxServers? }`) |
| PATCH/DELETE | `/users/:id` | role, suspend, e-mail, password reset, `maxServers` / delete (`?force=true` also deletes the user's servers) |
| GET | `/nodes` · POST `/nodes` · DELETE `/nodes/:id` | node management (node token + install command are returned to admins only) |
| POST | `/nodes/refresh` | ping all remote nodes |
| POST | `/nodes/register` | **agent → panel** (no JWT - node token): `{ token, name, fqdn, stats }` |
| POST | `/nodes/:id/heartbeat` | **agent → panel**, header `x-node-token` |
| GET/PATCH | `/settings` | panel settings |
| GET | `/settings/export` | owner-only JSON export |
| GET/POST | `/keys`, DELETE `/keys/:id` | API keys. POST answers `{ apiKey: { ..., token } }` - `token` is shown **once** and never stored or listed again; DELETE revokes |

---

## Node provisioning (`/api/nodes`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/nodes` | nodes + measured stats (tokens stripped for non-admins) |
| `POST` | `/api/nodes/refresh` | re-poll every node (agent HTTP for remote, host counters for local) |
| `GET` | `/api/nodes/detect` | measured host facts: cores, cpu model, memory, disk, load, IPs, java, docker, distro |
| `POST` | `/api/nodes/auto-register` | creates **or** refreshes a node; accepts `x-owner-secret` (installer) or an admin JWT (401 otherwise). Body: `{ name, fqdn, port, scheme?, backend?, publicIp?, local?, portRange?, description? }`. Answers `{ node, created, credentialMinted, token? }` — `created` is only true for a **new record** (an idempotent re-run reuses the existing one, by `local:true`/hostname/own address or by `fqdn:port`), and `token` is present exactly once, when the panel mints a credential |
| `PATCH` | `/api/nodes/:id` | name, description, fqdn/port/scheme, `backend`, `dockerImage`, `portRange`, `memoryLimit`, `diskLimit`, `cpuLimit`, `maintenance` |
| `POST` | `/api/nodes/:id/health-check` | runs the real checks; `200` healthy, `409` with the failing checks otherwise |
| `POST` | `/api/nodes/:id/repair` | re-detect + re-check, returns the actions taken |
| `GET` | `/api/nodes/:id/containers` | containers the panel owns on that host |
| `POST` | `/api/nodes/:id/suspend`-style admin tools | move servers between nodes with `POST /api/servers/:id/node` |

## Remote nodes (`/api/nodes` + agent)

The panel drives a machine running `scripts/node-agent.js` through its own API. Panel → agent:
`GET /api/node/ports`, `POST /api/node/servers/:id/{provision,config,start,stop,kill,command,archive,restore,file}`,
`GET|DELETE /api/node/servers/:id/{status,logs,files,file}`. Agent → panel: `POST /api/nodes/register` every 30 s.
The agent's own reference lives in `docs/ARCHITECTURE.md` §9.

```bash
# what the Nodes page gives you (run on the second machine)
curl -fsSL http://PANEL:8080/node.sh | bash -s -- --panel http://PANEL:8080 --token <node-token>

# create a server that lives there
curl -X POST http://PANEL:8080/api/servers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Remote SMP","serverType":"PAPER","version":"1.21.4","nodeId":"node_xxx","memory":2048}'
```

Remote servers behave like local ones through the REST API: `GET /servers/:id/logs`, `/stats`,
`POST /command`, `/{start,stop,restart,kill}`, `/backups` (the agent archives, the panel pulls the
file, restore streams it back) and `/api/modrinth/servers/:id/packages` (the node downloads the jar
itself, and the installed list is read from the node). Removing a server also wipes the node's copy.
General file-manager access still targets the panel host.

---

## WebSocket console

`ws(s)://<panel>/ws?token=<jwt>` — also accepts the token via the `zenith, <token>` subprotocol.

**Client → server**

```json
{ "type": "subscribe",   "serverId": "srv_...", "since": 0 }
{ "type": "unsubscribe", "serverId": "srv_..." }
{ "type": "command",     "serverId": "srv_...", "command": "say hello" }
{ "type": "power",       "serverId": "srv_...", "action": "start|stop|restart|kill" }
{ "type": "ping" }
```

**Server → client**

```json
{ "type": "hello",   "user": { "username": "admin", "role": "owner" }, "panel": "Zenith Panel" }
{ "type": "log",     "serverId": "srv_...", "data": "…multi-line…", "seq": 42, "snapshot": true }
{ "type": "status",  "serverId": "srv_...", "data": { "status": "running", "uptime": 12345 } }
{ "type": "stats",   "serverId": "srv_...", "data": { "cpu": 12.5, "memoryBytes": 812345678, "memoryPretty": "774.7 MB", "uptime": 12345 } }
{ "type": "players", "serverId": "srv_...", "data": [ { "name": "Steve", "joinedAt": 1730000000000 } ] }
{ "type": "install", "serverId": "srv_...", "data": { "step": "download", "percent": 42, "note": "Downloading …" } }
{ "type": "playit",  "serverId": "srv_...", "data": { "status": "connected", "publicAddress": "x.playit.gg:1234" } }
{ "type": "ready",   "serverId": "srv_..." }
{ "type": "error",   "message": "No console permission" }
```

Stats frames are pushed every 2 s for subscribed servers; sockets are pinged every 30 s and dropped if dead.
If the socket cannot be established the UI switches to `GET /servers/:id/logs?since=<seq>` polling — same data, ~1.5 s cadence.

## Panel settings keys

`PATCH /api/settings` accepts `panelName`, `allowRegistration`, `defaultJava`, `defaultMemory`,
`defaultPort`, `maxServersPerUser`, `installJavaAutomatically`, `autoRestartOnCrash`, plus the
subdomain keys (`dnsProvider` = `manual|cloudflare`, `dnsDomain`, `dnsZone`, `dnsToken`, `dnsIp`,
`dnsTtl`) and the Discord keys (`discordEnabled`, `discordToken`, `discordGuildId`,
`discordAdminRole`, `discordPrefix`, `discordDefaultMemory`, `discordDefaultType`,
`discordDefaultVersion`, `discordAllowRegistration`, `discordChannelId`, `discordNotifChannelId`).
`GET /api/settings` masks `dnsToken`/`discordToken` and exposes `dnsTokenSet`/`discordTokenSet`
instead. Changing a `discord*` key restarts the bot connection when needed.

## Runtime & SFTP settings

| Key | Values | Meaning |
|---|---|---|
| `dockerBackend` | `process` \| `docker` | default runtime for newly created servers |
| `dockerImage` | image reference | default container image (used when a server/node does not set one) |
| `sftpEnabled` | boolean | run the SFTP server |
| `sftpPort` | 1-65535 | SFTP port (rebinds the listener on save) |
| `sftpHost` | hostname | host shown in the UI when detection is not possible |

## Rate limits & limits

* Login: `LOGIN_MAX_ATTEMPTS` failures per `LOGIN_WINDOW_MS` per IP+username (default 8 / 15 min), then HTTP 429.
* Uploads: `MAX_UPLOAD_SIZE` (default 5 GB) per request; 413 when exceeded.
* Console buffer: `LOG_BUFFER_LINES` per server (default 3000).
* `maxServersPerUser` (panel setting) applies to non-admin users; a per-user `maxServers` overrides
  it (0 = inherit). Hitting either limit answers `409`.
* Client errors are JSON: `400` bad input/unknown software, `403` permission, `404` missing,
  `409` conflict (quota, duplicate username, user still owns servers), `413` upload too large,
  `429` login throttle.
