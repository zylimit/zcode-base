#!/usr/bin/env bash
# zcode-base 快速开始：生成安装清单 + 环境自检。
# 用法：bash setup.sh            （本仓初始化）
#       bash setup.sh /path/to   （安装到目标项目）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "" ]; then
  echo "[zcode-base] 本仓初始化：生成 FRAMEWORK-MANIFEST 并自检"
  node "$ROOT/.zcode/scripts/gen-manifest.mjs"
  node "$ROOT/.zcode/zbase.mjs" doctor
else
  echo "[zcode-base] 安装到目标项目：$1"
  node "$ROOT/.zcode/zbase.mjs" install "$1"
fi
