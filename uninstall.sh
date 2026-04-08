#!/usr/bin/env bash
set -euo pipefail

# free-code 卸载脚本
# Usage: curl -fsSL https://raw.githubusercontent.com/nooldey/free-code/private/uninstall.sh | bash
# 建议：先下载脚本并校验后再执行，避免直接远程管道执行

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

APP_NAME="free-code"
INSTALL_DIR=""
LEGACY_INSTALL_DIR="$HOME/free-code"
LINK_DIR="$HOME/.local/bin"
LINK_PATH="$LINK_DIR/free-code"
DRY_RUN=0

info()  { printf "${CYAN}[*]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[x]${RESET} %s\n" "$*"; exit 1; }

detect_install_dir() {
  case "$(uname -s)" in
    Darwin)
      OS="macos"
      INSTALL_DIR="$HOME/.config/$APP_NAME"
      ;;
    Linux)
      OS="linux"
      INSTALL_DIR="$HOME/$APP_NAME"
      ;;
    *)
      fail "Unsupported OS: $(uname -s). macOS or Linux required."
      ;;
  esac

  if [ "$OS" = "macos" ] && [ ! -d "$INSTALL_DIR" ] && [ -d "$LEGACY_INSTALL_DIR" ]; then
    INSTALL_DIR="$LEGACY_INSTALL_DIR"
    warn "检测到旧版安装目录，当前将按旧路径卸载: $INSTALL_DIR"
  fi
}

confirm_uninstall() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "当前为 dry-run 模式，不会执行删除。"
  fi

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

  printf "${BOLD}  请输入完整路径以确认删除（%s）: ${RESET}" "$INSTALL_DIR"
  read -r confirm_path
  if [ "$confirm_path" != "$INSTALL_DIR" ]; then
    info "确认路径不匹配，已取消卸载。"
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
    if [ "$DRY_RUN" -eq 1 ]; then
      info "[dry-run] 将删除软链接: $LINK_PATH"
    else
      rm -f -- "$LINK_PATH"
      ok "Removed symlink: $LINK_PATH"
    fi
  else
    warn "Symlink not found: $LINK_PATH"
  fi
}

remove_install_dir() {
  if [ -d "$INSTALL_DIR" ]; then
    system_home=""
    if command -v getent >/dev/null 2>&1; then
      system_home="$(getent passwd "$(id -u)" | cut -d: -f6 || true)"
    elif command -v dscl >/dev/null 2>&1; then
      system_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)"
    fi
    if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
      fail "检测到异常 HOME（空或根目录），拒绝删除。"
    fi
    if [ -n "$system_home" ] && [ "$HOME" != "$system_home" ]; then
      fail "HOME 与系统用户目录不一致，疑似环境污染，拒绝删除。"
    fi
    if [ -z "$INSTALL_DIR" ] || [ "$INSTALL_DIR" = "/" ]; then
      fail "检测到危险安装目录，拒绝删除。"
    fi
    local allowed_primary="$HOME/$APP_NAME"
    local allowed_macos="$HOME/.config/$APP_NAME"
    if [ "$INSTALL_DIR" != "$allowed_primary" ] && [ "$INSTALL_DIR" != "$allowed_macos" ] && [ "$INSTALL_DIR" != "$LEGACY_INSTALL_DIR" ]; then
      fail "安装目录不符合白名单规则（仅允许 \$HOME/$APP_NAME、\$HOME/.config/$APP_NAME 或旧版目录），拒绝删除。"
    fi
    if [ -L "$INSTALL_DIR" ]; then
      fail "安装目录是符号链接，拒绝递归删除。"
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      info "[dry-run] 将删除安装目录: $INSTALL_DIR"
    else
      rm -rf -- "$INSTALL_DIR"
      ok "Removed installation directory: $INSTALL_DIR"
    fi
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

# 参数解析
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      cat <<EOF
Usage: bash uninstall.sh [--dry-run]

Options:
  --dry-run  仅打印将执行的操作，不实际删除文件
  -h, --help 显示帮助
EOF
      exit 0
      ;;
    *)
      fail "Unknown argument: $arg"
      ;;
  esac
done

header
info "Starting uninstallation..."
echo ""

detect_install_dir
confirm_uninstall
echo ""

remove_symlink
remove_install_dir
echo ""

summary
