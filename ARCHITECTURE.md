# Architecture & internals

## 1. One process, no external services

Zenith Panel is a single Node.js process that owns everything:

```
node server.js
 ├── express HTTP API            /api/*
 ├── static frontend             public/  (no build step, zero npm frontend deps)
 ├── websocket server            /ws      (console, stats, install/playit events)
 ├── runtime supervisor          child_process.spawn → java -jar server.jar
 ├── cron ticker                 schedules per server (30 s resolution)
 ├── node heartbeat loop         remote node agents
 └── json database              data/db.json (atomic writes, debounced)
```

There is no MySQL/Redis/Mongo, no PHP, no separate daemon or "wings". That keeps the
footprint small enough for a Raspberry Pi or a 1 GB VPS, and makes the installer trivial.

### Why child processes *and* Docker?

Both runtimes ship. A fresh install defaults to **processes** (nothing to install, works on any VPS), and a node can be
switched to **Docker containers** in one click - see `docs/NODES.md`. The supervisor picks the backend per server:

```js
backendFor(server) = server.backend || node.backend || process.env.NODE_RUNTIME || 'process'
usesDocker(server) = !isRemote(server) && backendFor(server) === 'docker'
```

The docker path lives in `src/services/docker.js` (CLI wrapper: probe, pull, create, attach, stats, logs, list) and is
woven into the supervisor in `src/services/runtime.js`:

| Supervisor step | process runtime | docker runtime |
|---|---|---|
| start | `spawn(java, args)` with `cwd = servers/<id>` | `docker create …`, explicit `docker start` + inspect confirmation, then `docker attach` (stdin+stdout attached → same console pipeline; a failed start returns Docker's exact error) |
| console | child stdout/stdin | container stdout/stdin over the attach |
| stats | `/proc` of the process tree | `docker stats --no-stream` (cgroup numbers) |
| stop | write `stop` + SIGTERM/SIGKILL escalation | write `stop`, then `docker stop -t`, then `docker kill` |
| panel restart | `reconcileServerStates()` flips stale "running" rows | `runtime.reconcileContainers()` adopts containers that are still up |
| failure | spawn error → console + `crashed` | docker's own stderr → console + `crashed` (`Docker is not available on this node: …`) |

The **remote agent** has the same switch: `provision` accepts `containerRuntime`/`dockerImage`, `start` attaches with
`docker start -a -i`, and `GET /api/node/status` reports the engine (`available`, `version`, or the exact error) so the
panel can show which runtime a node really has.

### Why child processes were the original default?
Pterodactyl-style panels delegate to a daemon that runs each server in a container. That is
great for isolation but needs Docker on the host and a second service to deploy. Zenith's
default runtime is a plain child process per server (with the JVM memory limit doing the
heavy lifting), which works everywhere — including inside a container itself.
A container/cgroup runtime is on the roadmap as an opt-in provider.

---

## 2. The runtime supervisor (`src/services/runtime.js`)

Each server has in-memory state:

```js
{
  proc,               // ChildProcess handle (null when offline)
  status,             // offline | starting | running | stopping | installing | crashed | suspended
  logs: RingBuffer,   // 3000 lines by default, each with a monotonically increasing seq
  startedAt, exitCode, manualStop, lastError,
  players: Map,       // parsed from the log stream
  stats: { cpu, memory, memoryBytes, uptime, players }
}
```

**Lifecycle**

1. `start()` — validates EULA + jar, (re)writes `eula.txt` and the port into `server.properties`,
   then calls `ensureJavaFor()`: an existing pinned/managed binary is reused, and if the runtime is
   missing (wiped `data/java`, re-installed panel, moved host) the correct Temurin JRE is downloaded
   before launch with progress streamed into the console. A system JVM is only used as a last
   resort, and only when its major version actually satisfies the server. It then builds the command
   (`-Xms min(mem,512)`, `-Xmx mem`, Aikar flags, extra args, `-jar <jar> nogui`) and spawns it
   with `cwd = servers/<id>` and `HOME` pointed at the server folder.
2. Output is split per line: appended to the ring buffer, classified, pushed to the websocket
   fan-out (`log` events) and scanned by `inspectOutput()` for
   * `Done (…)! For help, type "help"` → status becomes `running` (with a 60 s safety timer)
   * player join/leave (`… joined the game` / `… left the game`) → `players` events
   * `max-players=…`, exception snippets → `lastError` for the UI
3. `stop()` — writes `stop` (or `end` for proxies) to stdin, waits `STOP_TIMEOUT` seconds,
   then SIGTERM, then SIGKILL. `kill()` skips straight to SIGKILL.
4. `exit` — flips status to `offline` (clean/manual) or `crashed`, optionally auto-restarts
   (`AUTO_RESTART_ON_CRASH` / panel setting).
5. Panel shutdown calls `shutdownAll()`, so a `systemctl restart` never leaves orphaned JVMs.

**Log delivery** — every line has a `seq`. A client that reconnects (or a poller) asks for
`since=<seq>` and only receives the delta, so long-running consoles never re-download their
whole history. The same ring buffer is exposed over HTTP for the polling fallback.

**Resource sampling** (`src/services/stats.js`) — the panel walks `/proc/<pid>/stat` for the JVM
and all of its children (Forge/NeoForge fork extra processes), summing `utime+stime` and
`rss`. CPU % is the tick delta over elapsed time (normalised to one core: a fully busy core is
100 %), memory is RSS. No native modules, so it also works in scratch containers. Non-Linux
hosts fall back to `ps`.

---

## 3. Software installer (`src/services/versions.js` + `java.js`)

* `listVersions(type)` and `resolveDownload(type, version)` talk to the upstream APIs with a
  30-60 minute in-memory cache: Mojang manifest, `fill.papermc.io/v3`, `api.purpurmc.org`,
  fabricmc/quiltmc meta, Forge/NeoForge maven metadata, `ci.md-5.net`.
  Nothing is hardcoded, so a brand new Minecraft release shows up in the UI immediately.
* Downloads are streamed to disk with progress callbacks which become `install` events
  (`{ step, percent, note }`) → progress bar in the UI and lines in the console.
* Forge/NeoForge installer jars are executed (`--installServer`) and the produced launcher jar or
  `run.sh` is detected and wired up as the launch target. Spigot can be built with BuildTools.
* `javaFor(mcVersion)` maps Minecraft → JRE major version. `java.ensure(major)` downloads
  Temurin (Adoptium API) for the host OS/arch into `data/java/jre-<major>`, flattens the archive
  and reuses it for every server that needs it. It is called by the installer *and* by the runtime
  supervisor at start time, so a server always launches on a JVM new enough for its version.
* Downloads go to `data/tmp` and are deleted in a `finally` block when the install finishes
  (Spigot/BuildTools gets its own `data/tmp/buildtools-<version>` scratch directory that is wiped
  afterwards) so failed or repeated installs never leave gigabytes behind.

---

## 4. Modrinth pipeline (`src/services/modrinth.js`)

```
search / project / versions      →  v2 API, UA-tagged, short-lived cache
install(server, {projectId})     →  pick newest compatible version
                                    (loader = f(serverType), gameVersion = server.version)
                                 →  download primary file into plugins/ | mods/ | world/datapacks/
                                 →  walk `dependencies[]` (required only, depth ≤ 3, deduped)
                                 →  store metadata in server.packages[]
checkUpdates(server)             →  compare stored versionId with the newest compatible build
toggle / remove                  →  rename to *.jar.disabled or delete file + record
```

Loader mapping: Paper→`paper|spigot|bukkit`, Purpur adds `purpur`, Fabric→`fabric`,
Quilt→`quilt|fabric`, Forge→`forge`, NeoForge→`neoforge`, BungeeCord/Velocity→proxy loaders.
Jars that were dropped in manually (SFTP, upload, `pull` download) are listed as `source: manual`
so the file list in the UI always reflects reality.

---

## 5. playit.gg integration (`src/services/playit.js`)

playit's v1 agents are a daemon (`playit-agent`) plus a client (`playit-cli`), so the panel
implements the full claim handshake:

```
POST /servers/:id/playit/start
      │
      ├─ no secret? ─► playit-cli claim generate        → code
      │                playit-cli claim url <code>      → https://playit.gg/claim/<code>   (UI + console)
      │                playit-cli claim exchange <code> → blocks in background
      │                        └─ user approves in browser → secret returned
      │                             └─ saved to servers/<id>/.playit/playit.toml (+ db)
      └─ secret present ─► playit-agent --secret <key> --socket-path <id>.sock --log-path agent.log
```

Per server: own secret, own IPC socket, own log file. The log is tailed (2 s) and parsed for
tunnel addresses (`*.playit.gg:port`), status and errors; every line is mirrored to the server
console as `[playit] …` and pushed as `playit` events. `reset` runs `playit-cli reset`, wipes the
folder and returns the server to the unclaimed state. Tunnels are created on the playit
dashboard (the panel instructs the user with the exact local port).

---

## 6. Backups (`src/services/backups.js`)

* Uses the system `zip -r -q -1` with the server directory as cwd (streaming, low memory,
  ignores `.playit`, `logs/latest.log.gz`); falls back to `adm-zip` when `zip` is missing.
* Files land in `backups/<server-id>/<timestamp>_<name>.zip` — deliberately outside the server
  directory so restores and deletions never touch them.
* `restore()` stops the server, extracts over the working directory (keeping `.playit`),
  re-writes `eula.txt`, then restarts the server if it was running.
* Metadata (note, size, automatic flag, lock, created) lives in `server.backups[]`;
  `prune()` deletes the oldest *unlocked automatic* backups beyond `keep`.
* Schedules can create backups (with pruning) so retention runs unattended.

---

## 7. Auth & permissions (`src/auth.js`)

* **Passwords**: bcrypt (10 rounds). **Sessions**: JWT (`JWT_SECRET`, 7 d) carrying
  `{ id, username, role, pv }`; the `pv` (passwordVersion) claim is compared with the DB record,
  so a password change instantly invalidates every other session.
* **Roles**: `owner(3) > admin(2) > user(1)`. Admin bypasses per-server checks.
* **Per-server access**: owner of the record, or a subuser with the required permission.
  `serverScope(perm)` is the single middleware that loads `req.server` and enforces it.
* **API keys**: `zen_<random>`; only a SHA-256 hash is stored, the plaintext key is shown once.
* **Brute force**: failed logins counted per `ip:username` inside a rolling window → HTTP 429.
* **Path safety**: `safeJoin(base, target)` resolves the target and rejects anything that leaves
  the base (used by the file manager, Modrinth installer, jar upload).

---

## 8. Frontend

Plain HTML + CSS + vanilla JS (`public/`), so there is **no build step** and no CDN dependency —
it works offline and behind restrictive firewalls (external images such as Modrinth icons and
player avatars are proxied by the panel).

* `js/app.js` — API client (JWT/`401` → login), UI kit (toasts, modals, confirm, formatting,
  status badges), layout renderer (sidebar/topbar), `ConsoleSocket` (WS with reconnect →
  polling fallback), `ConsoleView` (line rendering + colour classification + scroll anchoring),
  plus three shared building blocks used by every page:
  * `playerHead()` — Minecraft skin head/body through the panel's image proxy
    (`/api/system/proxy/image?url=…&token=…`, because `<img>` cannot send an `Authorization`
    header), with a letter-avatar fallback when the skin host is unreachable;
  * `Players` — the online list + the one-click action sheet (quick buttons for full health /
    full hunger / op, plus a data-driven modal for the argument-taking actions);
  * `Chart` — static SVG charts (`area`, `spark`, `donut`, `legend`) with no chart library, so
    graphs render even without network access and inside sandboxed previews.
* `js/server.js` — the server detail page: tabs for console, **players**, files, Modrinth,
  backups, network (playit **+ subdomains**), schedules, people (subusers) and settings, each
  lazily rendered on first open. Tab availability follows the user's permissions.
* `js/dashboard.js` — live console for a selected server, the online player list with actions,
  host resource bars, a fleet grid and the activity feed.
* `js/analytics.js` — CPU / memory / players / running-servers graphs, peak & average summary, a
  status donut and the audit trail, with a 5/15/30/60-minute window switch.
* `js/allocations.js` — the port map per node (used/free/next free, owner and software per port).
* `js/admin.js` — users, all servers, panel settings, **Subdomains & Discord** (DNS provider,
  Cloudflare token, bot token/guild/prefix/roles, start/stop/test, command reference, bot log)
  and **Allocations**.
* `js/components.js` — the shared component bundle, loaded after `app.js` on **every** page. It is
  the vanilla-JS port of the JTG panel's React components, so behaviour matches without a framework:

  | Component | What it does here |
  | --- | --- |
  | `Loading` (`LoadingOverlay`) | blocking overlay + `Loading.run(text, fn)` wrapper |
  | `Notifications` (`NotificationsDropdown`) | topbar bell with unread badge, feeds from `/api/system/activity`, 60 s refresh, "mark all read" |
  | `GlobalSearch` (`GlobalSearchModal`) | `Ctrl/⌘+K` palette over servers, nodes and pages (`/api/servers`, `/api/nodes`) |
  | `Tutorial` (`TutorialOverlay`) | 6-step first-run spotlight tour, replayable from Account, `localStorage`-gated |
  | `Cropper` (`ImageCropper`) | canvas square-crop of an avatar upload → `PATCH /api/auth/profile { avatar }` |
  | `UpdateWatch` (`SystemUpdateListener`) | polls `/api/system/update`; only claims an update when a feed or release marker really differs |
  | `searchableDropdown` (`SearchableDropdown`, `CategorizedVersionDropdown`) | filterable select, grouped variant for versions (`versionGroups()` → stable / snapshots / other) |
  | `ModrinthVersionModal` | build picker (channel + game-version filter) that installs a chosen version, used by the Plugins **and** Mods tabs |

* The **Plugins** and **Mods** tabs are the same renderer (`renderPlugins('plugin' | 'mod')`): the tab
  shown follows the server software (plugin servers → Plugins, Fabric/Quilt/Forge/NeoForge → Mods),
  every element id is suffixed with the mode, and all API calls carry `?type=plugin|mod` so listings,
  searches and installs stay in their own folder.
* Pages are static HTML shells; the JS fills them from the API, which keeps markup small and
  makes the panel trivially cacheable.

---

## 8b. Player actions, metrics, subdomains and the Discord bot

Four small services extend the runtime without adding dependencies:

* **`src/services/players.js`** — an action table (`op`, `deop`, `heal`, `feed`, `give`,
  `gamemode`, `xp`, `fly`, `clear`, `kick`, `ban`, `unban`, `whitelistAdd`, `whitelistRemove`,
  `tp`, `kill`, `playtime`). Each entry knows its arguments, its validator and how to render the
  console command, so `apply(server, player, action, args)` is one code path for the web UI, the
  REST API and the Discord bot. Commands go through `runtime.sendCommand()`, which means remote
  servers work unchanged (the command is proxied to the node agent). `attachParser()` listens on
  the runtime event bus and turns `There are N of a max of M players online: …` into the live
  player list (`runtime.state(id).players`), alongside the join/leave lines already tracked by the
  supervisor. Everything is validated (`^[A-Za-z0-9_]{3,16}$` names, normalised item ids, clamped
  counts, fixed gamemode list) before it reaches stdin, and every action is audited.
* **`src/services/metrics.js`** — a 5 s sampler writing host + fleet counters (CPU, memory, disk,
  servers, running, players, load) into a bounded 720-sample ring buffer (1 hour, memory only).
  `history({minutes, points})` downsamples for the graphs and returns averages/peaks.
* **`src/services/dns.js`** — subdomain bookkeeping. `desiredRecords()` is the single source of
  truth for the `A` + `_minecraft._tcp` `SRV` pair (also used to render the manual instructions);
  in `cloudflare` mode the same records are created/updated/deleted through the Cloudflare API
  (`/zones/:id/dns_records`), with `verify()` for the "Test connection" button. Records live on the
  server document, and hostnames are unique across the panel.
* **`src/services/discord.js`** — the bot. A raw gateway client over `ws` (op 10 hello → op 2
  identify with intents `GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT`, op 1 heartbeat, resume on
  reconnect) plus a command framework. `identity()` maps a Discord user to a panel user through
  `users.discordId` (set by `!link`), the guild owner or a configured role, and every command goes
  through the same service layer the REST API uses. `exports.transport` is injectable, so the whole
  command surface — including the linked-panel-administrator-only `!newserver` flow (optional owner registration + server creation)
  — can be tested without a token. `notify()` posts lifecycle embeds; the panel subscribes to the
  runtime event bus at boot (`wireDiscordNotifications()`) and announces running/crashed/offline
  transitions once per transition.

---

## 8d. The reworked Servers list and console page

Both pages were rebuilt around the Pterodactyl/Nook layout the user asked for, without adding a
single external asset (the preview sandbox has no network):

**`servers.html`** - every instance is a card with

```
┌──────────── banner (inline SVG, deterministic per server) ────────────┐
│ [PAPER 1.21.4]                        ● Running                       │
│ Survival · Local Node · 7/30 online · docker                          │
├───────────────────────────────────────────────────────────────────────┤
│ Node | Address | CPU usage | Memory | Storage | Players   (2×3 tiles) │
│ ▶ ⏻  up 4h            [12 add-ons]           Console ▶                │
└───────────────────────────────────────────────────────────────────────┘
```

The banner is generated in the browser: colours come from a per-software palette and the hills,
clouds and blocks are seeded from a hash of the server id, so each card looks distinct, costs
nothing and works offline. Storage comes from `GET /api/servers?withUsage=disk` (a real
`dirSize()` of the server directory, or the node's own number for a remote server) and turns red
past 90% of the disk limit. A 1/2/3-column switch and the view are remembered in `localStorage`.

**`server.html`** - navigation is now deliberately **two-tiered**: a 68 px global primary rail
stays pinned on the far left, while a labelled, independently scrolling `.server-sidebar` owns the
server options (Console/Players, Content, Automation & network, Access, Configuration). The
context drawer is deliberately persistent beside the desktop console; on screens below 980 px both
tiers become an off-canvas drawer behind the top-bar hamburger, with a scrim to close it. This
prevents a long server menu from ever clipping the global account navigation.

The server hero places the real status pulse and Start/Restart/Stop/Kill controls at the top. The
console view begins with four live resource cards (CPU, memory, disk and network in/out), then a
high-contrast terminal with connection state, clear/tail controls and a sticky CLI prompt. Address,
uptime, runtime, Playit route and players remain in the supporting information column; three area
charts retain the short CPU/memory/network history.

Server creation is a guarded three-stage wizard: **Details → Version → Review**. Details captures
software, description, RAM, disk, CPU, optional IP/port, and (for administrators) owner; moving to
Version paints the version picker before the asynchronous provider call begins and disables
navigation while it is loading. A slow upstream can therefore never turn a double click into a
skipped review step. The Version page always renders either selectable versions, a loading state, or
a precise error plus Retry control.

Everything those widgets show comes from one endpoint, `GET /api/servers/:id/live`, polled every
6 s (plus websocket pushes). `src/services/stats.js` gained host network counters read from
`/sys/class/net/*/statistics/{rx,tx}_bytes`; they are summed over the non-loopback interfaces and
converted into rates by diffing two samples. Per-**server** network is only possible for container
servers (`docker stats` NetIO), so `net.scope` says `container` or `node` and the page prints
"node in/out (panel host)" in the second case - an honest label beats an invented number.

## 8c. Docker backend, SFTP and worlds

**`src/services/docker.js`** - the honest CLI wrapper. `run()` never throws on a non-zero exit: it returns
`{ code, stdout, stderr }` and callers decide. `probe()` caches `docker version --format {{json .}}` for 10 s and turns
`spawn ENOENT` into "docker is not installed or the daemon is not reachable". `ensureImage()` retries a pull three times
and streams progress into the server console. Containers are named `zenith-<server id>`, created with `-i` (stdin kept
open), started with `docker start`, verified through inspect, then connected with `docker attach`. That separates
Docker's lifecycle confirmation from console streaming, so a failed Minecraft start returns Docker's exact error instead
of a successful-looking empty console. `DOCKER_BIND_ROOT` maps only the panel-managed server-data root to the
absolute path understood by a host daemon when the panel itself is containerised; it is applied to the one `/data` mount
and to inspect verification, not to arbitrary tenant paths.

**`src/services/sftp.js`** - a real SSH/SFTP server built on `ssh2` (optional dependency):

```
client ──SSH──► ssh2.Server ──auth──► users/servers collections (bcrypt password or zen_… API key)
                       │                     username = <panel user>.<server id>
                       └──session/sftp──► attachSftp() ──► handleTable ──► fs/promises
                                                          └ every path via safeJoin(root) → chroot
```

Handled requests: `REALPATH, STAT, LSTAT, FSTAT, OPEN, READ, WRITE, CLOSE, OPENDIR, READDIR, MKDIR, RMDIR, REMOVE,
RENAME, SETSTAT, FSETSTAT`. A host RSA key is generated once at `data/ssh/sftp_host_rsa` (mode 600). Any handler
exception is converted into `SSH_FX_FAILURE` with the real message, so clients see an error instead of a dead session.
Missing `ssh2` ⇒ `status()` reports `reason: 'missing-dependency'` and the UI tells the admin to run `npm install ssh2`.

**`src/services/worlds.js`** - detection (`level.dat` in a folder), sizing, `level-name` activation through
`server.properties`, zip export via `adm-zip`, traversal-safe import, duplicate and delete (never the active world).

## 9. Nodes model

```
local node (built-in)                    remote node
─────────────────────                    ─────────────────────────────────────────
this machine                             own box running scripts/node-agent.js
server = child process of the panel      server = child process of the agent
port range 25565-25665 (configurable)    own port range, free ports picked by the agent
no extra moving parts                    HTTP API *and* 30 s heartbeat to the panel
```

**Placement.** Every server record carries a `nodeId`. `runtime.isRemote(server)` is the single
switch: local servers are spawned by the panel, remote ones are driven through the agent.

**Remote lifecycle.** `src/services/remote.js` is the client:

| Panel action | Agent call |
|---|---|
| create server on that node | `GET /api/node/ports` to reserve a port |
| install / reinstall software | `POST /api/node/servers/:id/provision` (jar + JRE + eula/properties) |
| start | `POST .../config` (push memory, port, flags) then `POST .../start` |
| stop / kill | `POST .../stop` / `.../kill` |
| console command | `POST .../command` |
| console mirror | poll `GET .../logs?since=<seq>` + `GET .../status` every 2 s into the local ring buffer |
| stats | `rss` from `GET .../status`, reported as `memoryPretty` / memory % |
| backup | `POST .../archive` → stream `GET .../archive?path=` into `backups/<id>/` |
| restore | stream the archive to `POST .../restore` (wipe + extract on the node) |
| delete server | `DELETE /api/node/servers/:id` (stops it and wipes the node's copy) |
| move server | `POST /api/servers/:id/node` → port on the target + provision there |

Mirrored console lines go through `runtime.pushExternalLog()`, so the websocket fan-out, the
`?since=` polling API, the ring buffer and the audit log behave identically for both kinds of
server. `runtime.state().remotePid` marks a mirrored process: `isOnline()`, `sampleStats()` and
`info()` all consult it.

**Boot reconciliation.** On restart the panel cannot know what survived elsewhere, so every remote
server is re-adopted: `remote.reconcile()` asks the agent whether the process is still alive and
resumes mirroring if it is (local servers always go offline - their children died with the panel).

**Agent API** (`scripts/node-agent.js`, token via `x-node-token`):

```
GET    /api/node/status                     host stats (also the heartbeat payload)
GET    /api/node/events                     rolling agent log (diagnostics)
GET    /api/node/servers                    servers known to this node
GET    /api/node/ports?start=&end=          first free port in a range
POST   /api/node/servers/:id/provision      JRE check/download, jar download, eula, properties
POST   /api/node/servers/:id/config         patch memory/port/motd/flags
POST   /api/node/servers/:id/start|stop|kill|command
GET    /api/node/servers/:id/status         running, pid, rss, diskUsed, ready, logSeq
GET    /api/node/servers/:id/logs?since=n   incremental console lines
POST   /api/node/servers/:id/file           { url, dir, filename } - node downloads a plugin/mod jar
GET    /api/node/servers/:id/files?dir=     dir listing (feeds the Modrinth "installed" view)
DELETE /api/node/servers/:id/file           { dir, filename } - remove a plugin/mod jar
POST   /api/node/servers/:id/archive        zip the server dir (.tar.gz fallback) -> { path, size }
GET    /api/node/servers/:id/archive?path=  stream an archive
DELETE /api/node/servers/:id/archive        drop a staging archive
POST   /api/node/servers/:id/restore        raw archive upload -> wipe + extract
DELETE /api/node/servers/:id                stop + wipe the node's copy
```

Agent endpoints are registered **before** the JWT middleware in `src/routes/admin.js`; only the
panel-facing routes require a session. The node token itself is returned to admins only.

**Heartbeat.** `nodes.refresh()` pings every node's `/api/node/status` every 60 s (and on demand from
the Nodes page) to paint resource bars; the agent additionally POSTs to `/api/nodes/register` every
30 s, which keeps `lastHeartbeat` fresh even when the panel cannot reach the node inbound.

**Modrinth on nodes.** `modrinth.install()` hands the file's CDN URL to the agent instead of
downloading it itself, so the jar lands directly on the node (`POST .../file`, with a `.bak` kept when
a jar is replaced). `listInstalled()` reads the node's own directory listing, and removal deletes the
jar on the node. Enable/disable is intentionally not supported remotely yet (it needs a rename
primitive in the agent).

**Limits today.** General file manager access and `server.properties` editing still operate on the
panel host's copy of a server, so keep those for locally hosted servers (the UI says so when a remote
node is selected). Console, power, stats, commands, schedules, backups, Modrinth installs/updates and
server moves all work remotely.

### HTTP error behaviour

Express 4 does not forward rejected promises, so `server.js` patches `express.Router()` once at
boot and wraps every handler: a thrown error (bad software id, quota hit, port conflict,
validation) reaches the JSON error handler instead of leaving the client waiting forever.
Services signal client mistakes by attaching `err.status` (e.g. `409` for "server limit
reached"), and the handler answers `{ "error": "..." }` with that status.

---

### Installing a node automatically

`install.sh` owns the "no manual node creation" guarantee:

```
host detect ─► (optional) docker install ─► .env (OWNER_SECRET + NODE_RUNTIME) ─► boot panel ─► POST /api/nodes/auto-register (x-owner-secret)
      └──────────────────────────────► reporter timer (60 s) ──► refresh detected facts
                                             │
                              POST /api/nodes/:id/health-check ──► status = online only when every check passes
```

`OWNER_SECRET` (generated into `.env`, mode 600, constant-time compared in `src/auth.js`) is what lets the installer
authenticate before any session exists; it can be blanked to disable the path. Credentials for the node itself are
minted by the panel (`randomToken(24)`) and returned exactly once. The reporter (`zenith-node-report` + systemd timer)
keeps resources and the backend fresh without storing a JWT anywhere.

### Self-test

`scripts/smoke.js` is a dependency-free end-to-end check: it logs in, then exercises
`/api/version`, `/api/auth/panel`, anonymous rejection, the server list/detail/logs/files routes,
the player list + action catalogue, subdomains, host history, port allocations, the DNS and Discord
settings (and that both tokens stay masked), host stats, the software catalogue, nodes, Java
runtimes, the activity log, a Modrinth search, the static assets and the `/ws` handshake. It is the
fastest way to confirm a box is healthy after an update (exit code 0/1).

`scripts/uitest.js` is the UI counterpart: with jsdom installed (`npm install` - it is a dev
dependency, the panel itself installs with `--omit=dev`) it renders every page and every server/admin
tab against a running panel, clicks the real buttons (create-server wizard, player action sheet,
admin tabs) and fails on any JavaScript error.

`bash tests/run.sh` is the one-command version of all of it: it installs what is missing, puts the
Docker test double (`scripts/fake-docker.js`) on `PATH`, starts a **throwaway panel** in a temp
directory, creates the owner, creates a PAPER fixture (and asserts the real jar download), then runs
every suite and prints a per-suite summary:

| Suite | File |
| --- | --- |
| API smoke (~60 checks incl. the `/ws` handshake and auto-register idempotency) | `scripts/smoke.js` |
| every page + every tab in jsdom, zero JS errors | `scripts/uitest.js` |
| every page's own contracts (nodes runtime badges, account photo/tour, admin tabs) | `tests/pages-panel.js` |
| the reworked servers list + console page | `tests/pages-theme.js` |
| Plugins/Mods split + the shared components | `tests/pages-mods-components.js` |
| a server really running **inside a container** (asserted through the docker CLI) | `tests/runtime-api.js` |
| the installer's own node functions: register, health-gate, 3× idempotency | `tests/installer-node-check.sh` |

Your own panel is never touched: the run uses its own data directory and port, and cleans up
afterwards unless `KEEP=1` is set.

---

## 9b. Size and transfer budget

Two numbers are protected by tests, because both creep silently:

**Disk.** The shipped tree is ~1.39 MB / 99 files and the release archive ~442 KB. `npm run pack`
(`scripts/package.js`) stages an allow-listed tree — `server.js`, `src/`, `public/`, `scripts/`,
`tests/`, `docs/`, `preview/`, `install.sh`, `uninstall.sh`, Docker/PM2 files, docs — into
`zenith-panel-<version>/`, zips it, and exits non-zero above 25 MB (`--budget <MB>` overrides).
`--verify` unpacks the archive into a temp dir, runs `npm ci --omit=dev --omit=optional`, boots
it on :8098 and waits for `/api/version`, so a broken archive is caught before it ships.
`npm run size` (`tests/size-check.js`) prints the same table without building anything and asserts
that no runtime folder, no `dist/` archive and no downloaded JRE leaked into the shipped tree.

The dependency discipline behind it: 8 direct runtime dependencies, no dev dependencies, no
build/bundler step, `--omit=optional` so ssh2's native add-ons are skipped. jsdom is fetched on
demand (`npm run verify:install`) because a normal install never needs it.

**Wire.** `src/middleware/compress.js` runs before the routes and buffers the response body,
then picks an encoding: brotli-q9 for `text/*`, JSON, JS, CSS, SVG and XML; gzip for everything
else; identity below 1 KB, above 4 MB, for `Range`/206, 204, 304 and already-encoded bodies.
Static assets are cached by `url|ETag|length|encoding` (120 entries), so repeated requests skip
re-compression entirely. Measured first load of the panel's JS+CSS: **299.4 KB → 69.9 KB
(−77 %)**, the single biggest file (`/js/server.js`, 124.8 KB) becoming 26.7 KB.
`tests/compression.js` re-asserts this over raw `http` — Node's `fetch` transparently decompresses
and strips `Content-Encoding`, which would make a naive test pass no matter what.

## 10. Operational notes

* **Storage**: `data/db.json` (users, servers, nodes, keys, settings, audit log — atomic
  write-temp-then-rename), `servers/<id>/` (game files), `backups/<id>/`, `data/bin`.
  Managed JREs live in `JAVA_DIR`, which defaults to `/var/lib/zenith/java` on an installer
  provisioned host (`~/.zenith/java` non-root) precisely so the 50-160 MB runtimes never sit
  inside the project tree; `java.js usage()/prune()` reclaims them.
* **Graceful shutdown**: SIGINT/SIGTERM → stop all Minecraft servers (graceful) + playit agents,
  flush the DB, close the HTTP server; 6 s hard deadline.
* **Crash safety**: `uncaughtException`/`unhandledRejection` are logged to `data/crash.log`;
  systemd/PM2 restart the panel, and servers marked `autoStart` come back automatically.
* **Scaling**: one panel comfortably supervises dozens of servers; beyond that, split load with
  remote nodes or run one panel per machine and use the API keys for automation.
* **The installer is a library and a program**: `install.sh` runs its main flow only when it is
  executed (`[ "${BASH_SOURCE[0]}" = "$0" ]`). Sourced — which is how
  `tests/installer-node-check.sh` calls `provision_local_node()` and `verify_node_health()` — it
  only defines functions. Functions never assume `log_init` ran (`${INSTALL_LOG:-/dev/null}`) and
  `verify_node_health()` refuses to build a `/api/nodes//health-check` URL when no node id is known.
  Before this guard existed, sourcing the file silently ran a whole install: it rewrote `.env`,
  created `/var/lib/zenith/java` and restarted PM2 on the developer's machine.

## Docker VPS isolation

Generic Docker VPS workloads use a per-server Docker bridge, deterministic container hostname, private PID/UTS/IPC and mount namespaces, Docker cgroup memory/CPU/PID limits, and only the server’s own `/data` bind mount. `src/services/docker.js` verifies the resulting Docker inspect record before runtime adoption, while `src/services/runtime.js` reads `/etc/os-release`, hostname, and cgroup limits from the running container with a fixed internal probe. The Linux kernel remains shared by Docker containers; the panel must never label it as a guest kernel. KVM is required for a separate kernel; Incus/LXC remains a shared-kernel system-container model.
