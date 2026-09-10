#!/usr/bin/env bash
# 沙箱端到端冒烟：全程不触碰真实 HOME
set -euo pipefail

SB="$(mktemp -d)"
export SKILLPOT_HOME="$SB/.skillpot"
export SKILLPOT_AGENT_HOME="$SB/home"
CLI="node dist/cli.mjs"
trap 'rm -rf "$SB"' EXIT

echo "== init =="
$CLI init

echo "== add (local fixture) =="
$CLI add tests/fixtures/demo-skill

echo "== list =="
$CLI list

echo "== enable claude-code,codex =="
$CLI enable demo-skill --for claude-code,codex

test -L "$SKILLPOT_AGENT_HOME/.claude/skills/demo-skill"
test "$(readlink "$SKILLPOT_AGENT_HOME/.claude/skills/demo-skill")" = "$SKILLPOT_HOME/skills/demo-skill"
test -f "$SKILLPOT_AGENT_HOME/.claude/skills/demo-skill/SKILL.md"
echo "ok: claude-code symlink -> store"

test -L "$SKILLPOT_AGENT_HOME/.codex/skills/demo-skill"
echo "ok: codex symlink -> store"

echo "== list --agent claude-code =="
$CLI list --agent claude-code | grep demo-skill

echo "== disable claude-code =="
$CLI disable demo-skill --for claude-code
test ! -e "$SKILLPOT_AGENT_HOME/.claude/skills/demo-skill"
test -L "$SKILLPOT_AGENT_HOME/.codex/skills/demo-skill"
echo "ok: claude-code 已撤下，codex 不受影响"

echo "== doctor =="
$CLI doctor

echo "== remove =="
$CLI remove demo-skill
test ! -e "$SKILLPOT_HOME/skills/demo-skill"
$CLI doctor | grep -q "体检通过"
echo "ok: 卸载干净，体检通过"

echo "== adopt（dry-run 预览 → 导入并开放给 gemini-cli）=="
mkdir -p "$SKILLPOT_AGENT_HOME/.claude/skills/legacy-skill"
cat > "$SKILLPOT_AGENT_HOME/.claude/skills/legacy-skill/SKILL.md" <<'EOF'
---
name: legacy-skill
description: A pre-existing user skill adopted from claude-code into the central store.
---
# Legacy
EOF
$CLI adopt --dry-run | grep legacy-skill
$CLI adopt --for gemini-cli | grep -q "导入 1"
test -f "$SKILLPOT_HOME/skills/legacy-skill/SKILL.md"
test -L "$SKILLPOT_AGENT_HOME/.gemini/skills/legacy-skill"
test -d "$SKILLPOT_AGENT_HOME/.claude/skills/legacy-skill"   # 原目录保留
$CLI list | grep legacy-skill
echo "ok: adopt 导入 + 原目录保留 + gemini-cli 已开放"

echo "== adopt --move（原目录替换为 symlink）=="
mkdir -p "$SKILLPOT_AGENT_HOME/.zcode/skills/zskill"
cat > "$SKILLPOT_AGENT_HOME/.zcode/skills/zskill/SKILL.md" <<'EOF'
---
name: zskill
description: A zcode skill to verify move adoption replaces the source directory.
---
# Z
EOF
$CLI adopt --move --from zcode | grep -q "导入 1"
test -L "$SKILLPOT_AGENT_HOME/.zcode/skills/zskill"
test -f "$SKILLPOT_HOME/skills/zskill/SKILL.md"
$CLI list | grep zskill
echo "ok: move 收编 + zcode 原目录已替换为 symlink"

echo "== lint =="
$CLI lint legacy-skill | grep -q "clean"
echo "ok: lint clean"

echo "== update（git 来源）=="
REPO="$SB/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
cat > "$REPO/SKILL.md" <<'EOF'
---
name: git-skill
description: Git-sourced skill used to verify update flow. Version one.
---
# v1
EOF
git -C "$REPO" add .
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q -m v1
$CLI add "file://$REPO" | grep -q "已安装 git-skill"
$CLI update git-skill | grep -q "已是最新"
cat > "$REPO/SKILL.md" <<'EOF'
---
name: git-skill
description: Git-sourced skill used to verify update flow. Version two here.
---
# v2
EOF
git -C "$REPO" add .
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q -m v2
$CLI update git-skill | grep -q "已更新"
grep -q "# v2" "$SKILLPOT_HOME/skills/git-skill/SKILL.md"
$CLI update --check | grep -q "已是最新"
test -f "$SKILLPOT_HOME/skillpot.lock.json"
test ! -f "$SKILLPOT_HOME/skillspot.lock.json"   # 0.11 的旧名会被清理
echo "ok: update 原位替换内容，lockfile 已生成（skillpot.lock.json）"

echo "== 通用广播列 =="
$CLI enable zskill --for broadcast | grep -q "通用广播"
test -L "$SKILLPOT_AGENT_HOME/.agents/skills/zskill"
test "$(readlink "$SKILLPOT_AGENT_HOME/.agents/skills/zskill")" = "$SKILLPOT_HOME/skills/zskill"
$CLI list --agent broadcast | grep -q zskill
$CLI list | grep zskill | grep -q broadcast
$CLI tui --once | grep -q "通用广播"
echo "ok: --for broadcast 落到 ~/.agents/skills 且进矩阵/列表"

# all 不含通用广播：整行开放后广播列之外的目标都被打开，广播本身不受影响
$CLI disable zskill --for all > /dev/null
test ! -e "$SKILLPOT_AGENT_HOME/.zcode/skills/zskill"
test -L "$SKILLPOT_AGENT_HOME/.agents/skills/zskill"
echo "ok: --for all 不含通用广播（disable all 之后广播仍在）"

$CLI disable zskill --for broadcast > /dev/null
test ! -e "$SKILLPOT_AGENT_HOME/.agents/skills/zskill"
echo "ok: 广播可撤下"

echo "== mcp bridge =="
MCP_OUT="$(printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | $CLI mcp 2>/dev/null)"
echo "$MCP_OUT" | grep -q '"skillpot"' && echo "ok: initialize"
echo "$MCP_OUT" | grep -q 'skillpot_read' && echo "ok: tools/list"

MCP_CALL="$(printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"skillpot_list","arguments":{"agent":"gemini-cli"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"skillpot_list","arguments":{"agent":"codex"}}}' | $CLI mcp 2>/dev/null)"
echo "$MCP_CALL" | grep 'legacy-skill' >/dev/null && echo "ok: gemini-cli 可见 legacy-skill（开关矩阵生效）"
echo "$MCP_CALL" | grep '(no skills)' >/dev/null && echo "ok: codex 被过滤（不可见）"

# 声明了 SKILLPOT_AGENT 时，调用方传的 agent 参数必须被忽略
MCP_ENV="$(printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"skillpot_list","arguments":{"agent":"gemini-cli"}}}' \
  | SKILLPOT_AGENT=codex $CLI mcp 2>/dev/null)"
echo "$MCP_ENV" | grep '(no skills)' >/dev/null && echo "ok: SKILLPOT_AGENT 优先，参数不可放宽矩阵"

# read 也受矩阵约束：codex 未开放 → 拒绝读取
MCP_READ="$(printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"skillpot_read","arguments":{"skill":"legacy-skill"}}}' \
  | SKILLPOT_AGENT=codex $CLI mcp 2>/dev/null)"
echo "$MCP_READ" | grep -q '未对 codex 开放' && echo "ok: read 未开放时拒绝（无读取旁路）"

echo "== tui（非 TTY 自动静态输出）=="
$CLI tui --once | grep -q "legacy-skill"
$CLI tui --once | grep -q "✓"
$CLI tui --once | grep -q "已开放"
echo "ok: 开关矩阵渲染（skill × 目标）"

echo "== agents（验证等级如实标注）=="
$CLI agents | grep -q "通用广播"
$CLI agents --json | grep -q '"verify": "unverified"'
$CLI agents --json | grep -q '"verify": "live"'
echo "ok: 未验证的 Agent 未被呈现为已确认"

echo "== doctor（收尾体检）=="
$CLI doctor | grep -q "体检通过"

echo
echo "E2E PASS"
