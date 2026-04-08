#!/usr/bin/env bash
set -euo pipefail

# free-code installer
# Usage: curl -fsSL https://raw.githubusercontent.com/nooldey/free-code/private/install.sh | bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

REPO="https://github.com/nooldey/free-code.git"
REPO_BRANCH="private"
APP_NAME="freecode"
INSTALL_DIR=""
BUN_MIN_VERSION="1.3.11"
AUTO_INSTALL_BUN="${FREE_CODE_AUTO_INSTALL_BUN:-0}"
RUNTIME_PATHS=(
  '/src/'
  '/scripts/'
  '/package.json'
  '/bun.lock'
  '/tsconfig.json'
  '/env.d.ts'
)

info()  { printf "${CYAN}[*]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[x]${RESET} %s\n" "$*"; exit 1; }

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
  printf "${DIM}  The free build of Claude Code${RESET}\n"
  echo ""
}

# -------------------------------------------------------------------
# System checks
# -------------------------------------------------------------------

check_os() {
  case "$(uname -s)" in
    Darwin)
      OS="macos"
      INSTALL_DIR="$HOME/.config/$APP_NAME"
      ;;
    Linux)
      OS="linux"
      INSTALL_DIR="$HOME/$APP_NAME"
      ;;
    *)      fail "Unsupported OS: $(uname -s). macOS or Linux required." ;;
  esac
  ok "OS: $(uname -s) $(uname -m)"
  ok "Install dir: $INSTALL_DIR"
}

check_git() {
  if ! command -v git &>/dev/null; then
    fail "git is not installed. Install it first:
    macOS:  xcode-select --install
    Linux:  sudo apt install git  (or your distro's equivalent)"
  fi
  ok "git: $(git --version | head -1)"
}

# Compare semver: returns 0 if $1 >= $2
version_gte() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -1)" = "$2" ]
}

check_bun() {
  local should_install=0
  local bun_reason=""

  if command -v bun &>/dev/null; then
    local ver
    ver="$(bun --version 2>/dev/null || echo "0.0.0")"
    if version_gte "$ver" "$BUN_MIN_VERSION"; then
      ok "bun: v${ver}"
      return
    fi
    warn "bun v${ver} found but v${BUN_MIN_VERSION}+ required."
    should_install=1
    bun_reason="upgrade"
  else
    warn "bun not found."
    should_install=1
    bun_reason="install"
  fi

  if [ "$should_install" -ne 1 ]; then
    return
  fi

  if [ "$AUTO_INSTALL_BUN" = "1" ]; then
    info "FREE_CODE_AUTO_INSTALL_BUN=1, continue without prompt."
    install_bun
    return
  fi

  if [ ! -r /dev/tty ]; then
    fail "需要用户确认才能${bun_reason} bun，但当前无可用终端输入。
    你可以先手动安装 bun（>=${BUN_MIN_VERSION}），或显式设置：
      FREE_CODE_AUTO_INSTALL_BUN=1"
  fi

  echo "" > /dev/tty
  printf "${YELLOW}${BOLD}  检测到需要${bun_reason} bun，是否继续？ [y/N] ${RESET}" > /dev/tty
  local bun_confirm
  read -r bun_confirm < /dev/tty || bun_confirm=""
  case "$bun_confirm" in
    y|Y|yes|YES)
      install_bun
      ;;
    *)
      fail "已取消 bun ${bun_reason}。请先手动安装 bun（>=${BUN_MIN_VERSION}）后重试。"
      ;;
  esac
}

install_bun() {
  curl -fsSL https://bun.sh/install | bash
  # Source the updated profile so bun is on PATH for this session
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    fail "bun installation succeeded but binary not found on PATH.
    Add this to your shell profile and restart:
      export PATH=\"\$HOME/.bun/bin:\$PATH\""
  fi
  ok "bun: v$(bun --version) (just installed)"
}

# -------------------------------------------------------------------
# Clone & build
# -------------------------------------------------------------------

clone_repo() {
  if [ -d "$INSTALL_DIR" ]; then
    warn "$INSTALL_DIR already exists"
    if [ -d "$INSTALL_DIR/.git" ]; then
      info "Syncing runtime source tree..."
      git -C "$INSTALL_DIR" sparse-checkout set --no-cone "${RUNTIME_PATHS[@]}" 2>/dev/null || true
      git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH" 2>/dev/null || {
        warn "Pull failed, continuing with existing copy"
      }
      git -C "$INSTALL_DIR" sparse-checkout reapply 2>/dev/null || true
    else
      fail "$INSTALL_DIR exists but is not a git repository. Please move or remove it manually."
    fi
  else
    info "Cloning runtime source tree..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 --branch "$REPO_BRANCH" --single-branch --filter=blob:none --sparse "$REPO" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" sparse-checkout set --no-cone "${RUNTIME_PATHS[@]}"
  fi
  ok "Source: $INSTALL_DIR"
}

install_deps() {
  info "Installing dependencies..."
  cd "$INSTALL_DIR"
  bun install --frozen-lockfile 2>/dev/null || bun install
  ok "Dependencies installed"
}

build_binary() {
  info "Building free-code (all experimental features enabled)..."
  cd "$INSTALL_DIR"
  bun run build:dev:full
  ok "Binary built: $INSTALL_DIR/cli-dev"
}

link_binary() {
  local link_dir="$HOME/.local/bin"
  mkdir -p "$link_dir"

  ln -sf "$INSTALL_DIR/cli-dev" "$link_dir/freecode"
  ok "Symlinked: $link_dir/freecode"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$link_dir"; then
    warn "$link_dir is not on your PATH"
    echo ""
    printf "${YELLOW}  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):${RESET}\n"
    printf "${BOLD}    export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}\n"
    echo ""
  fi
}

# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------

header
info "Starting installation..."
echo ""

check_os
check_git
check_bun
echo ""

clone_repo
install_deps
build_binary
link_binary

echo ""
printf "${GREEN}${BOLD}  Installation complete!${RESET}\n"
echo ""
printf "  ${BOLD}Run it:${RESET}\n"
printf "    ${CYAN}freecode${RESET}                           # interactive REPL\n"
printf "    ${CYAN}freecode -p \"your prompt\"${RESET}           # one-shot mode\n"
echo ""
printf "  ${BOLD}Set your API key:${RESET}\n"
printf "    ${CYAN}export ANTHROPIC_API_KEY=\"sk-ant-...\"${RESET}\n"
echo ""
printf "  ${BOLD}Or log in with Claude.ai:${RESET}\n"
printf "    ${CYAN}freecode /login${RESET}\n"
echo ""
printf "  ${DIM}Source: $INSTALL_DIR${RESET}\n"
printf "  ${DIM}Binary: $INSTALL_DIR/cli-dev${RESET}\n"
printf "  ${DIM}Link:   ~/.local/bin/freecode${RESET}\n"
echo ""
