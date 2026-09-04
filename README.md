# SkillPot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)
[![CI](https://github.com/tec-explorer/skillpot/actions/workflows/ci.yml/badge.svg)](https://github.com/tec-explorer/skillpot/actions)

**跨编程 Agent 的 Skill 管理器 —— 一处安装，按 Agent 开关，一处更新。**
*Cross-agent skill manager for coding agents: install once, expose per agent, update once.*

> 编程 Agent(Claude Code、ZCode、Codex、OpenCode、Gemini CLI、DeepSeek CLI、Cursor…)已收敛到同一套 `SKILL.md` 开放标准,但发现路径各自为政:装进 `~/.claude/skills` 就只对 Claude Code 生效。SkillPot 把 skill 收进一个中央仓库,按 Agent 粒度开关暴露,并提供冲突体检与安全扫描。

![GUI 开关矩阵](docs/images/gui-matrix.png)

📖 **[功能指南(含 TUI/GUI 全功能截图与说明)](docs/guide.md)**

## 特性

- **一处安装**：中央仓库 `~/.skillpot/skills/` 存唯一真身，自带 checksum 与 lockfile
- **按 Agent 开关**：`config.yaml` 里的 skill × Agent 矩阵 + symlink 同步引擎；TUI 矩阵可视化切换，或 `skillpot gui` 浏览器控制台
- **市场**：内置 Anthropic 官方技能库，支持自定义 git 技能源，浏览并一键安装
- **一处更新**：git 来源 skill 的 `update / --check`，原位替换、无需重连
- **收编（adopt）**：一键迁移散落在各 Agent 目录里的既有 skill，拷贝 / 移动两种模式
- **安全**：`lint` 安装前扫描（frontmatter 完整性 + 脚本高危模式）、默认最小暴露、台账化安全卸载
- **MCP bridge**：任何支持 MCP 的 Agent 都能消费中央仓库，同样受开关矩阵约束
- **doctor 体检**：断链 / 漂移 / 同名遮蔽 / 孤儿链接，`--fix` 自动修复

## 工作原理

```
~/.skillpot/
├── skills/<name>/SKILL.md   # 中央仓库：唯一真身（自包含，symlink 已解引用）
├── config.yaml              # 来源/版本/校验和 + skill×Agent 开关矩阵
├── state.json               # 本工具创建的链接台账（卸载只动台账内文件）
└── skillspot.lock.json      # 机器可读快照（团队共享/审计用）
```

`enable` 在目标 Agent 的用户级 skills 目录创建指向中央仓库的 **symlink**（Agent 启动扫描目录时即被发现）；`disable` 撤下该 symlink。只动台账内的链接，绝不碰用户自建内容；遇到真实同名目录一律跳过并告警。

## 快速开始

要求 Node ≥ 18。

**安装 skillpot 本体**（三选一）：

```bash
npm install -g @tec-explorer/skillpot          # npm registry 安装（tec-explorer 组织 scope）；短别名 spot，或免安装 npx @tec-explorer/skillpot
npm install -g github:tec-explorer/skillpot    # GitHub 直装（安装时自动构建，无需等 npm 发布）
npx github:tec-explorer/skillpot init          # 免安装直接运行
```

**常用命令**：

```bash
skillpot init                        # 初始化 ~/.skillpot 并检测本机 Agent
                                     # （仓库为空时会扫描各 Agent 已有 skill，交互询问是否移入）
skillpot adopt --dry-run             # 预览：各 Agent 目录下有哪些 skill 可收编
skillpot adopt --move                # 收编并以移动模式部署（原目录替换为 symlink）
spot tui                             # 交互式开关矩阵：↑↓←→ 移动，空格切换，a 整行
skillpot gui                         # 浏览器控制台（本地 Web GUI）：矩阵点击切换 + 体检一键修复
skillpot add ~/path/to/my-skill      # 安装新 skill（默认不对任何 Agent 开放）
skillpot enable my-skill --for claude-code,zcode
skillpot doctor                      # 体检：断链/漂移/同名冲突
```

> Agent 在会话启动时扫描 skill 目录，enable/disable 后重启示例会话生效。

**安装 skill 来源**：`skillpot add https://github.com/owner/skills.git#subdir`（浅克隆，`#` 后定位子目录；也支持 `file://` 本地仓库）。

**从源码运行**（开发模式）：clone 后 `npm install`（自动构建），再 `npm link` 即可全局使用 `skillpot`。

## 命令

| 命令 | 说明 |
|---|---|
| `init` | 初始化中央仓库 + Agent 检测（空仓库时触发收编提醒） |
| `agents [--json]` | 检测本机编程 Agent（PATH 二进制 + 配置目录指纹） |
| `add <dir\|git[#subdir]> [-n 名字]` | 安装 skill（自动 lint） |
| `list [-a agent]` | 开关矩阵 / 某 Agent 的可见列表 |
| `enable <skill> -f a,b\|all` | 开放（建 symlink） |
| `disable <skill> -f a,b\|all` | 关闭（撤 symlink） |
| `adopt [--from agents] [-f agents] [--move] [--dry-run]` | 收编已有 skill；`--move` 移动模式 |
| `remove <skill>` | 卸载（撤下所有链接 + 删除文件） |
| `doctor [--fix]` | 体检与自动修复 |
| `lint [skill] [--strict]` | 安全与质量检查：frontmatter + 脚本高危模式 |
| `update [skill] [--check]` | 检查/应用 git 来源 skill 的更新 |
| `mcp` | 以 MCP server (stdio) 运行，供支持 MCP 的 Agent 消费 |
| `tui [--once]` | 交互式开关矩阵；无 TTY 自动降级静态输出 |

## 支持的 Agent

| Agent | 用户级 skills 目录 | 验证依据 |
|---|---|---|
| Claude Code | `~/.claude/skills` | live 实测（symlink 探针经 `claude -p` 确认） |
| ZCode | `~/.zcode/skills` | 官方配置文档 |
| Codex CLI | `~/.codex/skills` | 同规范样例确认（`.system` 内置 skill） |
| OpenCode | `~/.config/opencode/skill` | 官方文档，待实机确认 |
| Gemini CLI | `~/.gemini/skills` | 官方支持 Agent Skills，待实机确认 |

其他支持 MCP 的 Agent（Cursor、Qoder、私有 harness…）可走 [MCP bridge](#mcp-bridgec-档兜底)。新增适配器方法见 [docs/design/agent-adapters.md](./docs/design/agent-adapters.md)。

## MCP bridge（C 档兜底）

无原生 skills 目录的 Agent 可通过 MCP 消费中央仓库：把 `skillpot mcp`（stdio）注册为其 MCP server，即获得 `skillpot_list / skillpot_read / skillpot_search` 三个工具；用 `SKILLPOT_AGENT=<agentId>` 环境变量或 `agent` 参数按开关矩阵过滤，`disable` 对 MCP 通道同样即时生效。设计说明见 [docs/design/mcp-bridge.md](./docs/design/mcp-bridge.md)。

## 安全

Skill 是注入模型上下文的指令 + 可携带可执行脚本。SkillPot 的默认安全姿态：

- `add` / `adopt` 之后**不开放给任何 Agent**，由用户显式选择
- 安装时自动 `lint`：frontmatter 完整性、脚本高危模式（`rm -rf`、`curl|sh`、`sudo`…）
- 卸载/禁用只动 `state.json` 台账内的链接，绝不触碰用户自建内容
- 拷贝解引用 symlink，仓库自包含，不依赖来源机器的链接目标

漏洞报告请走 [SECURITY.md](./SECURITY.md)，勿用公开 Issue。

## 常见问题

**为什么用 symlink 而不是复制到每个 Agent？**
复制会产生 56 份副本，更新与关闭都不可控。symlink 只有一份真身：`disable` 即撤链接，`update` 原位替换即全部生效。

**Windows 支持吗？**
符号链接在 Windows 需要开发者模式或管理员权限，目前未测试，欢迎 PR。

**和 skill registry（skills.sh 等）是什么关系？**
Registry 解决"从哪找 skill"，SkillPot 解决"装到哪、给谁用、怎么停、怎么更新"——管理层。两者互补，registry 可作为 `add` 的上游来源。

## 开发

```bash
npm install
npm test          # vitest 单元测试（沙箱隔离，不碰真实 HOME）
npm run test:e2e  # 沙箱端到端冒烟
npm run build     # tsc 类型检查 + esbuild 打包为单文件 ESM（dist/cli.mjs，含 TUI）
```

测试与沙箱通过 `SKILLPOT_HOME` / `SKILLPOT_AGENT_HOME` 环境变量隔离。贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 文档

全部文档在 [docs/](./docs/README.md)（索引）：[产品规划](./docs/product/product-plan.md) ｜ [设计：适配器与落地策略](./docs/design/agent-adapters.md) ｜ [设计：MCP bridge](./docs/design/mcp-bridge.md) ｜ [里程碑执行报告](./docs/reports/) ｜ [CHANGELOG](./CHANGELOG.md)

## 贡献

Issue / PR 均欢迎，流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)，行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## License

[MIT](./LICENSE)
