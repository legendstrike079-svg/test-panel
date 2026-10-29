# Nodes

A **node** is a machine that runs Minecraft servers. Zenith has exactly one kind
of node — the panel drives it directly, either in-process (the panel host) or over
the small HTTP agent (another machine). There is no Pterodactyl wings anywhere in
this project, by design: `install.sh` never downloads or configures it.

| Node | What it is | How servers run |
| --- | --- | --- |
| **Local Node** (`id: local`) | the panel host, created by `install.sh` | Java child process of the panel, or a Docker container |
| **Remote node** | another machine running the agent (`/node.sh`) | the agent owns the process or container, the panel proxies to it over HTTP |

---

## 1. Automatic local node installation

`bash install.sh` (default `--node local`) does all of this with no manual steps:

1. **Detect the host** — CPU cores, RAM, free disk, Java, public + private IP,
   hostname, and Docker (`GET /api/nodes/detect` equivalents are the same probes).
2. **Decide the runtime** — `--node docker` forces containers; `--node local`
   keeps Java processes unless `--node-runtime docker` is given. The choice is
   written to `.env` as `NODE_RUNTIME=process|docker` **before** the panel starts,
   so the panel boots with the right value already in place.
3. **Install Docker if it is needed** (`--docker auto|yes|no`) using the official
   `get.docker.com` script for Debian/Ubuntu, and add the panel user to the
   `docker` group.
4. **Write `.env`** — port, URL, `JWT_SECRET`, **`OWNER_SECRET`** (32 random
   chars), `NODE_RUNTIME`, `SFTP_ENABLED`, `SFTP_PORT`, `ALLOW_REGISTRATION=false`.
   `OWNER_SECRET` is generated here and never after — that was the historical
   bug where a running panel had no secret to accept the registration with.
5. **Start the panel** (pm2 if available, otherwise systemd) and poll
   `/api/version` up to 30 s until it answers.
6. **Create the owner account** — `admin@gmail.com` / `admin123` by default
   (`--user`, `--password`, `--email` override). The installer never prints the
   password on the login page; change it in *Account* after the first sign-in.
7. **Register the node** — `POST /api/nodes/auto-register` with the
   `x-owner-secret` header, sending the detected host data and
   `local: true`. Admin-only; without the secret the call is rejected.
   The node is named **Local Node** and, on the very first run only, the panel
   mints its credential (printed once, stored in `/etc/zenith/node.env`, mode 600).
8. **Health check** — `POST /api/nodes/local/health-check` runs the real checks
   (panel process, CPU, memory, disk, Java, Docker when it is required, first
   allocation port). The node is marked **online only if every check passes**;
   otherwise it stays `offline` and the CLI prints the failing check verbatim.
9. **Reporter** — `zenith-node-report` (systemd timer or cron, every 60 s) keeps
   the panel's copy of the node fresh (stats + heartbeat) without a JWT.

Re-running `bash install.sh --repair` or `bash install.sh --node-only` is
idempotent: the registration refreshes the existing node, keeps its credential
and never creates a duplicate record. `--purge` removes `/etc/zenith/node.env`
and the agent files; `data/`, `servers/` and `backups/` are never touched.

### Idempotency rule

`auto-register` matches an existing node by `id` when the call says
`local: true` (or by `fqdn:port` for remote nodes) and returns

* `created: false` + `credentialMinted: false` — a re-run; credentials kept;
* `created: false` + `credentialMinted: true` — an existing node that had no
  credential yet (e.g. the panel's built-in record);
* `created: true` — a genuinely new node record (the only case that answers 201).

---

## 2. Runtime choice (process vs Docker)

`server.backend` is per server: `''` = *follow the node*, `'process'`, or
`'docker'`. `server.dockerImage` is used when the container runs.

* Chosen at create time (`<select name="backend">` on the Create Server wizard,
  plus the *Container runtime* card in Server → Settings).
* Changing it requires the server to be **offline**; the API answers 409
  otherwise (in both directions).
* Choosing Docker is validated against the target node immediately — locally via
  `docker.probe({force:true})`, remotely via the agent's `GET /api/node/status`.
  If the daemon is unreachable the request is refused with the engine's own error
  instead of silently creating a server that cannot start.

Container contract (identical locally and through the agent):

```
docker run -d --name zenith-<serverId> \
  -v <serverDir>:/data -w /data \
  -p <port>:<port>/tcp -p <port>:<port>/udp \
  --memory <memory+384>m --cpus <cores> \
  -e EULA=TRUE \
  eclipse-temurin:<java>-jre java -Xms<mem>M -Xmx<mem>M -jar <jar> nogui
```

The filesystem is bind-mounted, so Files, Worlds, SFTP, backups and Modrinth
installs keep working exactly as they do for process servers.

---

## 3. Remote nodes

```bash
# on the panel host: add the node in Nodes → Add node, copy the command
# on the new machine:
curl -fsSL http://panel:8080/node.sh | bash -s -- --panel http://panel:8080 --token <token> --port 8443
```

The agent (`scripts/node-agent.js`) exposes, behind `x-node-token`:
`/api/node/status`, `/api/node/{events,servers,ports}` and
`/api/node/servers/:id/{provision,start,stop,kill,command,config,files,file,restore}`.
It heartbeats every 30 s. On the panel the node can be edited (name, FQDN, port,
scheme, port range, memory/disk limits, maintenance mode, backend, image) with
`PATCH /api/nodes/:id`, and its allocations live on the Allocations page.

---

## 4. Installer flags (current)

| Flag | Effect |
| --- | --- |
| `--node local\|docker\|remote\|none` | what to provision on this host |
| `--node-runtime process\|docker` | explicit runtime override |
| `--node-port <n>` | agent port for `--node remote` (default 8443) |
| `--docker auto\|yes\|no` | install/repair Docker |
| `--java yes\|no` | install a system JRE |
| `--user`, `--password`, `--email` | owner account (defaults `admin@gmail.com` / `admin123`) |
| `--port`, `--host`, `--url`, `--domain` | panel address + optional nginx/certbot |
| `--pm2 auto\|yes\|no`, `--proxy auto\|yes\|no`, `--packages yes\|no` | infrastructure choices |
| `--update`, `--repair`, `--node-only` | re-run parts of the install (all idempotent) |
| `--uninstall`, `--purge` | stop/remove the service; `--purge` also drops node credentials |
| `--wings`, `--wings-port` | **removed** — accepted for compatibility, warn and ignored |

Logs: `/tmp/zenith-install-<date>.log` (or `$ZENITH_LOG`). Node credentials:
`/etc/zenith/node.env` (600).

---

## 5. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `The panel rejected the installer secret (OWNER_SECRET)` | the panel is running with an older `.env`. `pm2 restart zenith-panel` (or `systemctl restart zenith-panel`) and re-run `bash install.sh --node-only` |
| Node is `offline` with `docker: not available … (REQUIRED)` | the host has no working Docker but the node runs containers: `bash install.sh --repair --node-runtime docker`, then check `docker info` |
| `port 2022 is already in use` (SFTP) | sshd or another service owns the port — set `SFTP_PORT` in `.env` and restart the panel |
| A server cannot switch to Docker | daemon unreachable, or the server is still running (409 with the engine's message) |
| Node status never changes | the node was never health-checked: press **check** on the Nodes page or run `bash install.sh --node-only` |

Nothing in this file requires wings. If you find a `wings` instruction anywhere in
the repo, it is stale — report it.
