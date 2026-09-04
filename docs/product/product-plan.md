# SkillPot（skillpot）产品规划

> 跨编程 Agent 的 Skill 安装与管理器 —— **一处安装，按 Agent 开关，一处更新**。
> 版本：v0.1 草案 ｜ 日期：2026-09-03 ｜ 状态：待评审

---

## 0. TL;DR

编程 Agent（Claude Code、ZCode、Codex、OpenCode、Gemini CLI、Amp、Cursor…）已基本收敛到同一个 skill 格式（`SKILL.md`，Anthropic 开放标准），但** discovery 路径各自为政**，skill 装进 `~/.claude/skills` 就只对 Claude Code 生效。市面上有 skill 的"商店/registry"（解决从哪找），但没有一个"管理器"（解决装到哪、给谁用、怎么停、怎么更新）。

**SkillPot = skill 的 nvm + brew**：中央仓库存一份真身，通过"适配器 + 同步引擎"把 skill 以 symlink/生成物/MCP 三档策略暴露给各个 Agent，配置矩阵决定哪个 skill 对哪个 Agent 开放。CLI 优先，TUI 次之，云端 registry 最后。

---

## 1. 背景与机会

### 1.1 格式已收敛，管理仍缺位

- Anthropic 已将 Agent Skills（`SKILL.md` + YAML frontmatter，渐进式加载）开放为标准，OpenCode、Amp、Gemini CLI 等相继宣布原生支持，"给 Claude 写的 skill 零改动可用"。
- 但各家**发现路径不同**（见 §5 矩阵），且互相之间有同名遮蔽、优先级等冲突规则。
- 现有生态（Anthropic plugin marketplace、skills.sh 一类 registry）解决的是**分发**；**安装后的生命周期管理**（多 Agent 暴露、启停、更新、冲突检测）是空位。

### 1.2 本机实证（2026-09-03 扫描）

| Agent | 本机痕迹 | Skill 相关发现 |
|---|---|---|
| Claude Code | `~/.claude/` + `claude` CLI | `~/.claude/skills/` 下 **55+ 个 skill**（gstack、browse、office-hours、spec、ios-*…），全部只对 Claude Code 生效 |
| Codex | `~/.codex/` | `~/.codex/skills/` 已存在（含 `.system/`），说明 Codex 已有 skill 目录约定 |
| ZCode | `~/.zcode/` | 用户级读 `~/.zcode/skills/` **和 `~/.agents/skills/`**（跨工具共享目录），工作区读 `.zcode/skills/`、`.agents/skills/` |
| OpenCode | `~/.config/opencode/`（空）、`~/.opencode/` | 约定为 `~/.config/opencode/skill/<name>/SKILL.md`，尚未使用 |
| Gemini CLI | `~/.gemini/settings.json` | 标准支持 `~/.gemini/skills/`，尚未使用 |
| Cursor | `~/.cursor/` | 存在 `skills-cursor/` 目录（create-skill、migrate-to-skills 等），官方路径待确认 |
| Qoder / Continue | `~/.qoder/`、`~/.continue/` | 仅有 IDE 配置，skill 机制待调研 |

结论：**用户痛点真实存在**（55+ skill 锁死在一家），**各 Agent 的 skill 目录机制已铺好**（symlink 暴露可行性高），**缺的正是管理层**。

---

## 2. 产品定位

**一句话**：SkillPot 是跨编程 Agent 的 Skill 包管理器与调度中心 —— 一处安装、按 Agent 粒度开关、一处更新、冲突可诊断。

**目标用户**
1. **Power user**（首要）：同时用 2 个以上编程 Agent 的开发者，已积累了一批 skill，想让它们全 agent 可用且可控。
2. **团队**：把项目所需 skill 以清单形式提交进 repo，成员一键对齐（M2+）。

**与竞品的边界**
- Registry / marketplace（skills.sh、Anthropic marketplace）＝ "从哪找 skill" → **上游**，未来可对接为来源。
- SkillPot ＝ "装到哪、给谁用、怎么管" → 本品。不做 skill 内容平台，做**管理层**。

---

## 3. 核心概念模型

```
~/.skillpot/
├── skills/                    # 中央仓库：唯一真身（single source of truth）
│   └── <skill>/SKILL.md + scripts/ + references/ + assets/
├── config.yaml                # 注册表：skill 来源/版本/校验和 + Agent 检测缓存 + 开关矩阵
├── state.json                 # 本工具创建的 symlink/生成物台账（卸载只动台账内文件）
└── skillpot.lock.json         # 版本锁（团队共享用）
```

四个核心组件：

| 组件 | 职责 |
|---|---|
| **Store** | skill 只存一份，支持从 git 仓库/本地路径/registry 安装 |
| **Adapter（每 Agent 一个）** | `detect()` 检测安装与版本；`capabilities()` 能力分级；`materialize(skill)` / `dematerialize(skill)` 落地与撤下 |
| **Sync Engine** | 把 config 中的开关矩阵落地为各 Agent 目录里的实际状态；幂等，可重复执行 |
| **Doctor / Audit** | 断链修复、同名遮蔽检测、实际生效状态比对 |

---

## 4. 跨 Agent 落地策略（关键设计）

按目标 Agent 的能力分三档，适配器内聚：

### A 档：原生 skills 目录 → symlink（默认，覆盖绝大多数 Agent）
`enable` ＝ 在该 Agent 的 skills 目录创建指向中央仓库的 symlink；`disable` ＝ 删除该 symlink。即时生效（Agent 启动时扫描目录），无需常驻进程。
- 风险：个别 Agent 可能不跟随 symlink 或要求真实文件 → 该适配器降级为 **copy + 台账 + `skillpot sync` 手动/ watch 自动同步**。M0 必须逐家实测（见 §10）。

### B 档：无 skills 机制但有 prompts/commands/rules → 生成式降级
如个别 IDE/Agent 只有自定义 prompt 或规则文件：生成一个薄引导文件（skill 摘要 + "按需读取 `<store路径>` 下完整指令" 的模式），尽量保留渐进式加载的体验，并在 UI 上**明示降级**。

### C 档：MCP bridge（通用兜底）
`skillpot mcp` 启动一个 MCP server，提供 `skillpot_list / skillpot_read / skillpot_search` 工具。任何支持 MCP 的 Agent 都能消费；在每家的 MCP 配置里通过环境变量声明自己的身份（`SKILLPOT_AGENT=codex`），server 按开关矩阵**过滤返回**，从而 MCP 通道同样受开关控制。

### 关于 `~/.agents/skills/` 共享目录的特殊处理
ZCode 等已原生读取 `~/.agents/skills/`（跨工具广播目录）。它天然是"**粗粒度广播**"通道——放进去所有支持该约定的 Agent 都看得见，但**无法按 Agent 单独关闭**。SkillPot 默认不使用它作为仓库（否则破坏精细开关），而是：
- 默认走"中央仓库 + 各 Agent 自己目录内的 symlink"（精细控制）；
- `skillpot doctor` 会检测用户手动放入 `~/.agents/skills/` 的 skill，提示收编（`adopt`）或保持广播模式；
- 提供显式的 `--broadcast` 开关给想用共享目录的用户。

---

## 5. Agent 兼容矩阵（v0.1，✅=已验证 ❓=待 M0 确认）

| Agent | 用户级 skill 发现路径 | 工作区级 | 格式 | 落地策略 |
|---|---|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | SKILL.md 标准发源地 | A：symlink ✅（目录已在用） |
| ZCode | `~/.zcode/skills/`、`~/.agents/skills/` | `.zcode/skills/`、`.agents/skills/` | SKILL.md；同名按发现顺序遮蔽（用户 > 共享 > 工作区 > plugin） | A ✅（官方文档确认路径） |
| Codex CLI | `~/.codex/skills/`（本机已存在） | `.codex/prompts/`（自定义命令） | 待确认 frontmatter 兼容度 | A ❓ + B（prompts）备选 |
| OpenCode | `~/.config/opencode/skill/` | `.opencode/skill/` | SKILL.md，零改动兼容 Claude | A ❓（目录约定已公开） |
| Gemini CLI | `~/.gemini/skills/` | `.gemini/skills/` | SKILL.md 官方支持 | A ❓ |
| Amp | 全局/项目 skills 目录 | 同 | SKILL.md | A ❓ |
| Cursor | `~/.cursor/skills-cursor/`（本机发现，官方路径待确认） | `.cursor/rules/`（规则） | 待确认 | A/B ❓ |
| Qoder | 待调研（Quest 模式/rules 机制） | — | — | B/C 候选 |
| DeepSeek harness | 待调研 | — | — | C（MCP）候选 |
| 其他 MCP-capable Agent | — | — | — | C：MCP bridge |

---

## 6. Agent 检测设计

四类信号交叉验证，输出能力分级：

1. **PATH 二进制 + `--version`**：`claude`、`codex`、`opencode`、`zcode`、`gemini`、`amp`、`cursor-agent`…
2. **配置目录指纹**：`~/.claude`、`~/.zcode`、`~/.codex/config.toml`、`~/.config/opencode`、`~/.gemini`…（本机扫描证明此法有效——多个 Agent 无 CLI 入口但目录可识别）
3. **IDE 应用目录**：`/Applications`、`~/Library/Application Support/`（Cursor、Qoder 等 IDE 型）
4. **已有 skill 收编**：扫描各 Agent 目录下现存 skill，供 `skillpot adopt` 导入中央仓库

`skillpot agents` 输出示例：

```
Agent         Version   Skills能力   落地策略   接入   状态
claude-code   2.x       native(A)    symlink    55/55  ok
zcode         1.x       native(A)    symlink    0      ok
codex         0.5x      native(A?)   symlink    0      unverified
opencode      -         native(A)    symlink    0      detected
gemini-cli    -         native(A)    symlink    0      detected
cursor        2026.x    partial      copy       0      ide
```

检测结果缓存进 config，`--rescan` 强制刷新。

---

## 7. 开关控制设计

### 数据模型（config.yaml 示意）

```yaml
skills:
  browse:
    source: git@github.com:me/my-skills.git#v1.4.0
    checksum: sha256:...
    installed_at: 2026-09-03T16:00:00+08:00
    expose:            # 开关矩阵：skill × agent
      claude-code: true
      zcode: true
      codex: false
  spec:
    source: local:/Users/me/skills/spec
    expose:
      claude-code: true
```

- **全局级**：`~/.skillpot/config.yaml`；**项目级**：repo 内 `.skillpot.yaml` 声明本项目用哪些 skill（M2，团队共享入口）。
- **生效机制**：`enable/disable` 只改矩阵 + 立即执行 sync（建/删对应 Agent 目录下的 symlink）。Agent 重启会话后生效（各 Agent 均在会话启动时扫描，需在文档中明示；个别支持热加载的除外）。
- **卸载安全**：所有本工具创建的链接记录在 `state.json`，卸载/禁用只动台账内文件，绝不碰用户自建内容。

### 交互

- CLI：`skillpot enable browse --for claude,zcode`；`--for all`；`--except codex`。
- TUI（M2）：skill × Agent 的勾选矩阵，方向键开关，实时显示冲突告警。

---

## 8. CLI 命令草案（MVP 面）

```bash
skillpot init                      # 初始化中央仓库 + 首次 Agent 检测
skillpot agents                    # 列出检测到的 Agent 及能力/状态
skillpot add <git|path|registry>   # 安装 skill 到中央仓库（默认装完不开放，引导选择 Agent）
skillpot list [--agent claude]     # 列出已装 skill / 某 Agent 当前可见的 skill
skillpot enable <skill> --for a,b  # 开放给指定 Agent
skillpot disable <skill> --for a   # 对指定 Agent 关闭
skillpot remove <skill>            # 从仓库卸载（撤下所有链接）
skillpot doctor                    # 断链修复、同名遮蔽检测、矩阵与实际状态比对
```

M2 增补：`update / outdated`（版本）、`adopt`（收编现存 skill）、`lint`（安全与格式检查）、`mcp`（bridge server）、`sync`（copy 策略与项目级同步）。

---

## 9. 安全与信任（产品级必须项）

Skill 本质是**注入模型上下文的指令 + 可携带可执行脚本**，第三方 skill 安装等同于给了对方影响 Agent 行为的通道。因此：

1. **安装即 lint**：frontmatter 合法性、description 质量（影响触发）、脚本静态扫描、高危模式告警（`rm -rf`、`curl | sh`、读取 env/credentials、外发网络请求）。
2. **来源与完整性**：记录 source + checksum，lockfile 锁版本；`update` 展示 diff 再应用。
3. **最小暴露原则**：`add` 后默认不对任何 Agent 开放，由用户显式选择（防误扩散）。
4. **审计**：`skillpot audit` 报告"每个 Agent 实际生效的 skill 及来源"，可发现被绕过/遮蔽的情况。
5. 后期：签名与社区信誉分（M3，配合 registry）。

---

## 10. 路线图

### M0 — De-risk 验证 ✅（2026-09-03/04 完成）
- [x] symlink 实测：Claude/ZCode/Codex/Gemini 以 symlink 暴露可被发现（M0 探针确认）
- [x] Codex `~/.codex/skills/` 官方格式与 frontmatter 兼容（`.system/` 样例确认）
- [x] Cursor 官方路径确认为 `~/.cursor/skills/`（官方 create-skill 技能明示；`skills-cursor` 为本机特例，0.6.0 已修正适配器）
- [x] DeepSeek harness = npm `@deepseek-ai/dsh`（`~/.dsh/skills` 同 SKILL.md 约定，已接 A 档）；Qoder 无 skills 机制，维持观察
- [x] 定名 skillpot，npm 包 `@tec-explorer/skillpot`

### M1 — MVP ✅（2026-09-03 交付，超计划：+GUI）
范围：Claude Code、ZCode、OpenCode、Codex、Gemini CLI 五家 A 档 symlink 策略。
命令面：`init / agents / add / list / enable / disable / remove / doctor`。
交付形态：npm 包，`npx skillpot` 即用；TS 编写，vitest 单测 + 用真实 Agent 目录做 e2e 冒烟。

### M2 — 管理深化 ✅（2026-09-03/04 交付 ~90%）
`update/lockfile` ✅、`adopt`（含 --move）✅、项目级 `.skillpot.yaml` 与团队 bootstrap ⏳、TUI 矩阵视图 ✅、`lint` ✅（规则待补齐，见主线 A）、`mcp` bridge ✅、GUI ✅（超计划）、`skillpot audit` ⏳、update diff ⏳、copy+sync B 档与 `--broadcast` ⏳。
遗留项已并入下方主线 A/B/C。

### M3 — 生态与商业（进行中：市场 M1 已交付）
云端 registry（搜索/发布/评分）与 M2 的来源体系打通；GUI/桌面端；团队版（私有 registry、集中策略下发：如"公司合规 skill 全员强制开启"）。

### 当前主线（2026-09-04 评审确定，按序推进）

竞争态势：`vercel-labs/skills` CLI（73 Agent、skills.sh 目录背书）已逼近分发与覆盖面；SkillPot 不拼覆盖，**加速做深"管理层"护城河**（矩阵可控性/安全纵深/团队对齐），分发侧与 skills.sh 集成而非竞争。

| 主线 | 内容 | 状态 |
|---|---|---|
| **A 安全纵深** | lint 补齐（凭据读取/外发外传检测）、`skillpot audit`（各 Agent 实际生效报告）、`update --diff`（更新前展示差异）、skills.sh audit 集成 | 🔨 进行中 |
| **B 团队对齐** | 项目级 `.skillpot.yaml` + `skillpot sync`（成员按清单一键对齐安装与开放） | ✅ 2026-09-04 交付 |
| **C 覆盖与验证** | dsh/Cursor symlink 终验；不认 symlink 的 Agent 走 B 档 copy+sync；`--broadcast` 广播模式；Amp 等新 Agent 调研 | 🔁 随版本穿插 |
| **D 生态与触达** | skills.sh 在线目录集成（先解 auth）；英文 README；Homebrew 分发 | 📋 排队 |

优先级：A（定位支柱欠账）→ B（第二目标用户 + 对竞品护城河）→ C/D 穿插。

---

## 11. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言/运行时 | TypeScript + Node ≥ 20 | 目标用户全员有 Node；npm/npx 分发最低摩擦；与 skill 生态（脚本多为 py/ts）亲和 |
| TUI | Ink（React for CLI） | M2 矩阵视图 |
| 配置 | YAML（人改）+ JSON lock（机存） | 各 Agent 生态惯例 |
| 测试 | vitest + fixture 化的假 Agent 目录 + 真机冒烟矩阵 | 路径/发现逻辑是核心资产，必须可回归 |
| 备选 | Go 单二进制 | 若后续要做无 Node 依赖的桌面端再评估 |

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 各家格式/路径持续漂移 | 适配器失效 | 适配器隔离 + §5 矩阵做成**可执行的回归测试**；标准收敛是大势（顺风） |
| symlink 不被某 Agent 识别 | 策略 A 失效 | M0 逐家实测；降级 copy+sync；再降 MCP |
| 同名遮蔽/冲突（用户自装 vs SkillPot 装） | 触发混乱难排查 | `doctor` 做遮蔽检测（ZCode 的优先级规则已明确）；冲突时默认跳过并告警 |
| 恶意/低质第三方 skill | 安全事故 | §9 全套：lint、checksum、最小暴露、audit |
| 触发质量跨 Agent 不一致（description 启发式不同） | "能用但不好用" | `lint` 校验 description 质量；文档给出跨 Agent 触发调优建议 |
| Codex/部分 IDE 只能降级 | 体验打折 | UI 明示能力分级，不假装全功能 |

---

## 13. 命名（已定）

**skillpot**（CLI 命令，2026-09-03 用户最终确认），短别名 `spot`。
npm 包名 `@tec-explorer/skillpot`（挂在 tec-explorer 组织 scope 下，2026-09-03 变更）；bin 命令名仍为 `skillpot` / `spot`。
npm 查重：`skillpot` 可用；`skillhub`（v0.4.1，同类产品）与 `skillctl` 已被占用。
命名沿革：SkillPort → skillspot → skillpot（同日两次更正，此后所有文档与代码均以 skillpot 为准）。

---

## 附：关键参考

- Anthropic：Agent Skills 开放标准（anthropic.com/engineering/agent-skills-open-standard）
- OpenCode Skills 文档（opencode.ai/docs/skills/）
- Amp Skills 公告（ampcode.com/news/skills）
- Gemini CLI Agent Skills（developers.googleblog.com/gemini-cli-agent-skills）
- ZCode 配置指南（skills 用户级/工作区级/共享目录 `~/.agents/skills/` 与遮蔽规则）
- 本机扫描实证（§1.2）

---

## 14. 执行日志

执行日志按里程碑归档在 [`docs/reports/`](../reports/)：

- [2026-09-03 M0+M1 执行报告](../reports/2026-09-03-m0-m1-execution.md)
- [2026-09-03 M2 执行报告](../reports/2026-09-03-m2-execution.md)
- [2026-09-03 TUI 执行报告](../reports/2026-09-03-tui-execution.md)
- [2026-09-03 收编交互与 move 模式执行报告](../reports/2026-09-03-adopt-move-ux-execution.md)
- [2026-09-04 GUI G1 执行报告](../reports/2026-09-04-gui-g1-execution.md)
- [2026-09-04 GUI G2/G3/G4 执行报告](../reports/2026-09-04-gui-g2-g3-g4-execution.md)
- [2026-09-04 跟进批次(市场/适配器/矩阵优化)执行报告](../reports/2026-09-04-followups-market-execution.md)
- [2026-09-04 主线A 安全纵深执行报告(随 0.8.0 发布)](../reports/2026-09-04-followups-market-execution.md)
- [2026-09-04 主线B 团队对齐执行报告](../reports/2026-09-04-team-sync-execution.md)（最新）

