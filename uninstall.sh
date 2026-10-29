#!/usr/bin/env bash
# ==========================================================================
#  Zenith Panel - uninstaller
#    bash uninstall.sh              # stop + remove the service, keep worlds/db
#    bash uninstall.sh --purge      # also delete servers/, backups/, data/
#    bash uninstall.sh -y           # never prompt (CI / automation)
# ==========================================================================
set -uo pipefail

PANEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="zenith-panel"   # must match install.sh, ecosystem.config.cjs and scripts/zenith
PM2_APP_NAME="zenith"
PURGE="false"
ASSUME_YES="no"

usage() {
  cat <<EOF
Zenith Panel - uninstaller

Usage
  bash uninstall.sh [options]

Options
  -y, --yes      Do not ask for confirmation
      --purge    Also delete servers/, backups/ and data/ (worlds + database!)
  -h, --help     This help

Without --purge the panel keeps: data/ (db.json, managed JREs, playit binaries),
servers/ (every Minecraft server) and backups/, so re-running install.sh brings
everything back exactly as it was.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --purge|-p) PURGE="true" ;;
    -y|--yes)   ASSUME_YES="yes" ;;
    -h|--help)  usage; exit 0 ;;
    *) printf 'Unknown option: %s (try --help)\n' "$arg" >&2; exit 1 ;;
  esac
done

if [ -t 1 ]; then
  G='\033[38;5;48m'; Y='\033[38;5;220m'; R='\033[38;5;196m'; N='\033[0m'; B='\033[1m'
else
  G=''; Y=''; R=''; N=''; B=''
fi
SUDO=""; [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
run() { if [ -n "$SUDO" ]; then "$SUDO" "$@"; else "$@"; fi; }

printf '\n%b\n\n' "${R}Zenith Panel uninstall${N}"
if [ "$PURGE" = "true" ]; then
  printf '%b\n' "  ${R}--purge: servers/, backups/ and data/ WILL BE DELETED.${N}"
else
  printf '%b\n' "  ${Y}Worlds, backups and the panel database are kept (use --purge to delete).${N}"
fi

if [ "$ASSUME_YES" != "yes" ]; then
  if [ -t 0 ]; then
    printf '  Continue? [y/N] '
    read -r ans
    case "$ans" in y|Y|yes|YES) ;; *) echo "  Aborted."; exit 0 ;; esac
  else
    echo "  Not a terminal - re-run with -y to confirm." >&2
    exit 1
  fi
fi

# 1. systemd unit (install.sh names it "$SERVICE_NAME")
if command -v systemctl >/dev/null 2>&1; then
  for unit in "$SERVICE_NAME" zenith-panel; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${unit}.service"; then
      run systemctl stop "$unit" >/dev/null 2>&1 || true
      run systemctl disable "$unit" >/dev/null 2>&1 || true
      run rm -f "/etc/systemd/system/${unit}.service"
      run systemctl daemon-reload >/dev/null 2>&1 || true
      printf '%b\n' "  ${G}OK${N} systemd service removed (${unit})"
    fi
  done
fi

# 2. pm2 app
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 && printf '%b\n' "  ${G}OK${N} pm2 app removed" || true
  pm2 save >/dev/null 2>&1 || true
fi

# 3. nohup fallback written by install.sh
if [ -f "${PANEL_DIR}/panel.pid" ]; then
  kill "$(cat "${PANEL_DIR}/panel.pid")" 2>/dev/null || true
  rm -f "${PANEL_DIR}/panel.pid"
  printf '%b\n' "  ${G}OK${N} background panel process stopped"
fi

# 4. nginx vhost
if [ -f /etc/nginx/sites-enabled/zenith.conf ] || [ -f /etc/nginx/conf.d/zenith.conf ]; then
  run rm -f /etc/nginx/sites-enabled/zenith.conf /etc/nginx/sites-available/zenith.conf /etc/nginx/conf.d/zenith.conf 2>/dev/null || true
  run systemctl reload nginx >/dev/null 2>&1 || true
  printf '%b\n' "  ${G}OK${N} nginx vhost removed"
fi

# 5. anything still listening on the panel port from this directory
if command -v pkill >/dev/null 2>&1; then
  pkill -f "nod[e] ${PANEL_DIR}/server.js" 2>/dev/null && printf '%b\n' "  ${G}OK${N} stray panel process stopped" || true
fi

# 6. optional data removal
if [ "$PURGE" = "true" ]; then
  rm -rf "${PANEL_DIR}/servers" "${PANEL_DIR}/backups" "${PANEL_DIR}/data"
  printf '%b\n' "  ${G}OK${N} servers/, backups/ and data/ deleted"
  KEPT="none - everything was removed"
else
  KEPT="${PANEL_DIR}/data, ${PANEL_DIR}/servers, ${PANEL_DIR}/backups"
fi

printf '\n%b\n' "  ${B}Panel service removed.${N}"
printf '%b\n' "  Kept: ${KEPT}"
printf '%b\n' "  Re-install any time with: bash install.sh"
printf '%b\n\n' "  Logs/env are in ${PANEL_DIR}/.env and ${PANEL_DIR}/panel.log"
