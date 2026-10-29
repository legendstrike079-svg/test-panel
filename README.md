# Zenith Panel

A **Pterodactyl-style Minecraft and dedicated-game hosting panel** with a pure **Node.js backend** — no PHP, no separate Wings daemon, no database server to install. One process supervises your Minecraft servers, streams their consoles in real time, installs plugins straight from **Modrinth**, gives every server a **subdomain**, manages **players in one click**, graphs host history, and can even be driven from **Discord**.

> UI/pages were inspired by the [JTG panel](https://github.com/JishnuTheGamer/Jtg) (dark, control-room look); the backend, runtime supervisor, installer and every line of code here are original and self-contained.
>
> **Everything in this repository is new code.** No files were copied from the reference repository.

```
   ┌───────────────────────────────────────────────────────────────┐
   │  Browser (vanilla JS UI, no build step)                       │
   │  dashboard · analytics · servers · console · players · backups  │
   └───────────────┬───────────────────────────────┬───────────────┘
                   │ REST /api/*                    │ WebSocket /ws
   ┌───────────────▼───────────────────────────────▼───────────────┐
   │  Zenith Panel  (single Node.js process)                        │
   │   express API · ws console · auth/RBAC · scheduler             │
   │   runtime supervisor ── spawns ──► java -jar server.jar        │
   │   modrinth · playit · backups · java manager · nodes           │
   └───────────────┬───────────────────────────────────────────────┘
                   │ child processes + filesystem
      servers/<id>/  world/ plugins/ server.properties  …  backups/
```

---

## Feature overview

### Real-time console
* WebSocket stream (`/ws`) with a rolling in-memory buffer (3000 lines default) — reconnect and you get a snapshot, not a blank screen.
* Automatic fallback to HTTP long-polling when a proxy blocks websockets, so the console works everywhere.
* Command input, coloured log classification (join/leave, WARN, ERROR, panel/installer lines), player tracking parsed from the log, "jump to end", clear buffer.
* Power actions: start, restart, graceful stop (sends `stop`/`end`, then SIGTERM, then SIGKILL after `STOP_TIMEOUT`), force kill.
* Live CPU %, memory (RSS of the JVM + children), uptime, disk usage, progress bars for installs/backups/Modrinth downloads.

### Server software
Install and switch between, all downloaded live from upstream APIs (new Minecraft versions appear without a panel update):

| Type | Source | Notes |
|---|---|---|
| Vanilla | Mojang version manifest | all releases |
| Paper / Velocity | `fill.papermc.io` v3 | stable build picked automatically |
| Purpur | `api.purpurmc.org` | latest build |
| Fabric / Quilt | fabricmc / quiltmc meta | loader + server launcher jar |
| Forge / NeoForge | maven | installer run for you (`--installServer`) |
| BungeeCord | `ci.md-5.net` | latest successful build |
| Spigot | BuildTools | optionally built from source |
| Custom | upload | bring your own jar |

### One-click software and version switch
In a Minecraft server’s **Settings → Software & version**, select **One-click software switch** to move, for example, from Paper 1.21.1 to Paper 1.21.4 or from Paper to Fabric. The picker loads releases live from the selected upstream provider, supports searching, and refuses arbitrary/unavailable type-version pairs on the server as well as in the UI.

The server must be stopped. Zenith attempts a real safety backup before replacing the jar/launcher, preserves worlds and ordinary configuration files, and streams the installer’s real progress or failure to the console. If the safety backup cannot be made, its exact error is returned and logged; the requested migration then proceeds only as reported. Docker OS-image workloads intentionally do not expose this control because they have no Minecraft software to replace. Use **Reinstall software** when the selected type and version are already installed, or **Upload custom jar** for custom builds.

### Modrinth integration (plugins & mods)
* Global search page + per-server **browse** tab pre-filtered by the server's loader and Minecraft version (Paper→`paper|spigot|bukkit`, Fabric→`fabric`, NeoForge→`neoforge`, …).
* One-click install into `/plugins` or `/mods`, with **recursive required-dependency resolution**.
* Installed list with version, size, source, enable/disable (renames to `.jar.disabled`), delete, and **update checking** against the newest compatible version (old jar kept as `.bak`).
* Project detail modal with changelog-free version picker (all compatible builds, release/beta/alpha badges).
* Icons are proxied through the panel, so the UI also works on networks that block external requests.

### playit.gg tunnels
Free public addresses without port forwarding, implemented against the playit **agent v1.x** (daemon + CLI):
1. Panel downloads `playit-agent` + `playit-cli` for the host architecture into `data/bin`.
2. `playit-cli claim generate` → `claim url` → a real `https://playit.gg/claim/<code>` link is shown in the UI **and** in the server console.
3. `claim exchange` runs in the background; the moment you approve the agent in your browser, the secret is stored and the daemon starts (`playit-agent --secret … --socket-path … --log-path …`).
4. Agent logs are tailed into the server console; tunnel addresses (`*.playit.gg:port`) are parsed and shown as the public address.
5. Per-server isolation (own secret, own socket, own log), optional autostart with the server, reset flow to re-claim, or paste an existing secret key.

### File manager
Browse, create folders, edit text/config files in a modal editor, upload (drag & drop, multi-file), download files **and folders** (zipped on the fly), rename, copy, delete, zip/unzip archives, recursive file search, live `server.properties` editor with the common gameplay keys. Every path is validated against traversal.

### Docker containers (Minecraft runtime + general workloads)
* Switch a node to **Docker containers** (Nodes → node settings, or `install.sh --node docker`) — *or* a single Minecraft server
  (Create Server → *Runtime*, Server → Settings → *Container runtime*) — and it runs in a real `eclipse-temurin:<java>-jre`
  container with its server directory bind-mounted at `/data`, allocation published for **tcp + udp**, and real Docker limits.
* Administrators also get a first-step **Minecraft Server / Docker Container** choice in Create Server. The container path has
  Details → Image → Review stages and accepts only the audited templates: **Ubuntu 22.04, Ubuntu 20.04, Debian 11, Debian 12,
  Python 3.12, or Node.js 20**. **Ubuntu/Debian** are the Linux VM-style workspace choices (honestly still Docker containers
  with a shared host kernel); **Python/Node.js** are dedicated bot-hosting application runtimes. The local daemon pulls the
  selected tag (`ubuntu:22.04`, `debian:12`, `python:3.12-slim`, etc.) at provisioning; there is no simulated-container fallback.
* Every workload receives a persistent `/data` mount, requested Docker RAM/CPU limits, Files, Network, Settings and Backups.
  Its compact server menu deliberately omits Minecraft worlds, players, properties, SFTP, Modrinth, plugins, schedules and people.
  **Ubuntu/Debian workspaces** have no embedded panel terminal: they install/run SSHX inside their real container and Console shows
  only SSHX’s genuine emitted browser-session URL. **Python and Node.js bot runtimes do not install or expose SSHX.** Create the
  workspace, upload a safe relative startup file (`bot.py` or `index.js`) and choose a managed startup command in Settings, then Start.
  Python permits `python <startup-file>`; Node permits `node <startup-file>` or `npm start`. Python installs `requirements.txt` when
  present; Node installs `package.json` dependencies. The selected command and all dependency/application output run inside that bot
  container and stream to Console—never on the panel host. Shell operators, quoted commands, Docker flags, arbitrary images, and host
  command execution are rejected.
* The Minecraft console is a real attach (`docker start -a -i`), and all containers expose Docker's actual stats. Docker image
  selection for a general workload is immutable after creation, avoiding unreviewed arbitrary-image execution.
* The panel refuses to pretend: if Docker is missing, saving the node fails with the exact error; a failed pull/create/start writes
  the Docker error to the workload log and leaves it offline/crashed instead of claiming it is running. It verifies the real Docker
  storage driver from container inspect or, on hosted engines that omit that field, from `docker info`. If the engine discloses neither,
  the workload still has its unique Docker container/rootfs identity and verified mounts/namespaces, but the UI states **driver not disclosed** rather than fabricating one.
* `install.sh` installs Docker from Docker's own apt repository, checks and reports the daemon's real storage driver, pre-pulls the Temurin image, adds your user to the `docker` group, and proves a container really starts before the node is marked healthy. Isolated workloads copy the panel host's non-loopback DNS resolvers into their Docker configuration; set `DOCKER_WORKLOAD_DNS="1.1.1.1,8.8.8.8"` only if a hosted Docker bridge still cannot resolve package/SSH endpoints. The supplied Compose deployment also includes the Docker CLI,
  host-socket control-plane mount and an explicit host-path mapping so Docker workloads work when the panel itself is containerised.

### Automatic node installation (installer)
* `install.sh` (no flags needed) detects the host - CPU cores, RAM, disk, IPs, Java, Docker - boots the panel,
  registers **Local Node** through the panel API with a **generated credential** (`OWNER_SECRET` protects that path),
  then runs a **real health check**; only if every check answers does the node go online.
* Node modes: `--node local` (java processes), `--node docker` (containers), `--node remote` (this host via the agent
  API), `--node none`. Optional extras: `--docker yes|no|auto`, `--node-runtime process|docker`, `--java yes|no`.
  **No Pterodactyl wings is installed or shipped** - the panel drives Docker itself.
* The runtime is decided **before** `.env` is written, so the panel boots with `NODE_RUNTIME` already correct, and the
  installer's `OWNER_SECRET` exists before the panel starts (a running panel never re-reads `.env`).
* Owner account defaults to `admin@gmail.com` / `admin123` (`--user`, `--password`, `--email` override). The password is
  never printed on the login page - change it in **Account** after the first sign-in.
* Idempotent: re-running refreshes the existing node and keeps its credentials - no duplicate *Local Node* records, even
  with the 60 s reporter service running. `--repair` re-detects the host, fixes the node and re-runs the health check;
  `--node-only` touches only the node; `--uninstall [--purge]` stops the panel and removes the agent, containers and
  credentials (your `data/`, `servers/` and `backups/` are never deleted).
* Everything is logged to a timestamped file (`/tmp/zenith-install-*.log` by default) and every failure prints the exact
  command output instead of a success message.

### SFTP
* A **real SSH/SFTP server** (ssh2) with its own generated RSA host key: log in as `<panel user>.<server id>` with your
  panel password (or an API key) and reach *that server's* files with FileZilla, WinSCP, Cyberduck, `sftp` or `rsync -e ssh`.
* Sessions are chrooted to the server directory - `..` and absolute paths are rejected, `level.dat`, worlds, plugins and
  configs are all reachable, and every request is answered (never a silently dropped session).
* Admin → Settings toggles it and sets the port; the state shown in the UI is the real listener state.

### Worlds
* Detects every world on disk (any folder with a `level.dat`), sizes it, counts region files and shows when it was last
  played. Activate (rewrites `level-name`), download as a real zip, duplicate, import a world zip (traversal-safe,
  `level.dat` required) and delete - the active world is protected, and nether/end folders travel with their overworld.

### server.properties editor
* A labelled form for the common settings (motd, port, players, difficulty, whitelist, view distance, ...) plus every
  other key, and a raw text view. Saves keep a `server.properties.bak`, refuse junk, and warn when a running server
  needs a restart.

### Remote nodes
* Add a node → run the generated one-liner on that machine (installs Node, Java, the agent and a systemd service called `zenith-node`).
* Pick the node when creating a server, or move an existing (stopped) server to it later.
* The agent API is token-authenticated (`x-node-token`), heartbeats every 30 s and reports cores, load, memory, disk and its running servers; the panel pings it every 60 s so the Nodes page shows live bars.
* Console, power, commands, stats, schedules, backups **and Modrinth plugin/mod installs** work on remote servers (the node downloads the jar itself); general file-manager access still targets the panel host's copy.

### Subdomains (join addresses)
* Admin sets a base domain + provider once (**Admin → Settings → Subdomains**) — used by every server.
* With a **Cloudflare API token** the panel creates and deletes the records itself: an `A` record for the node IP plus a `_minecraft._tcp` **SRV** record pointing at the port, so players join `survival.example.com` and never type a port.
* Without a token everything still works in **manual mode**: the panel prints the exact `A`/`SRV` pair to paste into any DNS provider.
* Create a subdomain from the create-server wizard or later in **Server → Network**; hostnames are uniqueness-checked panel-wide and removed cleanly (records included).

### Player manager (live list + one-click actions)
* Live online list with **real 3D skin heads** (fetched through the panel's image proxy, so it works behind firewalls and on mobile that block skin CDNs).
* One-click buttons for the things admins actually do: **full health**, **full hunger**, **op/deop**, plus a full action sheet — give items, gamemode, XP, flight, teleport to spawn, whitelist/unwhitelist, kick, ban/pardon, kill, clear inventory, play time.
* Works on a name you type too (for offline players), in bulk via the API, and identically on **remote nodes** (the command is forwarded to that node's agent).
* Every action is validated server-side (player names, item ids, counts, gamemode, reasons) before it reaches the console — no command injection, and all of them are written to the audit log.

### Analytics & allocations
* The panel samples the host every 5 s into a bounded in-memory ring buffer (1 hour) and draws **static SVG charts** — CPU, memory, players online, servers running — no chart library, no CDN, nothing to load.
* Dashboards show live sparklines; **Analytics** (`analytics.html`) shows the full window, peak/average summary, a server-status donut and the audit trail.
* **Allocations** (`allocations.html`) maps every port of every node: used, free, next free, and which server/owner holds it.

### Discord bot
* Configure a bot token + guild id in **Admin → Settings → Subdomains & Discord** and the panel connects its own gateway client — no `discord.js`, no extra dependency (`ws` is already there).
* Commands like `!servers`, `!status`, `!start/!stop/!restart`, `!cmd`, `!players`, `!op`, `!give`, `!heal`, `!allocations` and linked-panel-admin-only `!newserver` (an owner/admin can choose or create the owner account, then provisions the server).
* Identity is mapped to panel accounts (`!link <username> <password>`), so a Discord user only sees and controls what their panel account may access; server events (started/stopped/crashed) can be posted to a notification channel.
* Step-by-step setup, permissions and troubleshooting: [`docs/DISCORD.md`](docs/DISCORD.md).

### Backups
* Zip backups into `backups/<server-id>/` using the system `zip` (streaming, low memory) with an `adm-zip` fallback.
* Create (manual or scheduled), download, lock (never pruned), delete, prune, and **restore** — which stops the server, extracts over the files, rewrites `eula.txt` and restarts it.
* Progress for big worlds is streamed to the console.

### Scheduling
Per-server cron tasks (`minute hour day month weekday`): start, restart, stop, backup, or run a console command. Tick resolution 30 s, "run now" button, last-run result stored.

### Panel administration
* Roles: **owner > admin > user**, plus per-server **subusers** with granular permissions (`console, files, backups, plugins, network, settings, schedules, subusers`).
* User CRUD, suspend, password reset, audit log of every action (`/api/system/activity`).
* Panel settings: name, open registration, default memory, max servers per user, automatic JRE downloads, crash auto-restart.
* API keys (`X-API-Key`, shown once at creation) for automation, panel config export, health/metrics endpoints.
* Per-user server limits (quota per account, falling back to the panel-wide default in Settings).
* **Multi-machine hosting:** besides the built-in local node you can attach any number of remote nodes with one `curl | bash` command. The agent downloads the server jar, provisions its own JRE, and runs the process there - the panel keeps the console (mirrored in real time), power controls, live stats, schedules, backups (archived on the node, pulled to the panel) and server moves between nodes. Each node has a detail view with live telemetry, its server list and the agent command.

### Java runtimes
* Detects JVMs (PATH, `JAVA_HOME`, `/usr/lib/jvm`, panel-managed).
* Automatically downloads **Temurin JREs** (Adoptium API) into `data/java/jre-<major>` when a server needs one — so a fresh VPS can run a 1.21.4+ server with zero manual Java setup.
* Version mapping: 26.x → 25, 1.20.5+/1.21+ → 21, 1.18–1.20.4 → 17, older → 8. Pin a runtime per server if you prefer.

### Auto-installer (`install.sh`)
One script for **any** environment: Ubuntu/Debian/Mint, RHEL/Rocky/Alma/Fedora/CentOS, Arch/Manjaro, openSUSE, Alpine, with or without systemd.

---

## Screens

| Page | What is on it |
|---|---|
| `index.html` | sign in (opens the register form when registration is allowed) |
| `register.html` | stand-alone sign-up page (respects the panel's registration setting) |
| `dashboard.html` | private fleet overview: only servers the signed-in user owns or can access, aggregate totals, scoped power actions, and an explicit **Open console** action—no embedded or automatic console |
| `analytics.html` | CPU/RAM/players history charts built from the metrics ring buffer |
| `servers.html` | server cards (banner, status pill, node/address/CPU/memory/storage/players tiles), search + status/sort filters, 1-3 column layout switch, admin-only initial Minecraft/Docker choice; Minecraft uses Details → Version → Review while containers use Details → Image → Review (Ubuntu, Debian, Python, Node.js) |
| `server.html` | a dedicated persistent server sidebar—without the global panel rail or hamburger—containing Minecraft’s 12 tabs and a reduced container menu (**console, files, network, settings, backups**); a Docker workload starts SSHX inside its real container after image preparation and surfaces SSHX’s actual browser-session link in Console, while the Minecraft console retains its live stat tiles and CPU/memory/network charts |
| `nodes.html` | local + remote nodes, Docker engine card, health checks, node settings, allocations |
| `allocations.html` | every port across every node, what is free and what is used |
| `admin.html` | **7 tabs**: users, servers, settings (runtime/SFTP), integrations (DNS + Discord), allocations, java, activity |
| `account.html` | profile, password, API keys, your servers |
| `apikeys.html` | dedicated API key page with copy-ready curl examples |

## Quick start

### 1. One-command install (recommended)

```bash
# interactive
curl -fsSL https://raw.githubusercontent.com/your-org/zenith-panel/main/install.sh | sudo bash

# fully unattended (installs Node 20, Java, PM2/service, generates secrets, creates the owner)
sudo bash install.sh --yes --port 8080 --user admin --password 'SuperSecret123' --email me@example.com
```

What it does: detects the distro + package manager → installs base tools, Node.js 18+/20 and Java → clones/copies the panel → writes `.env` with generated `JWT_SECRET` + `NODE_SECRET` → `npm ci --omit=dev` → creates the owner account → installs a **systemd service** (or PM2 / Docker / nohup fallback) → optional **nginx + Let's Encrypt** reverse proxy with websocket upgrade → opens the firewall (panel port + 25565-25665) → health check → prints the panel URL and credentials.

### GitHub Codespaces — one-click panel port

The repository includes `.devcontainer/devcontainer.json`, which pre-forwards the default panel port **8080** as **Zenith Panel** and installs a real Docker-in-Docker engine for Docker Minecraft, OS-image, and dedicated-game workloads. In a GitHub **Codespace** (not the read-only github.dev editor), run `bash install.sh -y`. Once the health check succeeds, the installer detects Codespaces, keeps port 8080 private, prints its `https://<codespace>-8080.app.github.dev` URL, and GitHub shows the forwarded-port notification. Click **Open in Browser** — no host/IP lookup or manual port-forward command is needed.

If you opened a Codespace made from an older revision, select **Codespaces: Rebuild Container** once after pulling this revision. Then verify the genuine daemon with `docker info` and run `bash install.sh --repair --node docker -y` if the Local Node was already registered as a process node. Do not select Docker in the panel until `docker info` succeeds: a browser panel cannot start a missing daemon safely or fabricate container status.

For `--port <other-port>`, Codespaces still discovers the live `0.0.0.0` listener and the installer prints the matching URL; use the generated entry in the **Ports** panel if the browser notification is not shown.

Useful flags:

```bash
bash install.sh --help
  -p, --port <n>        panel port (default 8080)
  -u, --user <name>     owner username        -P, --password <pw>   owner password
  -e, --email <mail>    owner e-mail          -n, --name "<panel>"  panel name
  -d, --dir <path>      install directory     --url <url>           public panel URL
      --domain <fqdn>   configure nginx       --ssl                 also request a cert
  -y, --yes             unattended            --docker              run via docker compose
      --pm2             use PM2 instead of systemd
      --skip-java / --skip-node               --update / --uninstall [--purge]
```

### 2. Manual install

```bash
git clone <this repo> zenith-panel && cd zenith-panel
npm install
cp .env.example .env          # set JWT_SECRET at minimum
npm run createuser -- --user admin --pass 'SuperSecret123' --role owner
npm start                     # http://localhost:8080
```

### 3. Docker

```bash
# Run from the project directory. Compose passes the host Docker socket only to
# the panel control plane and maps this directory's ./servers to the host path
# Docker needs for each workload's /data mount.
JWT_SECRET=$(openssl rand -hex 32) ZENITH_OWNER_PASS=changeme123 docker compose up -d --build
```

This Compose deployment can create Minecraft Docker servers and the curated Docker OS-image
workloads. To keep server files outside the project directory, set
`HOST_SERVER_DATA_DIR=/absolute/path/to/servers` before `docker compose up`; it must be the same
host directory mounted as `./servers:/app/servers` (adapt that volume source too).

> The Docker socket is intentionally mounted only into the trusted panel control plane, never into
> a tenant workload. Docker-socket access is host-administrator-equivalent: keep the panel private,
> use a strong owner password, and do not grant panel-admin access to untrusted users.

### 4. Management CLI

```bash
./scripts/zenith status|start|stop|restart|logs|update
./scripts/zenith user add steve 'theirpassword' user
./scripts/zenith backup-db | doctor | version
```

### 5. Verify an install

`scripts/smoke.js` logs in and walks the whole API plus the websocket console handshake - useful
after an upgrade or when something "looks wrong":

```bash
node scripts/smoke.js --url http://localhost:8080 --user admin --pass 'yourpassword'
#  51 passed  <- exit code 0 means every subsystem answered

# optional: render every page headlessly and fail on any JavaScript error
npm install --no-save jsdom
node scripts/uitest.js --url http://localhost:8080 --user admin --pass 'yourpassword'
#  All UI checks passed.
```

---

## Repository layout

```
server.js                  entry point: express + ws + bootstrap
install.sh / uninstall.sh  universal installer, remover
ecosystem.config.cjs       PM2 config        Dockerfile / docker-compose.yml
scripts/
  createuser.js            CLI user management
  zenith                   service management CLI
  node-agent.js            remote node agent (heartbeat + node API on another box)
  smoke.js / uitest.js     end-to-end API/websocket self-test, headless UI test (jsdom)
  node.sh                  one-liner node installer (curl | bash)
  fake-docker.js           test double for the docker CLI (tests only - never used at runtime)
  package.js               builds dist/zenith-panel-<version>.zip and enforces the 25 MB budget
  manifest.js              regenerates FILES.md
  theme-preview.js         builds preview/theme.html - a static, self-contained look at the
                           servers list and console page (inline CSS/SVG, no network)
preview/
  theme.html               generated visual preview of the two reworked pages
src/
  config.js  db.js         env config, dependency-free JSON database
  auth.js    logger.js     JWT + bcrypt + RBAC + API keys, audit log
  routes/                  auth, servers, files, backups, modrinth, playit,
                           players, subdomains, admin
  services/
    runtime.js             process supervisor, log ring buffer, players, stats hook
    stats.js               /proc sampling (CPU%, RSS of process tree), host metrics,
                           host network counters (rx/tx bytes + rates from /sys/class/net)
    versions.js            upstream catalogue + jar/installer downloader
    java.js                JVM detection + Temurin downloader
    modrinth.js            search, install, dependencies, updates, enable/disable
    playit.js              v1.x claim flow + daemon supervision
    backups.js             zip/unzip backup engine
    files.js               safe file manager
    docker.js              real docker CLI wrapper (probe, pull, create, attach, stats, logs)
    servers.js  nodes.js   server records, port allocation, nodes + auto-registration/health checks
    worlds.js              world detection, activation, zip export/import
    sftp.js                ssh2 SFTP server: auth via panel credentials, chroot per server
    players.js             player action table (op/heal/feed/give/…) + roster parsing
    metrics.js             5 s host ring buffer behind the Analytics graphs
    dns.js                 subdomains: Cloudflare records or manual instructions
    discord.js             gateway bot (no discord.js): commands, !link, !newserver
    scheduler.js           cron ticker + task execution
  middleware/compress.js  brotli/gzip response compression + cache headers (zlib only, no dependency)
  ws/console.js            websocket fan-out, auth, stats push
public/                    zero-build frontend (HTML + CSS + ES5-ish JS)
  index.html  register.html  dashboard.html  analytics.html  servers.html  server.html
  nodes.html  allocations.html  admin.html  account.html  apikeys.html
  css/app.css  js/app.js      shell: API helper, toasts/modals, charts, Layout (sidebar + topbar)
               js/components.js  shared UI: global search, notifications, tutorial, image cropper,
                                 searchable/categorized dropdowns, Modrinth version picker, update watch
tests/                     verification suite (bash tests/run.sh runs all of it)
  run.sh                   throwaway panel + fake docker + every suite, with a summary
  lib/harness.js           shared jsdom harness used by the page checks
  pages-panel.js           every page renders + its own contracts
  pages-theme.js           the reworked servers list and console page
  pages-mods-components.js Plugins/Mods tabs + the shared component set
  runtime-api.js           a server really running inside a container
  installer-node-check.sh  the installer's own node functions (register/health/idempotency)
  compression.js           transfer size, encodings and cache headers on every asset
  size-check.js            the release footprint stays under 25 MB
docs/                      API.md, ARCHITECTURE.md, NODES.md, DISCORD.md
FILES.md                   generated inventory: every file, its size and its purpose
data/  servers/  backups/   runtime state (git-ignored)
dist/                      release archives built by npm run pack (git-ignored)
```

## Footprint & transfer size

The panel is deliberately small: **~1.4 MB of code, ~442 KB as a release archive, ~9.6 MB fully
installed** (code + production `node_modules`). The budget is enforced, not aspirational —
`npm run pack` and `npm run size` both fail above 25 MB.

| What | Size |
|---|---|
| Source, frontend, docs, tests, installer | 1.39 MB (99 files) |
| `dist/zenith-panel-1.0.0.zip` (`npm run pack`) | 442.2 KB |
| Installed tree (`npm ci --omit=dev --omit=optional`) | 9.6 MB |
| Production `node_modules` | 8.1 MB (8 direct dependencies) |
| First-load JS + CSS over the wire | 299.4 KB → **69.9 KB** (brotli, −77 %) |

How it stays there:

* **8 runtime dependencies only** — express, ws, jsonwebtoken, bcryptjs, multer, ssh2, adm-zip,
  dotenv. No build step, no bundler, no framework; the frontend is hand-written HTML/CSS/JS served
  straight from `public/`. There are **no dev dependencies**: jsdom, needed only by the page suites,
  is fetched on demand by `npm run verify:install`.
* **`npm ci --omit=dev --omit=optional`** everywhere (installer and Dockerfile): the optional native
  add-ons ssh2 would compile (`cpu-features`, `nan`) are skipped and ssh2 uses its pure-JS fallback.
* **Java runtimes are never stored in the project.** A Temurin JRE is 50-160 MB; `JAVA_DIR`
  defaults to `/var/lib/zenith/java` on an installer-provisioned host (`~/.zenith/java` when
  non-root) and runtimes are downloaded only when a server needs one. Admin → Java → *Disk usage*
  shows what is on disk and frees what is not in use (`POST /api/system/java/prune`).
* **Responses are compressed** by `src/middleware/compress.js` (Node's `zlib`, no dependency):
  brotli level 9 for `/css`, `/js`, `/assets` with a small cache, gzip for the rest, 1 KB
  threshold, 4 MB cap. Static assets are `public, max-age=3600, must-revalidate` with strong
  ETags, API responses are `no-store`, and 204/304/206/Range bodies are passed through untouched.

```
npm run size            # table of what ships, what is runtime, and the 25 MB verdict
npm run pack            # dist/zenith-panel-<version>.zip  (fails if > 25 MB)
npm run pack:verify     # ...and unpack it elsewhere, npm ci, boot it, hit /api/version
```

The archive ships code, `public/`, `scripts/`, `tests/`, `docs/`, `install.sh`, `uninstall.sh`,
Docker/PM2 files and docs. It leaves out `node_modules/` (reinstalled by `npm ci`), your runtime
folders (`data/ servers/ backups/ logs/ dist/`) and the design references in `uploads/`.

## Appearance and account policy

**Administration → Panel settings** is a live branding workspace: an owner/admin can choose a
Midnight, Obsidian, Graphite or Ocean theme, select the accent colour, set the panel name, and crop
and upload a square PNG/JPEG/WebP panel logo. A bundled Zenith Panel artwork is the default logo and is restored whenever a custom logo is reset. It also accepts a full-page PNG/JPEG/WebP background,
optimises it in the browser, and provides a persisted 0–100% opacity control. The background, logo,
and theme apply to every authenticated route plus the sign-in and registration pages without a panel
restart. Branding input is validated server-side and stored compactly in the self-hosted settings
store.

A fresh panel is closed to public registration by default. It creates no demo users: the first
setup/installer owner is the only account until that owner intentionally adds a real person from
**Administration → Users**. Discord-driven account creation is off by default as well. Public
registration can be explicitly enabled from Panel settings when that is wanted.

## Configuration (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `PANEL_NAME` / `PANEL_URL` | Zenith Panel / `http://localhost:8080` | branding + URLs used in install commands |
| `PORT` / `HOST` | 8080 / 0.0.0.0 | panel bind address |
| `JWT_SECRET` | generated | token signing (auto-written if missing) |
| `OWNER_SECRET` | installer-generated | lets `install.sh` register the local node without a password; blank it to disable |
| `NODE_RUNTIME` | `process` | default runtime for new servers on this host: `process` or `docker` |
| `DOCKER_BIND_ROOT` | empty | only for a panel running inside Docker: absolute **host** server-data path used by Docker's `/data` bind mount |
| `SFTP_ENABLED` / `SFTP_PORT` | `true` / `2022` | the real SFTP server (ssh2) and its port |
| `ALLOW_REGISTRATION` | true | open self-registration (the installer writes `false`) |
| `DATA_DIR` / `SERVER_DATA_DIR` / `BACKUP_DIR` | ./data ./servers ./backups | storage layout |
| `MAX_UPLOAD_SIZE` | 5 GB | file manager upload cap |
| `JAVA_BIN` / `JAVA_DIR` | java / `./data/java` (installer: `/var/lib/zenith/java`) | JVM discovery + where managed JREs are downloaded. **Keep it outside the project folder** — each JRE is 50-160 MB |
| `STOP_TIMEOUT` / `LOG_BUFFER_LINES` | 20 / 3000 | graceful stop window, console buffer |
| `AUTOSTART_SERVERS` | true | start `autoStart` servers when the panel boots |
| `MODRINTH_API` / `MODRINTH_USER_AGENT` | api.modrinth.com/v2 | Modrinth endpoint + contact UA |
| `PLAYIT_BIN_DIR` / `PLAYIT_GLOBAL_SECRET` | ./data/bin / empty | agent location, shared secret |
| `NODE_SECRET` | generated | shared secret for remote node registration |

## Security notes

* bcrypt password hashing, JWT sessions with a `passwordVersion` so password changes invalidate old tokens, login brute-force throttling per IP+user.
* Every server route passes through `serverScope(permission)` — ownership, subuser permissions and admin role are checked before the handler runs.
* File manager and Modrinth installer resolve paths with `safeJoin()`; `../../` escapes are rejected, and the panel's own `.playit` folder is off limits.
* Servers are spawned with `spawn(bin, args)` — never a shell — so a server name or console line cannot inject commands.
* Run the panel as a **dedicated non-root user**; child JVMs inherit that privilege. Containers: mount `data/ servers/ backups/` as volumes. If the panel runs inside Docker and must create host Docker workloads, use the supplied socket mapping plus `DOCKER_BIND_ROOT`; the socket stays in the control plane and is never passed to a tenant container.
* A Docker socket is host-administrator-equivalent. Only mount it for a trusted, admin-gated panel; do not expose the panel to untrusted administrators or the public internet.
* Loot/abuse note: the panel is a remote-control surface for your machine. Put it behind HTTPS + a strong password (the installer offers nginx + certbot), or keep it on a private network/VPN.

## API cheat-sheet

Full reference: [`docs/API.md`](docs/API.md). Console socket: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' | jq -r .token)

curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/servers            # list
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"SMP","serverType":"PAPER","version":"1.21.4","memory":4096,"eulaAccepted":true}' \
  localhost:8080/api/servers                                                    # create + install
curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:8080/api/servers/<id>/start
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"command":"say hi"}' localhost:8080/api/servers/<id>/command
curl -s -H "Authorization: Bearer $TOKEN" "localhost:8080/api/modrinth/search?q=essentials&projectType=plugin"

# players: list, one-click action, bulk
curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/servers/<id>/players
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"heal"}' localhost:8080/api/servers/<id>/players/Notch/action
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"give","item":"diamond","count":8}' localhost:8080/api/servers/<id>/players/Notch/action

# subdomains, history, allocations, discord
curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/servers/<id>/subdomains
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sub":"survival"}' localhost:8080/api/servers/<id>/subdomains
curl -s -H "Authorization: Bearer $TOKEN" "localhost:8080/api/system/history?minutes=30"
curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/system/allocations
curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/api/system/discord
```

## Testing & verification

```bash
npm install             # 8 runtime dependencies, ~8 MB, no dev dependencies
npm run verify:install  # fetches jsdom on demand - only the page suites need it
npm run verify          # == bash tests/run.sh: throwaway panel, fake docker, every suite
npm run size            # footprint report + hard 25 MB budget check
npm run pack            # builds dist/zenith-panel-<version>.zip (add --verify to boot it)
```

`npm run verify` never touches your own panel: it starts a temporary one in a temp directory on
`:8090` (override with `PORT=…`), creates the owner, creates a PAPER fixture and asserts the real jar
download, then runs:

| Suite | What it proves | Alias |
| --- | --- | --- |
| `scripts/smoke.js` | ~60 API checks, websocket handshake, auto-register idempotency, every asset | `npm run verify:api` |
| `scripts/uitest.js` | every page **and tab** renders in jsdom with zero JS errors | `npm run verify:ui` |
| `tests/pages-panel.js` | each page's own contract (nodes runtime badges, account photo/tour, admin tabs) | `npm run verify:pages` |
| `tests/pages-theme.js` | servers list + console page (rail, power controls, tile grid, charts, view switcher) | `npm run verify:theme` |
| `tests/pages-mods-components.js` | Plugins/Mods split and every shared component | `npm run verify:mods` |
| `tests/compression.js` | every text asset really is brotli/gzip encoded (raw HTTP, so decompression cannot lie), cache headers, 304 and Range pass-through | `npm run verify:compress` |
| `tests/size-check.js` | the shipped tree and the release archive stay under 25 MB, `data/java` holds no JRE | `npm run verify:size` |
| `tests/runtime-api.js` | a server really runs **inside a container** (checked through the docker CLI) | `npm run verify:runtime` |
| `tests/installer-node-check.sh` | the installer's node functions: registration, health gating, 3× idempotency | `npm run verify:installer` |

Without Docker on the machine, `run.sh` puts the test double on `PATH`
(`scripts/fake-docker.js`); the runtime checks then assert real container semantics without a daemon.
Further notes: [`tests/README.md`](tests/README.md).

`FILES.md` is a generated inventory of every file in the project
(`node scripts/manifest.js` regenerates it after adding files).

## FAQ / troubleshooting

**Do I need Docker?** No. Docker is optional (the panel's own Dockerfile/compose). Minecraft servers are plain child processes, which is why the panel also runs happily inside a container, on a Raspberry Pi, or on a 1 GB VPS.

**"Server jar not found"** — the software is still installing, or the install failed. Open the server console; installer output is streamed there. `Reinstall software` in the settings tab re-runs it.

**Console shows "live (polling)"** — the websocket was blocked by a proxy. Everything still works, just at ~1.5 s intervals. For nginx the installer already adds `Upgrade`/`Connection` headers.

**playit says "waiting for claim"** — open the claim link, sign in to playit.gg and approve the agent. The panel completes the exchange on its own and starts the daemon. Then create the Minecraft Java tunnel (local port = your server port) in the playit dashboard.

**Ports** — each server gets a port from the node's range (default 25565-25665). Open that range on your firewall; the installer does it for ufw/firewalld.

**Logs** — systemd: `journalctl -u zenith-panel -f`; PM2: `pm2 logs zenith-panel`; plain: `logs/panel.log`. Installer log: `/tmp/zenith-install-*.log`.

**"My remote node shows offline"** — the panel could not reach `http://<fqdn>:<agent-port>/api/node/status`.
Check that the agent service runs (`systemctl status zenith-node` on that box), that the port is open, and that
the FQDN/port in the node record are right (Nodes → details → *Ping agent*).

**"Remote server crashed right after start"** — usually the node ran out of RAM: the agent starts the JVM with
the memory you set in the panel, so give the box headroom (`free -m` on the node) or lower the server's memory.

**Remote backups** — the agent zips its copy and the panel pulls the archive into `backups/<id>/`, so listing,
download, pruning and restore work exactly like local ones. Restore streams the file back and the node extracts it.

**"My subdomain does not work"** — check the two records: an `A` record for the label → node public IP, and a
`_minecraft._tcp` `SRV` record → the same hostname with the port (priority 0, weight 5). In manual mode the panel
shows both; in Cloudflare mode press *Test connection* to confirm the token can see the zone.

**"The Discord bot does not answer"** — enable the **Message Content** intent in the Discord developer portal
(Bot → Privileged Gateway Intents), make sure the bot was invited to the guild with the `bot` scope, and check the
bot log in *Admin → Settings → Subdomains & Discord*.

**"Skin heads are blank"** — the browser could not reach the skin host; the panel proxies avatars through
`/api/system/proxy/image` for exactly this case. Blank heads still show the player's initial.

## Roadmap

* General file manager access to remote nodes (proxy uploads/downloads through the agent)
* Rename/patch operations on nodes so jars can be enabled/disabled remotely
* `.mrpack` modpack import on top of the per-file Modrinth installer
* WebDAV in addition to the SFTP subsystem
* Email alerts (Discord notifications already ship with the bot)
* Two-factor authentication and OAuth login

## License

MIT — see [LICENSE](LICENSE). Minecraft is a trademark of Mojang AB; this project is unofficial and not affiliated with Mojang, Pterodactyl, Modrinth or playit.gg.

### Dedicated SteamCMD game servers

**Administration → Servers → Create server → Dedicated game server** provides audited, Docker-backed SteamCMD templates for **Rust, ARK: Survival Evolved, Palworld, Valheim, Terraria, Counter-Strike 2, Garry’s Mod, Team Fortress 2, 7 Days to Die, Project Zomboid, DayZ, Unturned, V Rising, Conan Exiles, Satisfactory, Factorio, Don’t Starve Together, Space Engineers, Starbound, and Squad**.

For a Linux-native title, the panel reserves the full game/query port block, runs `SteamCMD +app_update <audited app id> validate` in that server’s persistent `/data` directory, streams the real installer output to Console, and starts the game binary inside a RAM/CPU-limited Docker container. **Reinstall / update game** repeats SteamCMD validation without erasing saved worlds or configuration.

**DayZ, Conan Exiles, and Space Engineers** ship official Windows-only dedicated binaries. They remain visible in the picker with an explicit Windows-node requirement and are deliberately blocked on a Linux Docker node; Zenith will not mislabel an unsupported Wine/Proton setup as a working server. Terraria and Starbound use account-gated SteamCMD payloads: set `STEAMCMD_USER` and `STEAMCMD_PASSWORD` in the trusted panel environment before provisioning. If `servers/` is not writable by SteamCMD’s image user, set `DOCKER_GAME_UID` to the directory owner’s `uid:gid`.

### Google and Discord sign-in
Zenith supports two real external identity flows from the sign-in and sign-up screens. They are off by default and no demo provider/account is created.

1. In **Administration → Panel settings → Google & Discord sign-in**, set **Public panel URL** to the public HTTPS origin users open (for Codespaces, use its forwarded browser URL). It overrides the `PANEL_URL` fallback for OAuth and needs no restart.
2. **Google / Firebase:** create a Firebase Web app, enable **Authentication → Sign-in method → Google**, add the panel hostname to Firebase **Authorized domains**, copy the four Web config values, then turn on Google and select **Save sign-in settings**.
3. **Discord:** create a Developer Portal OAuth2 application, copy the displayed callback URL exactly into **OAuth2 → Redirects**, enter Client ID and Client Secret, turn on Discord, and select **Save sign-in settings**.
4. Optionally enable **Allow provider sign-up**. When off, a provider can sign in only to an existing Zenith account with the same verified e-mail; when on, a verified provider identity may create a normal user account.

The provider switches are saved only through **Save sign-in settings** (or the page’s main **Save changes** control). Incomplete configuration is rejected with the exact missing requirement rather than leaving a provider that appears enabled but cannot sign in.

If Firebase, Discord, or a backup/provider call fails, the panel shows the upstream error instead of claiming that sign-in succeeded.

### Docker VPS isolation boundary
General Docker VPS workloads are created with a deterministic per-workload hostname, a dedicated user-defined bridge network, private PID/UTS/IPC namespaces, Docker’s private mount namespace, a writable image root filesystem, a single writable tenant bind at `/data`, `no-new-privileges`, a PID cgroup limit, and hard Docker memory/CPU cgroup limits. The panel reads Docker inspect data and then reads the running container’s real `hostname`, `/etc/os-release`, and cgroup limit files; it does not generate or hardcode Neofetch output. A container that does not pass that inspect policy is removed and recreated before it is accepted.

Docker containers **share the host kernel by design**. Therefore an honest Neofetch result may still show the host kernel release, and some older Neofetch/procfs paths can show host-wide CPU or RAM inventory even while Docker enforces the cgroup CPU/RAM limits. Zenith’s resource UI uses Docker’s per-container cgroup statistics and actual inspect limits, not those host-wide procfs values. Do not mount the Docker socket, host `/`, `/proc`, `/sys`, credentials, or other host directories into tenant workloads.

Use Docker for isolated application/system-container workloads where a shared kernel is acceptable. If users require a distinct kernel, hardware virtualization semantics, or a stronger hostile-tenant boundary, use **KVM/QEMU**. **Incus/LXC** can provide fuller system containers and optional `lxcfs` virtualised procfs views, but still shares the host kernel unless it is backed by a VM.
