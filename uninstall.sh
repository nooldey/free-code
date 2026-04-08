#!/usr/bin/env bash
set -euo pipefail

# free-code uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/nooldey/free-code/private/uninstall.sh | bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

INSTALL_DIR="$HOME/free-code"
LINK_DIR="$HOME/.local/bin"
LINK_PATH="$LINK_DIR/free-code"

info()  { printf "${CYAN}[*]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[x]${RESET} %s\n" "$*"; exit 1; }

confirm_uninstall() {
  printf "${YELLOW}${BOLD}  WARNING: This will permanently delete:${RESET}\n"
  printf "  ${YELLOW}- %s${RESET}\n" "$INSTALL_DIR"
  printf "  ${YELLOW}- %s${RESET}\n" "$LINK_PATH"
  echo ""
  printf "${BOLD}  Are you sure you want to continue? [y/N] ${RESET}"
  read -r answer
  if [ ! "$answer" = "y" ] && [ ! "$answer" = "Y" ]; then
    info "Uninstallation cancelled."
    exit 0
  fi
}

header() {
  echo ""
  printf "${BOLD}${CYAN}"
  cat << 'ART'
   ___                            _
  / _|_ __ ___  ___        ___ __| | ___
 | |_| '__/ _ \/ _ \_____ / __/ _` |/ _ \
 |  _| | |  __/  __/_____| (_| (_| |  __/
 |_| |_|  \___|\___|      \___\__,_|\___|

ART
  printf "${RESET}"
  printf "${DIM}  Uninstalling free-code${RESET}\n"
  echo ""
}

# -------------------------------------------------------------------
# Uninstall steps
# -------------------------------------------------------------------

remove_symlink() {
  if [ -L "$LINK_PATH" ]; then
    rm -f "$LINK_PATH"
    ok "Removed symlink: $LINK_PATH"
  else
    warn "Symlink not found: $LINK_PATH"
  fi
}

remove_install_dir() {
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed installation directory: $INSTALL_DIR"
  else
    warn "Installation directory not found: $INSTALL_DIR"
  fi
}

summary() {
  echo ""
  printf "${GREEN}${BOLD}  Uninstallation complete!${RESET}\n"
  echo ""
  printf "  ${DIM}If you want to remove the API key from your shell profile,${RESET}\n"
  printf "  ${DIM}please manually remove the line that exports ANTHROPIC_API_KEY.${RESET}\n"
  echo ""
}

# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------

header
info "Starting uninstallation..."
echo ""

confirm_uninstall
echo ""

remove_symlink
remove_install_dir
echo ""

summary
