#!/usr/bin/env bash
set -Eeuo pipefail

# ==========================================
#              ZENITH PANEL
#               BY SKYDO_XD
# ==========================================

REPO_URL="https://github.com/SKYDO234/Zenith-panel.git"
REPO_DIR="Zenith-panel"

clear 2>/dev/null || true
printf '\n========================================\n'
printf '             ZENITH PANEL\n'
printf '              BY SKYDO_XD\n'
printf '========================================\n\n'
printf 'Choose installation type:\n'
printf '  1) GitHub / Codespaces\n'
printf '  2) Any VPS (Debian/Ubuntu)\n\n'
read -r -p 'Choose [1/2]: ' choice

case "$choice" in
  1)
    cat <<'COMMANDS'

Run these commands in your GitHub terminal / Codespaces:

apt update
apt install -y git unzip docker.io curl sudo
curl -sL https://deb.nodesource.com/setup_23.x | sudo bash -
apt-get install -y nodejs git
git clone https://github.com/SKYDO234/Zenith-panel.git
cd Zenith-panel
unzip -o i.zip
bash install.sh

COMMANDS
    ;;
  2)
    # Use sudo when not already running as root.
    if [[ "$EUID" -eq 0 ]]; then
      SUDO=""
    else
      if ! command -v sudo >/dev/null 2>&1; then
        printf '\nError: sudo is missing. Install it or run this script as root.\n' >&2
        exit 1
      fi
      SUDO="sudo"
    fi

    $SUDO apt update
    $SUDO apt install -y git unzip docker.io curl sudo ca-certificates
    curl -fsSL https://deb.nodesource.com/setup_23.x | $SUDO bash -
    $SUDO apt-get install -y nodejs git

    if [[ -d "$REPO_DIR/.git" ]]; then
      printf '\nRepository already exists: %s\n' "$REPO_DIR"
    else
      git clone "$REPO_URL" "$REPO_DIR"
    fi

    cd "$REPO_DIR"

    if [[ -f i.zip ]]; then
      unzip -o i.zip
    else
      printf '\nNotice: i.zip was not found; skipping extraction.\n'
    fi

    if [[ ! -f install.sh ]]; then
      printf '\nError: install.sh was not found inside the repository.\n' >&2
      exit 1
    fi

    # Prevent this bootstrap script from calling itself forever.
    SCRIPT_PATH="$(realpath -m "${BASH_SOURCE[0]}")"
    TARGET_PATH="$(realpath -m "$PWD/install.sh")"
    if [[ "$SCRIPT_PATH" == "$TARGET_PATH" ]]; then
      printf '\nThis script is the repository install.sh, so it will not run itself again.\n'
      printf 'Run the panel installer command documented by the repository if a separate installer exists.\n'
      exit 0
    fi

    printf '\nStarting repository installer...\n'
    $SUDO bash install.sh
    ;;
  *)
    printf '\nInvalid choice. Run the script again and select 1 or 2.\n' >&2
    exit 1
    ;;
esac
