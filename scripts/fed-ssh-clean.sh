#!/usr/bin/env bash
# 清理 Linux 侧为 crosschat 跨机联邦配的 ssh 信息（幂等，可重复跑）。
# 清四样：收下的对端公钥 / NAT 回程别名块 / 隧道指纹与 keyscan 垃圾注释 / 本机联邦密钥对。
# 对端不同请改 PEER_PUB_MARK；双向（真实对端地址）别名块不自动删，需手删 config 对应块。
# 用法：bash fed-ssh-clean.sh [--keep-keys]   # --keep-keys = 保留本机密钥对
set -euo pipefail

PEER_PUB_MARK='crosschat-localhost-verify'   # 对端公钥的备注段（win 侧默认密钥名）
NAT_RETURN_PORT=2222                          # NAT 回程别名指向的隧道端口

cd ~/.ssh 2>/dev/null || { echo "~/.ssh 不存在，无可清理"; exit 0; }

echo "== 1/4 authorized_keys：删备注含 $PEER_PUB_MARK 的对端公钥行"
if [ -f authorized_keys ]; then
  before=$(wc -l < authorized_keys)
  sed -i "/$PEER_PUB_MARK/d" authorized_keys
  echo "   $before -> $(wc -l < authorized_keys) 行"
else
  echo "   无此文件，跳过"
fi

echo "== 2/4 config：删 NAT 回程别名块（HostName localhost + Port $NAT_RETURN_PORT）"
if [ -f config ]; then
  awk -v port="$NAT_RETURN_PORT" '
    function flush() { if (buf != "" && !(loc && p)) out = out buf; buf = ""; loc = 0; p = 0 }
    /^Host[ \t]/ { flush() }
    { buf = buf $0 "\n"
      if ($1 == "HostName" && $2 == "localhost") loc = 1
      if ($1 == "Port" && $2 == port) p = 1 }
    END { flush(); printf "%s", out }
  ' config > config.tmp && mv config.tmp config
  cat config
else
  echo "   无此文件，跳过"
fi

echo "== 3/4 known_hosts：删隧道指纹 + keyscan 垃圾注释行"
if [ -f known_hosts ]; then
  ssh-keygen -R "[localhost]:$NAT_RETURN_PORT" >/dev/null 2>&1 || true
  sed -i '/^#/d' known_hosts
  rm -f known_hosts.old
  echo "   剩 $(wc -l < known_hosts) 行"
else
  echo "   无此文件，跳过"
fi

echo "== 4/4 本机联邦密钥对"
if [ "${1:-}" != "--keep-keys" ] && [ -f id_ed25519 ]; then
  rm -f id_ed25519 id_ed25519.pub
  echo "   已删 id_ed25519 / id_ed25519.pub（要保留请加 --keep-keys 重跑）"
else
  echo "   保留"
fi

echo "== 结果自证（应无对端公钥/无回程别名块/密钥视参数）"
ls -la
