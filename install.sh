#!/usr/bin/env bash
#
#  ███████╗███████╗███╗   ██╗██╗████████╗██╗  ██╗
#  ╚══███╔╝██╔════╝████╗  ██║██║╚══██╔══╝██║  ██║
#    ███╔╝ █████╗  ██╔██╗ ██║██║   ██║   ███████║
#   ███╔╝  ██╔══╝  ██║╚██╗██║██║   ██║   ██╔══██║
#  ███████╗███████╗██║ ╚████║██║   ██║   ██║  ██║
#  ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝   ╚═╝   ╚═╝  ╚═╝
#  Zenith Minecraft Panel - one-line installer / updater / uninstaller
#
#  Supported: Debian/Ubuntu, RHEL/CentOS/Rocky/Alma/Fedora/Amazon, Arch/Manjaro,
#             openSUSE/SLES, Alpine - plus any other Linux with Node 18+ present.
#
set -u

PANEL_NAME="Zenith Panel"
PANEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${ZENITH_REPO:-https://github.com/your-org/zenith-panel.git}"

# ------------------------------- defaults -------------------------------
PORT="${ZENITH_PORT:-8080}"
HOST="${ZENITH_HOST:-0.0.0.0}"
PANEL_URL="${ZENITH_URL:-}"
ADMIN_USER="${ZENITH_USER:-admin@gmail.com}"
ADMIN_PASS="${ZENITH_PASS:-admin123}"
ADMIN_EMAIL="${ZENITH_EMAIL:-admin@gmail.com}"
DOMAIN="${ZENITH_DOMAIN:-}"
NODE_MAJOR="${ZENITH_NODE_MAJOR:-20}"
USE_PM2="${ZENITH_PM2:-auto}"          # auto | yes | no
SETUP_PROXY="${ZENITH_PROXY:-auto}"    # auto | yes | no
SETUP_PKG="${ZENITH_PKGS:-yes}"        # yes | no
INSTALL_JAVA="${ZENITH_INSTALL_JAVA:-yes}"
NODE_MODE="${ZENITH_NODE_MODE:-local}"   # local | docker | remote | none
INSTALL_DOCKER="${ZENITH_INSTALL_DOCKER:-auto}"  # auto | yes | no
NODE_RUNTIME="${ZENITH_NODE_RUNTIME:-}"  # process | docker   ('' = derived from NODE_MODE)
NODE_AGENT_PORT="${ZENITH_NODE_PORT:-8443}"
SFTP_PORT="${ZENITH_SFTP_PORT:-2022}"
ALLOC_START="${ZENITH_ALLOC_START:-25565}"
ALLOC_END="${ZENITH_ALLOC_END:-25665}"

ASSUME_YES="${ZENITH_YES:-no}"
OWNER_PASS_EXPLICIT="no"                # set when --password was given on the command line
PURGE_NODE="no"
ACTION="install"                       # install | update | uninstall | repair
SERVICE_NAME="zenith-panel"
NODE_SERVICE_NAME="zenith-node"
INSTALL_LOG=""
ANS=''

# ------------------------------ logging ---------------------------------
# Everything is appended to a real log file so failures can be inspected later
# (and so the "exact error" requirement is satisfied even after the script exits).
log_init() {
  INSTALL_LOG="${ZENITH_LOG:-${TMPDIR:-/tmp}/zenith-install-$(date +%Y%m%d-%H%M%S).log}"
  : > "$INSTALL_LOG" 2>/dev/null || INSTALL_LOG=/dev/null
  printf '%s\n' "--- zenith installer $(date -Is) | ${OS_PRETTY:-unknown os} | $(uname -m) | uid $(id -u) ---" >>"${INSTALL_LOG:-/dev/null}"
}
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"${INSTALL_LOG:-/dev/null}" 2>/dev/null || true; }

# Run a command, retry it a few times, keep the real output in the log.
#   try_cmd <attempts> <delay> <description> <cmd...>
try_cmd() {
  local attempts="$1" delay="$2" desc="$3"; shift 3
  local n=1 code=0
  while :; do
    log "run[$n/$attempts]: $desc :: $*"
    if "$@" >>"${INSTALL_LOG:-/dev/null}" 2>&1; then
      [ "$n" -gt 1 ] && ok "$desc (attempt $n)"
      return 0
    fi
    code=$?
    if [ "$n" -ge "$attempts" ]; then
      log "FAILED[$n/$attempts]: $desc (exit $code)"
      return "$code"
    fi
    warn "$desc failed (attempt $n/$attempts, exit $code) - retrying in ${delay}s"
    sleep "$delay"
    n=$((n + 1))
  done
}

# ------------------------------- output ---------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
  GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; CYN=$'\033[36m'
else
  B=''; DIM=''; R=''; GRN=''; YEL=''; RED=''; CYN=''
fi
say()  { printf '%s\n' "$*"; }
info() { printf '%s\n' "${CYN}==>${R} $*"; }
ok()   { printf '%s\n' "${GRN}  ok${R}  $*"; }
warn() { printf '%s\n' "${YEL}warn${R}  $*" >&2; }
err()  { printf '%s\n' "${RED}fail${R}  $*" >&2; }
die()  { err "$*"; exit 1; }
hr()   { printf '%s\n' "${DIM}────────────────────────────────────────────────────────────${R}"; }

banner() {
  hr
  say "${B}  ${PANEL_NAME} installer${R}   ${DIM}node.js minecraft control panel${R}"
  hr
}

usage() {
  banner
  cat <<EOF

Usage
  bash install.sh [options]

Options
  --port <n>            Panel port (default 8080)
  --host <ip>           Bind address (default 0.0.0.0)
  --url <url>           Public base URL, e.g. https://panel.example.com
  --user <name>         Owner account name (default admin@gmail.com)
  --password <pass>     Owner password (default admin123 - change it after the first login)
  --email <mail>        Owner email (default admin@gmail.com)
  --domain <domain>     Configure nginx + certbot for this domain
  --node-major <n>      Node.js major version to install (default 20)
  --pm2 <auto|yes|no>   Use pm2 for process supervision (default auto)
  --proxy <auto|yes|no> Set up the nginx reverse proxy (default auto = only with --domain)
  --packages <yes|no>   Install system packages with the detected package manager
  --java <yes|no>       Install a system JRE (the panel can also manage its own)
  --node <mode>         Local node setup (default local):
                          local   panel host node, servers as java processes
                          docker  panel host node, servers inside Docker containers
                          remote  /node.sh agent on this host, driven over the API
                          none    panel only, no node is provisioned
  --node-runtime <r>    process | docker  (explicit override of --node)
  --node-port <n>       Agent port for --node remote (default 8443)
  --docker <auto|yes|no> Install/repair Docker + the compose plugin (default auto)
  -y, --yes             Never ask - accept every default
  --update              Update an existing install (git pull + npm ci + restart)
  --repair              Re-run every step, re-detect the host and repair the node
  --node-only           Install/repair only the local node (runtime, agent, registration)
                        and refresh its registration - the panel is left alone
  --uninstall           Stop the panel and remove the pm2 service (keeps your data)
  --purge               With --uninstall: also remove node credentials and agent
                        files (data/, servers/ and backups/ are never touched)
  -h, --help            This help

Examples
  bash install.sh -y                                  # panel + Local Node (processes)
  bash install.sh --node docker -y                    # panel + Local Node in Docker
  bash install.sh --port 9090 --user zenith --password 'supersecret' -y
  bash install.sh --domain panel.example.com --email me@example.com -y
  bash install.sh --update
  bash install.sh --repair                            # fix a broken node without touching data

Docs: README.md  -  API: docs/API.md  -  Internals: docs/ARCHITECTURE.md
EOF
}

# --------------------------- argument parsing ---------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --port)      PORT="${2:?}";       shift 2 ;;
    --host)      HOST="${2:?}";       shift 2 ;;
    --url)       PANEL_URL="${2:?}";  shift 2 ;;
    --user)      ADMIN_USER="${2:?}"; shift 2 ;;
    --password|--pass) ADMIN_PASS="${2:?}"; OWNER_PASS_EXPLICIT="yes"; shift 2 ;;
    --email)     ADMIN_EMAIL="${2:?}"; shift 2 ;;
    --domain)    DOMAIN="${2:?}";     shift 2 ;;
    --node-major) NODE_MAJOR="${2:?}"; shift 2 ;;
    --pm2)       USE_PM2="${2:?}";    shift 2 ;;
    --proxy)     SETUP_PROXY="${2:?}"; shift 2 ;;
    --packages)  SETUP_PKG="${2:?}";  shift 2 ;;
    --java)      INSTALL_JAVA="${2:?}"; shift 2 ;;
    --node)      NODE_MODE="${2:?}";  shift 2 ;;
    --node-runtime) NODE_RUNTIME="${2:?}"; shift 2 ;;
    --node-port) NODE_AGENT_PORT="${2:?}"; shift 2 ;;
    --docker)    INSTALL_DOCKER="${2:?}"; shift 2 ;;
    --wings|--wings-port) warn "--wings is gone: the panel drives Docker itself, no Pterodactyl wings is installed"; shift $([ "$1" = "--wings-port" ] && echo 2 || echo 1) ;;
    -y|--yes)    ASSUME_YES="yes";    shift ;;
    --update)    ACTION="update";     shift ;;
    --repair)    ACTION="repair";     shift ;;
    --node-only) ACTION="node";       shift ;;
    --uninstall) ACTION="uninstall";  shift ;;
    --purge)     PURGE_NODE="yes";    shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           die "Unknown option: $1 (try --help)" ;;
  esac
done

# -------------------------- environment probe ---------------------------
OS_FAMILY="unknown"
PKG=""
SUDO=""
detect_os() {
  case "$(uname -s)" in
    Linux) : ;;
    Darwin) OS_FAMILY="macos"; PKG="brew"; return ;;
    *) die "Unsupported OS: $(uname -s). Linux, macOS or Docker is required." ;;
  esac
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}${ID_LIKE:-}" in
      *debian*|*ubuntu*) OS_FAMILY="debian"; PKG="apt-get" ;;
      *rhel*|*fedora*|*centos*|*amzn*) OS_FAMILY="rhel"; PKG="$(command -v dnf || command -v yum || echo yum)" ;;
      *arch*|*manjaro*) OS_FAMILY="arch"; PKG="pacman" ;;
      *suse*)  OS_FAMILY="suse"; PKG="zypper" ;;
      *alpine*) OS_FAMILY="alpine"; PKG="apk" ;;
      *) OS_FAMILY="unknown" ;;
    esac
    OS_PRETTY="${PRETTY_NAME:-$OS_FAMILY}"
  else
    OS_PRETTY="$(uname -sr)"
  fi
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else SUDO=""; fi
  ARCH="$(uname -m)"
}

have() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif [ -n "$SUDO" ]; then "$SUDO" "$@"
  else return 127
  fi
}

pkg_install() {
  [ "$SETUP_PKG" = "yes" ] || { warn "skipping system packages (--packages no)"; return 0; }
  [ -n "$PKG" ] || { warn "unknown distro - install these yourself if missing: $*"; return 0; }
  info "Installing system packages: $*"
  case "$PKG" in
    apt-get) as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1 || warn "apt-get could not install: $*" ;;
    dnf|yum) as_root "$PKG" install -y -q "$@" >/dev/null 2>&1 || warn "$PKG could not install: $*" ;;
    pacman)  as_root pacman -Sy --noconfirm --needed "$@" >/dev/null 2>&1 || warn "pacman could not install: $*" ;;
    zypper)  as_root zypper -q install -y "$@" >/dev/null 2>&1 || warn "zypper could not install: $*" ;;
    apk)     as_root apk add --no-cache "$@" >/dev/null 2>&1 || warn "apk could not install: $*" ;;
    brew)    brew install "$@" >/dev/null 2>&1 || warn "brew could not install: $*" ;;
  esac
}

node_major_of() { "$1" -v 2>/dev/null | sed -E 's/^v?([0-9]+).*/\1/'; }

install_node() {
  if have node; then
    local cur; cur="$(node_major_of node)"
    if [ -n "$cur" ] && [ "$cur" -ge 18 ]; then ok "Node.js $(node -v) already present"; return 0; fi
    warn "Node.js $(node -v 2>/dev/null || echo '?') is too old (need 18+)"
  fi
  info "Installing Node.js ${NODE_MAJOR}.x"
  case "$OS_FAMILY" in
    debian)
      as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
      pkg_install ca-certificates curl gnupg
      if ! have node; then
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh 2>/dev/null &&
          as_root bash /tmp/nodesource_setup.sh >/dev/null 2>&1 &&
          as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null 2>&1 || true
      fi
      ;;
    rhel)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh 2>/dev/null &&
        as_root bash /tmp/nodesource_setup.sh >/dev/null 2>&1 &&
        as_root "$PKG" install -y -q nodejs >/dev/null 2>&1 || true
      ;;
    arch)   pkg_install nodejs npm ;;
    suse)   pkg_install nodejs npm ;;
    alpine) pkg_install nodejs npm bash ;;
    macos)  pkg_install node || true ;;
  esac
  if ! have node; then
    warn "Could not install Node.js with the package manager - falling back to the official tarball"
    install_node_tarball
  fi
  have node || die "Node.js could not be installed. Install Node 18+ manually and re-run."
  ok "Node.js $(node -v) ready"
}

install_node_tarball() {
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="linux-x64" ;;
    aarch64|arm64) arch="linux-arm64" ;;
    armv7l) arch="linux-armv7l" ;;
    *) warn "no Node tarball for $(uname -m)"; return 1 ;;
  esac
  local tmp="/tmp/node-zenith-dl.tar.xz"
  local ver
  ver="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" 2>/dev/null | grep -oE "node-v[0-9.]+-${arch}\.tar\.xz" | head -1)"
  [ -n "$ver" ] || { warn "could not resolve a Node download"; return 1; }
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${ver}" -o "$tmp" || return 1
  as_root mkdir -p /opt/zenith-node
  as_root tar -xJf "$tmp" -C /opt/zenith-node --strip-components=1 || return 1
  as_root ln -sf /opt/zenith-node/bin/node /usr/local/bin/node
  as_root ln -sf /opt/zenith-node/bin/npm /usr/local/bin/npm
  rm -f "$tmp"
  ok "Node.js $(/opt/zenith-node/bin/node -v) installed to /opt/zenith-node"
}

install_java() {
  [ "$INSTALL_JAVA" = "yes" ] || { warn "skipping system Java (--java no)"; return 0; }
  if have java; then ok "System Java present: $(java -version 2>&1 | head -1)"; fi
  info "Making sure a JDK is available (for Spigot/Forge builds and older servers)"
  case "$OS_FAMILY" in
    debian) pkg_install openjdk-21-jre-headless openjdk-17-jre-headless zip unzip ;;
    rhel)   pkg_install java-21-openjdk-headless java-17-openjdk-headless zip unzip ;;
    arch)   pkg_install jre-openjdk-headless jdk-openjdk zip unzip ;;
    suse)   pkg_install java-21-openjdk-headless zip unzip ;;
    alpine) pkg_install openjdk21-jre-headless zip unzip ;;
    macos)  pkg_install openjdk zip unzip ;;
  esac
  have java && ok "java: $(command -v java)" || warn "No system Java found - the panel will download Temurin JREs on demand (that is fine)"
}

have_pm2() { command -v pm2 >/dev/null 2>&1; }

has_root_access() {
  [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]
}

# systemd only exists (and only helps) when we can actually write a unit
systemd_usable() {
  have systemctl || return 1
  has_root_access || return 1
  [ -d /etc/systemd/system ] || return 1
  [ "$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ')" = "systemd" ] || return 1
  return 0
}

install_pm2() {
  [ "$USE_PM2" = "no" ] && return 1
  if have_pm2; then ok "pm2 $(pm2 -v 2>/dev/null) already present"; return 0; fi
  info "Installing pm2 (process supervisor so the panel survives reboots)"
  npm install -g --silent pm2 >/dev/null 2>&1 || as_root npm install -g --silent pm2 >/dev/null 2>&1 || {
    warn "pm2 install failed - falling back to a systemd unit"
    return 1
  }
  have_pm2 && { ok "pm2 $(pm2 -v) installed"; return 0; }
  return 1
}

random_secret() { # random_secret [length]
  if [ "$#" -gt 0 ]; then random_token "$1"; return; fi
  if have openssl; then openssl rand -hex 24
  elif [ -r /dev/urandom ]; then head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else date +%s%N | sha256sum | cut -c1-48
  fi
}

gen_password() {
  if have openssl; then openssl rand -base64 12 | tr -d '/+=' | cut -c1-14
  else head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-14
  fi
}

public_ip() {
  local ip
  ip="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null)" || ip=""
  [ -z "$ip" ] && ip="$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null)" || true
  printf '%s' "${ip:-<server-ip>}"
}

# GitHub Codespaces discovers services bound to 0.0.0.0, but explicit
# configuration means the panel's default 8080 port already has an Open in
# Browser control while install.sh is still running. These helpers also give a
# correct public base URL to the panel instead of an unusable container IP.
in_codespaces() {
  [ "${CODESPACES:-}" = "true" ] || [ -n "${CODESPACE_NAME:-}" ]
}

codespaces_panel_url() {
  in_codespaces || return 1
  local name="${CODESPACE_NAME:-}" domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  [ -n "$name" ] || return 1
  case "$name.$domain" in *[!A-Za-z0-9.-]*|.*|*..) return 1 ;; esac
  printf 'https://%s-%s.%s' "$name" "$PORT" "$domain"
}

suggested_panel_url() {
  local url
  if [ -n "${PANEL_URL:-}" ]; then printf '%s' "$PANEL_URL"; return 0; fi
  url="$(codespaces_panel_url 2>/dev/null || true)"
  [ -n "$url" ] && { printf '%s' "$url"; return 0; }
  printf 'http://%s:%s' "$(public_ip)" "$PORT"
}

configure_codespaces_panel_port() {
  in_codespaces || return 0
  local url output="" n=1
  url="$(codespaces_panel_url 2>/dev/null || true)"
  # The running 0.0.0.0 listener is what creates the forwarded port. When the
  # Codespaces CLI is authenticated, pin its visibility to private as well.
  if have gh && [ -n "${CODESPACE_NAME:-}" ]; then
    while [ "$n" -le 5 ]; do
      if output="$(gh codespace ports visibility "${PORT}:private" -c "${CODESPACE_NAME}" 2>&1)"; then
        ok "GitHub Codespaces port :${PORT} is ready (private)"
        output=""; break
      fi
      sleep 1; n=$((n + 1))
    done
    [ -z "$output" ] || warn "Codespaces could not set visibility for :${PORT}: ${output}"
  fi
  if [ -n "$url" ]; then
    ok "GitHub Codespaces panel port :${PORT} is ready — use Open in Browser"
    say "  ${B}Open panel${R} ${CYN}${url}${R}"
  else
    warn "Codespaces detected, but its forwarded URL could not be formed (CODESPACE_NAME is missing)"
  fi
}

panel_reachable() {
  local url="$1"
  have curl || return 1
  curl -fsS --max-time 6 "${url}/api/version" >/dev/null 2>&1
}

# ------------------------------- steps ----------------------------------
ensure_source() {
  [ -f "$PANEL_DIR/package.json" ] && return 0
  info "No package.json in $PANEL_DIR - cloning the panel"
  have git || pkg_install git
  have git || die "git is required to clone the panel"
  local target="${ZENITH_DIR:-$PANEL_DIR}"
  git clone --depth 1 "$REPO_URL" "$target" || die "git clone failed ($REPO_URL). Set ZENITH_REPO to your fork."
  PANEL_DIR="$target"
}

ensure_deps() {
  cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
  info "Installing Node dependencies"
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --omit=optional --no-audit --no-fund >/dev/null 2>&1 \
      || npm install --omit=dev --omit=optional --no-audit --no-fund >/dev/null 2>&1 \
      || npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || die "npm install failed"
  else
    npm install --omit=dev --omit=optional --no-audit --no-fund >/dev/null 2>&1 || die "npm install failed"
  fi
  [ -d node_modules/express ] || die "dependencies look incomplete (node_modules/express missing)"
  ok "dependencies installed ($(ls node_modules | wc -l | tr -d ' ') packages)"
}

write_env() {
  cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
  local jwt secret
  jwt="$(grep -E '^JWT_SECRET=' .env 2>/dev/null | cut -d= -f2-)"
  [ -n "$jwt" ] || jwt="$(random_secret)"
  # OWNER_SECRET must exist BEFORE the panel starts: the installer authenticates
  # its node registration with it and a running process never re-reads .env.
  secret="$(grep -E '^OWNER_SECRET=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')"
  [ -n "$secret" ] || secret="$(random_secret 32)"
  OWNER_SECRET="$secret"
  export OWNER_SECRET
  local url
  url="$(suggested_panel_url)"
  # keep the big, regenerable artefacts out of ${PANEL_DIR}
  if [ -z "${JAVA_DIR:-}" ]; then
    if [ "$(id -u)" -eq 0 ] || [ -n "${SUDO:-}" ]; then JAVA_DIR=/var/lib/zenith/java; else JAVA_DIR="${HOME}/.zenith/java"; fi
  fi
  as_root mkdir -p "$JAVA_DIR" 2>/dev/null || mkdir -p "$JAVA_DIR" 2>/dev/null || true
  # the panel runs as the invoking user: it has to be able to write JREs there
  [ "$(id -u)" -ne 0 ] && as_root chown -R "$(id -un)" "$JAVA_DIR" 2>/dev/null || true
  cat > .env <<EOF
# ${PANEL_NAME} - generated by install.sh on $(date -u +'%Y-%m-%dT%H:%M:%SZ')
PORT=${PORT}
HOST=${HOST}
PANEL_URL=${url}
JWT_SECRET=${jwt}
# installer-only secret: install.sh registers/repairs the local node with it.
# Blank this line to disable that path entirely.
OWNER_SECRET=${secret}
AUTOSTART_SERVERS=${AUTOSTART_SERVERS:-false}
MAX_SERVERS_PER_USER=${MAX_SERVERS_PER_USER:-0}
# Server runtime for new servers on this host: process | docker
NODE_RUNTIME=${NODE_BACKEND:-process}
# Real SFTP server (chrooted per server, login <user>.<server id> + panel password)
SFTP_ENABLED=true
SFTP_PORT=${SFTP_PORT}
# Managed Java runtimes live outside the panel folder: each one is 50-160 MB and
# has no business being inside a source checkout or a backup of one.
JAVA_DIR=${JAVA_DIR}
EOF
  chmod 600 .env 2>/dev/null || true
  ok ".env written (port ${PORT}, url ${url}, installer secret)"
}

create_owner() {
  cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
  [ -n "$ADMIN_PASS" ] || ADMIN_PASS="$(gen_password)"
  local fresh="no"
  if ! node scripts/createuser.js --exists "$ADMIN_USER" >/dev/null 2>&1; then fresh="yes"; fi
  local args=(--user "$ADMIN_USER" --role owner)
  [ -n "$ADMIN_EMAIL" ] && args+=(--email "$ADMIN_EMAIL")
  # The password is only (re)written for a brand-new account, or when the
  # operator asked for it with --password. A repair run must never silently
  # reset a password the owner already changed back to the default.
  if [ "$fresh" = "yes" ] || [ "$OWNER_PASS_EXPLICIT" = "yes" ]; then
    [ -n "$ADMIN_PASS" ] || ADMIN_PASS="$(gen_password)"
    args+=(--pass "$ADMIN_PASS" --reset-password)
    info "Creating the owner account '${ADMIN_USER}'"
  else
    OWNER_PASS=""
    info "Owner account '${ADMIN_USER}' already exists - keeping its password"
  fi
  if node scripts/createuser.js "${args[@]}" >/dev/null 2>&1; then
    if [ "$fresh" = "yes" ]; then ok "owner account ready (${ADMIN_USER})"
    elif [ "$OWNER_PASS_EXPLICIT" = "yes" ]; then ok "owner password reset to the one you passed"
    else ok "owner account refreshed (role and e-mail only - password untouched)"; fi
  else
    node scripts/createuser.js "${args[@]}" || warn "could not create the owner account - run: node scripts/createuser.js --user ${ADMIN_USER} --pass <pass> --role owner --reset-password"
  fi
}

start_unit_systemd() {
  local unit="/etc/systemd/system/${SERVICE_NAME}.service"
  info "Writing systemd unit $unit"
  as_root tee "$unit" >/dev/null <<EOF
[Unit]
Description=${PANEL_NAME}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${PANEL_DIR}
EnvironmentFile=-${PANEL_DIR}/.env
ExecStart=$(command -v node) ${PANEL_DIR}/server.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
  as_root systemctl daemon-reload || true
  as_root systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1 || true
  if as_root systemctl restart "${SERVICE_NAME}" 2>/dev/null; then
    ok "systemd service ${SERVICE_NAME} started"
    return 0
  fi
  warn "systemd could not start ${SERVICE_NAME} - falling back to nohup"
  return 1
}

start_nohup() {
  cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
  (nohup node server.js >>"${PANEL_DIR}/panel.log" 2>&1 & echo $! > "${PANEL_DIR}/panel.pid")
  ok "panel started in the background (pid $(cat "${PANEL_DIR}/panel.pid")) - logs: ${PANEL_DIR}/panel.log"
}

start_panel() {
  cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
  # stop anything we started before
  if have_pm2; then pm2 delete "$SERVICE_NAME" >/dev/null 2>&1 || true; fi
  if install_pm2; then
    pm2 start server.js --name "$SERVICE_NAME" --time --update-env >/dev/null 2>&1 \
      || pm2 start npm --name "$SERVICE_NAME" -- start >/dev/null 2>&1 \
      || die "pm2 could not start the panel"
    pm2 save >/dev/null 2>&1 || true
    # make pm2 come back after a reboot (best effort)
    local boot; boot="$(pm2 startup systemd -u "$(id -un)" --hp "$HOME" 2>/dev/null | grep -E '^sudo ' | head -1 || true)"
    [ -n "$boot" ] && { eval "$boot" >/dev/null 2>&1 || true; }
    ok "panel running under pm2 as '${SERVICE_NAME}'   (pm2 logs ${SERVICE_NAME})"
  elif systemd_usable && start_unit_systemd; then
    : # started by systemd
  else
    if [ "$USE_PM2" != "no" ]; then warn "no supervisor available - the panel will not auto-restart"; fi
    start_nohup
  fi
}

setup_nginx() {
  [ "$SETUP_PROXY" = "no" ] && return 0
  if [ -z "$DOMAIN" ]; then
    [ "$SETUP_PROXY" = "yes" ] && warn "--proxy yes needs --domain; skipping"
    return 0
  fi
  have nginx || pkg_install nginx
  if ! have nginx; then warn "nginx is not available - panel stays on port ${PORT}"; return 0; fi
  info "Configuring the nginx reverse proxy for ${DOMAIN}"
  local conf="/etc/nginx/sites-available/zenith.conf"
  [ -d /etc/nginx/sites-available ] || conf="/etc/nginx/conf.d/zenith.conf"
  as_root tee "$conf" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 2048m;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  [ -d /etc/nginx/sites-enabled ] && as_root ln -sf "$conf" /etc/nginx/sites-enabled/zenith.conf
  as_root nginx -t >/dev/null 2>&1 && as_root systemctl reload nginx >/dev/null 2>&1 || warn "nginx config test failed - check $conf"
  ok "nginx proxy configured for ${DOMAIN}"

  if [ -n "$ADMIN_EMAIL" ]; then
    if ! have certbot; then pkg_install certbot python3-certbot-nginx; fi
    if have certbot; then
      info "Requesting a Let's Encrypt certificate"
      as_root certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect >/dev/null 2>&1 \
        && ok "HTTPS enabled for ${DOMAIN}" || warn "certbot failed - run it manually: certbot --nginx -d ${DOMAIN}"
    fi
  fi
}

open_firewall() {
  [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ] || return 0
  if have ufw && as_root ufw status 2>/dev/null | grep -q "Status: active"; then
    as_root ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    as_root ufw allow 25565:25600/tcp >/dev/null 2>&1 || true
    as_root ufw allow 25565:25600/udp >/dev/null 2>&1 || true
    as_root ufw allow "${SFTP_PORT}/tcp" >/dev/null 2>&1 || true
    ok "firewall: opened ${PORT}/tcp, ${SFTP_PORT}/tcp (SFTP) and the 25565-25600 game range"
  elif have firewall-cmd && as_root firewall-cmd --state >/dev/null 2>&1; then
    as_root firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null 2>&1 || true
    as_root firewall-cmd --permanent --add-port=25565-25600/tcp >/dev/null 2>&1 || true
    as_root firewall-cmd --permanent --add-port=25565-25600/udp >/dev/null 2>&1 || true
    as_root firewall-cmd --permanent --add-port="${SFTP_PORT}/tcp" >/dev/null 2>&1 || true
    as_root firewall-cmd --reload >/dev/null 2>&1 || true
    ok "firewall (firewalld): opened ${PORT}/tcp, ${SFTP_PORT}/tcp (SFTP) and the 25565-25600 game range"
  fi
}


# ========================= local node provisioning =========================
# Everything in this section is measured, never assumed: capabilities are
# probed, credentials are generated on the panel side, and the node is only
# marked online when a real health check answers.

NODE_BACKEND=""        # process | docker
NODE_ID=""
NODE_TOKEN=""
NODE_TOKEN_SOURCE=""
NODE_HEALTH_OK="no"
DOCKER_OK="no"

# --- helpers ---------------------------------------------------------------
cpu_cores() { getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1; }
mem_mb()    { awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0; }
disk_free_mb() { df -Pm "$1" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0; }
disk_total_mb() { df -Pm "$1" 2>/dev/null | awk 'NR==2 {print $2}' || echo 0; }
have() { command -v "$1" >/dev/null 2>&1; }

detect_public_ip() {
  local ip=""
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip="$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]')" || true
    case "$ip" in
      *[!0-9.]*|"") continue ;;
    esac
    printf '%s' "$ip"; return 0
  done
  local local_ip
  local_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  printf '%s' "${local_ip:-127.0.0.1}"
}

panel_api() { # panel_api <method> <path> [json] -> response body (errors included)
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS --connect-timeout 10 --max-time 90 -X "$method"
              -H "x-owner-secret: ${OWNER_SECRET:-}" -H 'Content-Type: application/json')
  [ -n "$body" ] && args+=(-d "$body")
  local out
  out="$(curl "${args[@]}" "http://127.0.0.1:${PORT}${path}" 2>>"${INSTALL_LOG:-/dev/null}")" || true
  printf '%s' "$out"
}

# The panel needs a shared secret only this installer knows, so a local node can
# be registered without ever putting an owner password in a shell command line.
ensure_owner_secret() {
  local envfile="${PANEL_DIR}/.env"
  OWNER_SECRET=""
  if [ -f "$envfile" ]; then
    OWNER_SECRET="$(sed -n 's/^OWNER_SECRET=//p' "$envfile" | head -n1 | tr -d '"'"'"'')"
  fi
  if [ -z "$OWNER_SECRET" ]; then
    OWNER_SECRET="$(random_secret 32)"
    printf '\nOWNER_SECRET=%s\n' "$OWNER_SECRET" >>"$envfile"
    chmod 600 "$envfile" 2>/dev/null || true
    log "generated a new OWNER_SECRET in $envfile"
    # the running panel was started without it - restart so the header is accepted
    warn "a new installer secret was written - restarting the panel so it applies"
    restart_panel || warn "could not restart the panel automatically (run: pm2 restart ${SERVICE_NAME})"
  fi
  export OWNER_SECRET
}

# Restart whatever supervises the panel and wait until it answers again.
restart_panel() {
  if have_pm2 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    pm2 restart "$SERVICE_NAME" --update-env >/dev/null 2>&1 || return 1
  elif systemd_usable && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
    as_root systemctl restart "$SERVICE_NAME" >>"${INSTALL_LOG:-/dev/null}" 2>&1 || return 1
  else
    return 1
  fi
  local n=0
  while [ "$n" -lt 30 ]; do
    panel_reachable "http://127.0.0.1:${PORT}" && return 0
    sleep 1; n=$((n + 1))
  done
  return 1
}

# --- docker ---------------------------------------------------------------
install_docker() {
  DOCKER_OK="no"
  if have docker && docker info >/dev/null 2>&1; then
    DOCKER_OK="yes"
    ok "Docker already installed and the daemon answers ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'unknown version'))"
    verify_docker_storage || true
    ensure_compose_plugin || true
    return 0
  fi
  if [ "$INSTALL_DOCKER" = "no" ]; then
    warn "Docker is missing and --docker no was given - servers will run as plain processes"
    NODE_MODE="local"; NODE_BACKEND="process"
    return 1
  fi
  info "Installing Docker Engine + compose plugin"
  case "$OS_FAMILY" in
    debian)
      try_cmd 3 5 "docker prerequisites" as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg || true
      as_root install -m 0755 -d /etc/apt/keyrings || true
      if [ ! -s /etc/apt/keyrings/docker.asc ]; then
        try_cmd 3 5 "docker GPG key" bash -c "curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg -o /etc/apt/keyrings/docker.asc" \
          || { err "Could not download the Docker GPG key - check DNS/egress"; return 1; }
        as_root chmod a+r /etc/apt/keyrings/docker.asc
      fi
      local codename; codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-stable}")"
      printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
        "$(dpkg --print-architecture)" "$OS_ID" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
      try_cmd 3 5 "apt-get update" as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
      try_cmd 3 10 "docker engine install" as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
        || { err "Docker could not be installed from download.docker.com"; return 1; }
      ;;
    rhel)
      try_cmd 3 10 "docker engine install" as_root "$PKG" install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin \
        || { err "Docker could not be installed from the ${PKG} repositories"; return 1; }
      ;;
    *)
      warn "Automatic Docker installation is only supported on Debian/Ubuntu (and RHEL-family via dnf/yum) - install Docker yourself for container servers"
      return 1
      ;;
  esac
  if systemd_usable; then
    as_root systemctl enable --now docker >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
  else
    as_root service docker start >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
  fi
  sleep 2
  if docker info >/dev/null 2>&1; then
    DOCKER_OK="yes"; NODE_BACKEND="docker"
    ok "Docker installed: $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
    verify_docker_storage || true
  else
    err "Docker was installed but the daemon does not answer - run 'journalctl -u docker -n 40'"
    return 1
  fi
  # the panel user needs to talk to the daemon without sudo
  local target_user="${ZENITH_SERVICE_USER:-${SUDO_USER:-$(id -un)}}"
  if [ -n "$target_user" ] && [ "$target_user" != "root" ]; then
    as_root usermod -aG docker "$target_user" >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
    ok "added ${target_user} to the docker group (log out/in for shell use; the service applies it on restart)"
  fi
  ensure_compose_plugin || true
  preload_images || true
  return 0
}

ensure_compose_plugin() {
  docker compose version >/dev/null 2>&1 && { ok "docker compose plugin present ($(docker compose version --short 2>/dev/null || echo ok))"; return 0; }
  if have docker-compose; then
    as_root ln -sf "$(command -v docker-compose)" /usr/local/bin/docker-compose-link 2>/dev/null || true
    ok "docker-compose (v1) present; Docker Compose v2 plugin is recommended"
    return 0
  fi
  case "$OS_FAMILY" in
    debian) try_cmd 2 5 "docker-compose-plugin" as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin && ok "docker compose plugin installed" ;;
    rhel)   try_cmd 2 5 "docker-compose-plugin" as_root "$PKG" install -y -q docker-compose-plugin && ok "docker compose plugin installed" ;;
  esac
}

# Report the actual Docker storage backend. This is a daemon capability, not a
# package that can truthfully be "installed" by Zenith. A few hosted engines
# omit GraphDriver on `docker inspect`; the panel falls back to this factual
# daemon value and never invents a rootfs driver.
verify_docker_storage() {
  local driver output
  output="$(docker info --format '{{.Driver}}' 2>&1)" || {
    warn "Docker storage-driver check failed: ${output}"
    return 1
  }
  driver="$(printf '%s' "$output" | tr -d '\r\n' | xargs)"
  if [ -n "$driver" ] && [ "$driver" != "<no value>" ] && [ "$driver" != "null" ]; then
    ok "Docker storage driver: ${driver}"
    return 0
  fi
  warn "Docker daemon did not disclose a storage driver through docker info; container IDs and mounts will still be verified, but the panel will label the driver as not disclosed"
  return 1
}

preload_images() {
  [ "$DOCKER_OK" = "yes" ] || return 1
  info "Pre-pulling the server image so the first server starts instantly"
  local major="${ZENITH_DEFAULT_JAVA:-21}"
  if try_cmd 2 5 "docker pull eclipse-temurin:${major}-jre" as_root docker pull "eclipse-temurin:${major}-jre"; then
    ok "image eclipse-temurin:${major}-jre ready"
  else
    warn "could not pre-pull eclipse-temurin:${major}-jre (the panel will try again when a server starts)"
  fi
}

random_token() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

# --- the node itself ------------------------------------------------------
configure_node_mode() {
  case "$NODE_MODE" in
    local|docker|remote|none) : ;;
    *) die "--node must be one of: local, docker, remote, none (got '${NODE_MODE}')" ;;
  esac
  if [ -n "$NODE_RUNTIME" ]; then
    case "$NODE_RUNTIME" in
      process|docker) NODE_BACKEND="$NODE_RUNTIME" ;;
      *) die "--node-runtime must be process or docker" ;;
    esac
    [ "$NODE_BACKEND" = "docker" ] && NODE_MODE="docker" || NODE_MODE="local"
  fi
  case "$NODE_MODE" in
    docker) NODE_BACKEND="docker" ;;
    local)  NODE_BACKEND="process" ;;
  esac
}

provision_local_node() {
  [ "$NODE_MODE" = "none" ] && { info "--node none: skipping node provisioning"; return 0; }

  info "Detecting this machine (cpu / ram / disk / ip / java / docker)"
  local cores mem disk_free disk_total pub_ip local_ip java_ver
  cores="$(cpu_cores)"; mem="$(mem_mb)"
  disk_total="$(disk_total_mb "$PANEL_DIR")"; disk_free="$(disk_free_mb "$PANEL_DIR")"
  pub_ip="$(detect_public_ip)"
  local_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  java_ver="$(java -version 2>&1 | head -n1 || true)"
  say "      cpu      ${cores} core(s)"
  say "      memory   ${mem} MB"
  say "      disk     ${disk_free} MB free of ${disk_total} MB"
  say "      public ip ${pub_ip}${local_ip:+   local ip ${local_ip}}"
  say "      java     ${java_ver:-none found (the panel installs a Temurin JRE when needed)}"
  say "      docker   $(if have docker && docker info >/dev/null 2>&1; then echo "available ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"; else echo "not available"; fi)"
  say "      node     $(if [ -n "$NODE_TOKEN" ]; then echo "existing registration for ${NODE_ID:-?} - credentials reused"; else echo "first run - the panel will mint a credential"; fi)"
  say "      ports    ${ALLOC_START}-${ALLOC_END} (game servers)   agent ${NODE_AGENT_PORT}   sftp ${SFTP_PORT}"

  if [ "$NODE_MODE" = "docker" ]; then
    if [ "$DOCKER_OK" != "yes" ]; then
      install_docker || true
    fi
    if [ "$DOCKER_OK" != "yes" ]; then
      err "Container mode was requested but Docker is not usable on this host."
      err "  Fix Docker (or re-run with --node local) - the node was NOT registered in container mode."
      NODE_BACKEND="process"   # honest fallback so the panel still works
      warn "Falling back to the process backend so servers still run."
    fi
  fi

  if [ "$NODE_MODE" = "remote" ]; then
    provision_remote_style_node "$pub_ip" || return 1
  fi

  # ---- register the node in the panel (credentials generated by the panel) ----
  info "Registering the node with the panel"
  ensure_owner_secret
  local payload
  is_local="true"
  [ "$NODE_MODE" = "remote" ] && is_local="false"
  payload="$(printf '{"name":"Local Node","fqdn":"%s","port":%s,"backend":"%s","publicIp":"%s","local":%s,"portRange":{"start":%s,"end":%s},"description":"Auto-registered by install.sh on %s"}' \
    "$(json_escape "$pub_ip")" "${NODE_AGENT_PORT}" "${NODE_BACKEND}" "$(json_escape "$pub_ip")" "$is_local" "${ALLOC_START}" "${ALLOC_END}" "$(json_escape "$(hostname)")")"

  local response="" attempts=0
  while [ "$attempts" -lt 5 ]; do
    response="$(panel_api POST /api/nodes/auto-register "$payload")"
    case "$response" in
      *'"id"'*) break ;;                       # registered (created or refreshed)
      *Unauthorized*|*"owner secret"*|*"Authentication required"*)
        err "The panel rejected the installer secret (OWNER_SECRET)."
        err "  The running panel was started without the secret that is now in ${PANEL_DIR}/.env."
        err "  Fix: restart the panel (pm2 restart ${SERVICE_NAME}) and run: bash install.sh --repair"
        log "auto-register rejected: $response"
        return 1 ;;
    esac
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 5 ]; then break; fi
    warn "node registration attempt ${attempts}/5 did not succeed - retrying in 3s"
    sleep 3
  done
  case "$response" in
    *'"id"'*) : ;;
    *)
      err "The panel did not accept the node registration. Its answer was:"
      printf '%s\n' "${response:-<empty response - is the panel listening on port ${PORT}? >}" | head -n 6 | sed 's/^/      /' >&2
      err "  Panel log tail:"
      tail -n 15 "${PANEL_DIR}/panel.log" 2>/dev/null | sed 's/^/      /' >&2 || true
      err "  Installer log: ${INSTALL_LOG}"
      return 1 ;;
  esac

  NODE_ID="$(printf '%s' "$response" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
  NODE_TOKEN="$(printf '%s' "$response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -z "$NODE_ID" ]; then
    err "The panel answered but no node id came back: ${response}"
    return 1
  fi
  if [ -n "$NODE_TOKEN" ]; then
    NODE_TOKEN_SOURCE="generated by the panel"
    # keep the credential with the service, root-only, never in the terminal history
    as_root mkdir -p /etc/zenith
    printf 'NODE_ID=%s\nNODE_TOKEN=%s\nPANEL=http://127.0.0.1:%s\n' "$NODE_ID" "$NODE_TOKEN" "$PORT" | as_root tee /etc/zenith/node.env >/dev/null
    as_root chmod 600 /etc/zenith/node.env
    ok "node '${NODE_ID}' registered with fresh credentials (stored in /etc/zenith/node.env, mode 600)"
  else
    NODE_TOKEN_SOURCE="existing credentials reused (idempotent re-run)"
    ok "node '${NODE_ID}' updated (existing credentials kept)"
  fi

  # ---- a reporter keeps the panel's copy of the node fresh without a JWT ----
  write_node_reporter
  return 0
}

provision_remote_style_node() {
  # Run the standard agent on this host so the panel drives it over HTTP.
  local pub_ip="$1"
  info "Installing the node agent service on this host (--node remote)"
  if [ -z "$NODE_TOKEN" ]; then
    # the token only exists after registration; do a first pass without the
    # service, then rewrite it once the token is known
    ROLLING_TOKEN="pending"
  fi
  write_node_agent_unit "$pub_ip" "${NODE_TOKEN:-pending}"
  ok "agent service ${NODE_SERVICE_NAME} written (port ${NODE_AGENT_PORT})"
  return 0
}

write_node_agent_unit() {
  local pub_ip="$1" token="$2"
  local agent_dir="/opt/zenith-node"
  as_root mkdir -p "$agent_dir"
  if ! as_root cp "${PANEL_DIR}/scripts/node-agent.js" "${agent_dir}/node-agent.js" 2>/dev/null; then
    as_root curl -fsSL "http://127.0.0.1:${PORT}/node-agent.js" -o "${agent_dir}/node-agent.js" || { err "could not place node-agent.js"; return 1; }
  fi
  local runtime="process"
  [ "$NODE_BACKEND" = "docker" ] && runtime="docker"
  if systemd_usable; then
    cat > /tmp/zenith-node.service <<EOF
[Unit]
Description=Zenith node agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${agent_dir}
Environment=NODE_PORT=${NODE_AGENT_PORT}
Environment=ZENITH_PANEL_URL=http://127.0.0.1:${PORT}
Environment=ZENITH_NODE_TOKEN=${token}
Environment=NODE_DATA_DIR=${agent_dir}/servers
Environment=NODE_NAME=$(hostname)
Environment=NODE_RUNTIME=${runtime}
ExecStart=$(command -v node) ${agent_dir}/node-agent.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    as_root cp /tmp/zenith-node.service /etc/systemd/system/${NODE_SERVICE_NAME}.service
    rm -f /tmp/zenith-node.service
    as_root systemctl daemon-reload >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
    as_root systemctl enable ${NODE_SERVICE_NAME} >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
  fi
}

write_node_reporter() {
  # A tiny root-owned script (run by a systemd timer) that re-registers/refreshes
  # the local node every 60s using the panel-side secret. This is what keeps the
  # node's detected resources and status current without storing a JWT anywhere.
  local script="/usr/local/bin/zenith-node-report"
  cat > /tmp/zenith-node-report <<EOF
#!/bin/sh
# Zenith local-node reporter (installed by install.sh)
set -eu
. /etc/zenith/node.env
curl -fsS -X POST -H "x-owner-secret: \${OWNER_SECRET}" -H 'Content-Type: application/json' \\
  -d "{\\"name\\":\\"Local Node\\",\\"local\\":true,\\"fqdn\\":\\"127.0.0.1\\",\\"port\\":${NODE_AGENT_PORT},\\"backend\\":\\"${NODE_BACKEND}\\"}" \\
  "\${PANEL}/api/nodes/auto-register" >/dev/null
EOF
  as_root cp /tmp/zenith-node-report "$script"
  rm -f /tmp/zenith-node-report
  as_root chmod 700 "$script"
  # the reporter needs the secret too
  printf 'OWNER_SECRET=%s\n' "$OWNER_SECRET" | as_root tee -a /etc/zenith/node.env >/dev/null
  as_root chmod 600 /etc/zenith/node.env
  if systemd_usable; then
    cat > /tmp/zenith-node-report.service <<'EOF'
[Unit]
Description=Zenith local node reporter
After=network-online.target zenith-panel.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/zenith-node-report
EOF
    cat > /tmp/zenith-node-report.timer <<'EOF'
[Unit]
Description=Run the Zenith node reporter every minute

[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=5

[Install]
WantedBy=timers.target
EOF
    as_root cp /tmp/zenith-node-report.service /etc/systemd/system/zenith-node-report.service
    as_root cp /tmp/zenith-node-report.timer /etc/systemd/system/zenith-node-report.timer
    rm -f /tmp/zenith-node-report.service /tmp/zenith-node-report.timer
    as_root systemctl daemon-reload >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
    as_root systemctl enable --now zenith-node-report.timer >>"${INSTALL_LOG:-/dev/null}" 2>&1 || true
    ok "node reporter installed (systemd timer, every 60s)"
  else
    (crontab -l 2>/dev/null; echo "* * * * * $script") | crontab - 2>/dev/null || warn "could not add a cron entry - node stats will refresh when you open the Nodes page"
  fi
}

verify_node_health() {
  [ "$NODE_MODE" = "none" ] && return 0
  if [ -z "${NODE_ID:-}" ]; then
    err "No node id to check: register the node before running the health check."
    return 1
  fi
  info "Health check: proving the node really works (no simulated status)"
  local attempts=0 response=""
  while [ "$attempts" -lt 6 ]; do
    attempts=$((attempts + 1))
    response="$(panel_api POST "/api/nodes/${NODE_ID}/health-check" '{}')"
    case "$response" in
      *'"checks"'*|*'"ok"'*) break ;;
    esac
    [ "$attempts" -lt 6 ] && sleep 4
  done
  if [ -z "$response" ]; then
    err "Node health check did not answer (see ${INSTALL_LOG})"
    return 1
  fi
  local okflag="no"
  case "$response" in *'"ok":true'*) okflag="yes" ;; esac
  # print each check honestly
  printf '%s' "$response" | tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*"detail":"\([^"]*\)".*/      \1: \2/p' | head -12
  if [ "$okflag" = "yes" ]; then
    NODE_HEALTH_OK="yes"
    ok "node ${NODE_ID} is online after passing every check"
    return 0
  fi
  err "The node did not pass its health check - the panel keeps it offline until it does."
  printf '%s' "$response" | sed 's/^/      /' >&2
  return 1
}

verify_container_start() {
  [ "$NODE_BACKEND" = "docker" ] || return 0
  [ "$NODE_HEALTH_OK" = "yes" ] || return 0
  info "Container smoke test: starting a throwaway container with the server image"
  if try_cmd 2 3 "docker run --rm eclipse-temurin image" docker run --rm "eclipse-temurin:${ZENITH_DEFAULT_JAVA:-21}-jre" java -version; then
    ok "containers really start on this host"
    return 0
  fi
  err "Docker is installed but a container could not start - the node will report it as unhealthy"
  return 1
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

do_repair() {
  banner
  info "Repairing the installation in ${PANEL_DIR}"
  log_init
  ensure_node_runtime
  setup_packages
  configure_node_mode
  hr
  if [ "$NODE_MODE" = "docker" ] || [ "$INSTALL_DOCKER" = "yes" ]; then
    install_docker || warn "docker still unavailable - see ${INSTALL_LOG}"
  fi
  if [ "$DOCKER_OK" = "yes" ]; then preload_images || true; fi
  hr
  start_panel
  wait_panel || true
  ensure_owner_secret
  provision_local_node || { err "node registration failed during repair"; }
  if [ -n "$NODE_ID" ]; then
    info "Asking the panel to repair + re-check the node"
    panel_api POST "/api/nodes/${NODE_ID}/repair" '{}' | sed 's/^/      /' || true
  fi
  verify_node_health || true
  verify_container_start || true
  hr
  ok "repair finished - see ${INSTALL_LOG} for every command that ran"
  exit 0
}

do_node() {
  # `--node-only` style entry: (re)provision the local node without touching the panel install
  banner
  ensure_node_runtime
  configure_node_mode
  hr
  if [ "$NODE_MODE" = "docker" ] || [ "$INSTALL_DOCKER" = "yes" ]; then install_docker || true; fi
  start_panel
  wait_panel || true
  ensure_owner_secret
  provision_local_node || exit 1
  verify_node_health || true
  exit 0
}

wait_panel() {
  local tries=0
  while [ "$tries" -lt 30 ]; do
    panel_reachable "http://127.0.0.1:${PORT}" && { ok "panel answers on :${PORT}"; return 0; }
    tries=$((tries + 1)); sleep 1
  done
  warn "panel did not answer on :${PORT} within 30s"
  return 1
}

do_install() {
  banner
  log_init
  info "Host: ${OS_PRETTY:-$(uname -sr)} | ${ARCH:-$(uname -m)} | $(id -un)@$(hostname 2>/dev/null || echo host)"
  info "Directory: ${PANEL_DIR}   Port: ${PORT}"

  if [ "$SETUP_PKG" = "yes" ] && [ -n "$PKG" ] && [ "$OS_FAMILY" != "macos" ]; then
    info "Refreshing the package index"
    case "$PKG" in
      apt-get) as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || warn "apt-get update failed - continuing" ;;
      pacman)  as_root pacman -Sy --noconfirm >/dev/null 2>&1 || true ;;
      zypper)  as_root zypper -q refresh >/dev/null 2>&1 || true ;;
      apk)     as_root apk update >/dev/null 2>&1 || true ;;
      dnf|yum) "$PKG" makecache -q >/dev/null 2>&1 || true ;;
    esac
  fi
  pkg_install curl git tar unzip zip ca-certificates

  ensure_source
  install_node
  install_java
  ensure_deps
  # the runtime choice has to be known before .env is written: NODE_RUNTIME goes in there
  configure_node_mode
  write_env
  create_owner
  start_panel
  setup_nginx
  open_firewall

  hr
  info "Verifying the panel answers on /api/version"
  local base="http://127.0.0.1:${PORT}"
  local tries=0 ok_flag="no"
  while [ "$tries" -lt 20 ]; do
    if panel_reachable "$base"; then ok_flag="yes"; break; fi
    tries=$((tries + 1)); sleep 1
  done
  if [ "$ok_flag" = "yes" ]; then
    ok "panel is answering"
    configure_codespaces_panel_port
  else
    warn "the panel did not answer within 20s. Check the logs:"
    if have_pm2; then warn "  pm2 logs ${SERVICE_NAME} --lines 60"
    else warn "  tail -n 60 ${PANEL_DIR}/panel.log   (or)  journalctl -u ${SERVICE_NAME} -n 60"; fi
  fi

  # ---- the node: docker (optional), registration, health check ----
  hr
  configure_node_mode
  if [ "$NODE_MODE" = "docker" ] || [ "$INSTALL_DOCKER" = "yes" ]; then
    install_docker || true
    if [ "$NODE_MODE" = "docker" ] && [ "$DOCKER_OK" != "yes" ]; then
      NODE_BACKEND="process"
      NODE_MODE="local"
      warn "continuing without containers: --node local (servers run as java processes)"
    fi
  elif [ "$NODE_BACKEND" = "process" ] && have docker && docker info >/dev/null 2>&1; then
    DOCKER_OK="yes"
    ok "Docker detected - run 'bash install.sh --repair --node docker' if you want container servers"
  fi
  if [ "$DOCKER_OK" = "yes" ]; then preload_images || true; fi
  provision_local_node || warn "the local node could not be registered (the panel still works: Admin -> Nodes -> Auto-register)"
  verify_node_health || true
  verify_container_start || true

  local shown_url
  shown_url="$(suggested_panel_url)"
  hr
  say ""
  say "  ${GRN}${B}${PANEL_NAME} is installed${R}"
  say ""
  say "  ${B}Panel${R}      ${CYN}${shown_url}${R}"
  [ -n "$DOMAIN" ] && say "  ${B}Domain${R}     ${CYN}http://${DOMAIN}${R}$([ -n "$ADMIN_EMAIL" ] && printf '  (https after certbot)')"
  say "  ${B}Username${R}   ${B}${ADMIN_USER}${R}   ${DIM}(log in with this or your account email)${R}"
  say "  ${B}Password${R}   ${B}${OWNER_PASS:-<unchanged>}${R}    ${DIM}(change it in Account after login)${R}"
  say ""
  say "  ${B}Node${R}        ${NODE_MODE}${NODE_BACKEND:+ (${NODE_BACKEND} backend)}$([ "$DOCKER_OK" = "yes" ] && printf ' | docker ready')"
  say "  ${B}Credentials${R} ${DIM}${NODE_TOKEN_SOURCE:-none needed}${R}  ${DIM}log: ${INSTALL_LOG}${R}"
  say ""
  say "  ${B}Next steps${R}"
  if in_codespaces; then
    say "    1. In GitHub Codespaces, click Open in Browser for forwarded port ${PORT}, then log in as ${ADMIN_USER}"
  else
    say "    1. Open the panel, log in as ${ADMIN_USER}"
  fi
  say "    2. Create Server -> pick PAPER 1.21.4 -> Install (Java + server jar are handled for you)"
  say "    3. Servers -> your server -> Network -> Playit tunnel to expose it to the internet"
  say ""
  say "  ${B}Manage${R}"
  if have_pm2; then
    say "    pm2 status ${SERVICE_NAME}      ${DIM}# state${R}"
    say "    pm2 logs ${SERVICE_NAME}        ${DIM}# live panel logs${R}"
    say "    pm2 restart ${SERVICE_NAME}     ${DIM}# restart after editing .env${R}"
  else
    say "    systemctl status ${SERVICE_NAME} / tail -f ${PANEL_DIR}/panel.log"
  fi
  say "    bash install.sh --update        ${DIM}# pull + reinstall deps + restart${R}"
  say "    bash uninstall.sh               ${DIM}# stop and remove the service (data kept)${R}"
  say ""
  hr
}

do_update() {
  banner
  log_init
  ensure_source
  cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
  if [ -d .git ]; then
    info "Pulling the latest panel source"
    git stash --include-untracked -q >/dev/null 2>&1 || true
    git pull --ff-only || warn "git pull failed - keeping the local tree"
  else
    warn "not a git checkout - skipping git pull"
  fi
  ensure_deps
  if have_pm2 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    pm2 restart "$SERVICE_NAME" --update-env >/dev/null 2>&1 && ok "panel restarted (pm2)"
  elif have systemctl && systemctl is-enabled "$SERVICE_NAME" >/dev/null 2>&1; then
    as_root systemctl restart "$SERVICE_NAME" && ok "panel restarted (systemd)"
  else
    warn "start the panel yourself: node server.js"
  fi
  sleep 2
  if wait_panel; then
    configure_node_mode
    ensure_owner_secret
    provision_local_node || warn "node refresh failed - run: bash install.sh --repair"
    verify_node_health || true
  fi
  hr
  ok "update finished (log: ${INSTALL_LOG})"
}

do_uninstall() {
  banner
  log_init
  info "Stopping ${PANEL_NAME}"
  if have_pm2; then pm2 delete "$SERVICE_NAME" >/dev/null 2>&1 && ok "removed the pm2 process" || true; fi
  if [ -f "${PANEL_DIR}/panel.pid" ]; then
    kill "$(cat "${PANEL_DIR}/panel.pid")" 2>/dev/null || true
    rm -f "${PANEL_DIR}/panel.pid"
    ok "stopped the nohup process"
  fi
  if have systemctl && as_root systemctl status "${SERVICE_NAME}" >/dev/null 2>&1; then
    as_root systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
    as_root rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    as_root systemctl daemon-reload >/dev/null 2>&1 || true
    ok "removed the systemd unit"
  fi
  if [ -f /etc/nginx/sites-enabled/zenith.conf ] || [ -f /etc/nginx/conf.d/zenith.conf ]; then
    as_root rm -f /etc/nginx/sites-enabled/zenith.conf /etc/nginx/sites-available/zenith.conf /etc/nginx/conf.d/zenith.conf 2>/dev/null || true
    as_root systemctl reload nginx >/dev/null 2>&1 || true
    ok "removed the nginx vhost"
  fi

  # ---- node services ----
  if have systemctl; then
    for unit in "${NODE_SERVICE_NAME}" zenith-node-report.timer zenith-node-report.service; do
      if systemctl status "$unit" >/dev/null 2>&1; then
        as_root systemctl disable --now "$unit" >/dev/null 2>&1 || true
        as_root rm -f "/etc/systemd/system/${unit}" 2>/dev/null || true
        ok "stopped and removed ${unit}"
      fi
    done
    as_root systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  if [ -f /usr/local/bin/zenith-node-report ] || [ -d /etc/zenith ]; then
    as_root rm -f /usr/local/bin/zenith-node-report /etc/systemd/system/zenith-node-report.service /etc/systemd/system/zenith-node-report.timer 2>/dev/null || true
    if [ "$PURGE_NODE" = "yes" ]; then
      as_root rm -rf /etc/zenith /opt/zenith-node 2>/dev/null || true
      ok "removed /etc/zenith (node credentials) and /opt/zenith-node"
    else
      warn "kept /etc/zenith/node.env (node credentials) - re-run the installer to reuse them, or delete the folder"
    fi
  fi

  # ---- running containers that belong to the panel ----
  if have docker && docker info >/dev/null 2>&1; then
    local containers
    containers="$(docker ps -aq --filter 'name=zenith-' 2>/dev/null || true)"
    if [ -n "$containers" ]; then
      if [ "$PURGE_NODE" = "yes" ]; then
        # shellcheck disable=SC2086
        docker rm -f $containers >/dev/null 2>&1 && ok "removed the panel's containers"
      else
        warn "left $(printf '%s\n' "$containers" | wc -l | tr -d ' ') container(s) running: docker rm -f \$(docker ps -aq --filter name=zenith-)"
      fi
    fi
  fi

  # ---- leftovers from an older install (wings is no longer used) ----
  if [ -f /etc/pterodactyl/config.yml ] || [ -f /etc/systemd/system/wings.service ]; then
    if [ "$PURGE_NODE" = "yes" ]; then
      as_root systemctl disable --now wings >/dev/null 2>&1 || true
      as_root rm -f /etc/systemd/system/wings.service /usr/local/bin/wings 2>/dev/null || true
      as_root rm -rf /etc/pterodactyl 2>/dev/null || true
      as_root systemctl daemon-reload >/dev/null 2>&1 || true
      ok "removed the left-over wings daemon and its config"
    else
      warn "kept the left-over wings daemon (its config is at /etc/pterodactyl/config.yml)"
    fi
  fi
  hr
  say "  The panel service is gone. ${B}Your data was kept:${R}"
  say "    ${PANEL_DIR}/data      ${DIM}# database, managed Java runtimes, playit binaries${R}"
  say "    ${PANEL_DIR}/servers   ${DIM}# every Minecraft server${R}"
  say "    ${PANEL_DIR}/backups   ${DIM}# backup archives${R}"
  say "  Re-run ${B}bash install.sh${R} to bring it back, or delete those folders to wipe everything."
  say "  ${DIM}Node credentials: /etc/zenith/node.env   Java runtimes: ${JAVA_DIR:-./data/java}${R}"
  say "  ${DIM}Use ${B}bash install.sh --uninstall --purge${R}${DIM} to also remove the node, containers and credentials.${R}"
  hr
}

# -------------------------------- main ----------------------------------
# Only run when this file is EXECUTED (`bash install.sh`, or piped to bash).
# When it is SOURCED - tests/installer-node-check.sh pulls in the functions -
# nothing may happen: a sourced installer must never install, rewrite .env or
# restart services.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  detect_os
  case "$ACTION" in
    install)   do_install ;;
    update)    do_update ;;
    repair)    do_repair ;;
    uninstall) do_uninstall ;;
    node)      do_node ;;
  esac
fi
