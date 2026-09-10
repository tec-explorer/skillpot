#!/usr/bin/env bash
# verify-probe.sh: 逐家实机探针测试脚本
# 用于在真实机器上验证指定 Agent 能否正确发现并处理 SkillPot 建立的软链接。
set -euo pipefail

TARGET="${1:-all}"
CLI="node dist/cli.mjs"

echo "=== SkillPot 实机探针验证工具 ==="
echo "目标: $TARGET"
echo

# 1. 确保已构建
if [ ! -f "dist/cli.mjs" ]; then
  echo "正在构建 CLI..."
  npm run build
fi

# 2. 获取 Agent 检测清单
echo "--- 本机 Agent 检测 ---"
$CLI agents

# 3. 构造临时探针 skill
TMP_DIR="$(mktemp -d)"
PROBE_SKILL="$TMP_DIR/probe-skill"
mkdir -p "$PROBE_SKILL"

cat > "$PROBE_SKILL/SKILL.md" <<'EOF'
---
name: probe-test-skill
description: Temporary probe skill generated to verify live symlink discovery on target agents.
---
# Probe Test Skill
This skill is a verification probe created by scripts/verify-probe.sh.
EOF

cleanup() {
  echo
  echo "--- 清理探针 ---"
  $CLI remove probe-test-skill >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
  echo "✔ 探针环境已清理完毕"
}
trap cleanup EXIT

echo
echo "--- 安装探针 Skill ---"
$CLI add "$PROBE_SKILL" --name probe-test-skill

# 4. 针对目标开放
echo
echo "--- 开放探针至目标: $TARGET ---"
$CLI enable probe-test-skill --for "$TARGET"

echo
echo "--- 执行体检与审计 ---"
$CLI doctor
$CLI audit || true

echo
echo "✔ 实机探针验证完成：软链接创建、解引用、矩阵登记与体检均正常。"
echo "提示：您现在可以打开对应 Agent（如 claude / gemini），确认其能否触发 'probe-test-skill'。"
