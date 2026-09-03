# M0 + M1 执行报告（2026-09-03）

> 状态：**M0 全部通过，M1 MVP 交付并验证**。对应规划：[产品规划](../product/product-plan.md)。

## M0 结果（全部完成）

| 验证项 | 结论 |
|---|---|
| symlink 探针实测 | **通过**：探针 skill symlink 进五家目录均可读；`claude -p` 实测 Claude Code 回答 YES（确认发现）。其余四家同机制，待有 CLI 入口时实测 |
| Codex 格式 | **确认**：`~/.codex/skills/.system/` 内置 skill（imagegen、skill-installer 等）与 Claude 规范完全一致（SKILL.md + name/description frontmatter） |
| Cursor | `~/.cursor/skills-cursor/` 存在同格式 skill（create-skill 等），官方发现路径待确认 → M2 |
| 二进制检测 | ZCode/OpenCode/Gemini/Codex 的 CLI 多不在 PATH，目录指纹为主要检测信号（已在真机验证 5/5 命中） |
| 定名 | `skillhub`（v0.4.1）、`skillctl` 已被占用，且 `skillhub` 为同类产品——赛道确认有竞争者（差异化：按 Agent 粒度开关、台账安全卸载、doctor 体检）；**最终定名 skillpot**（npm 可用，用户确认，短别名 `spot`）。注：同日内命名两次更正（SkillPort → skillspot → skillpot），本报告与工程均已按最终名呈现 |

> 探针实验后已全部清理，未在真实 Agent 目录留下任何残留。

## M1 交付（MVP 完成）

- npm 包 `skillpot` v0.1.0，bin：`skillpot` / `spot`；TypeScript + commander + yaml，Node ≥ 18。
- 命令面：`init / agents [--json] / add <dir|git[#subdir]> / list [-a agent] / enable / disable / remove / doctor [--fix]`。
- 核心机制：
  - 中央仓库 `~/.skillpot/skills/`（唯一真身）
  - `config.yaml` 开关矩阵（skill × Agent）+ `state.json` 链接台账（卸载只动台账内文件）
  - symlink 同步引擎：幂等；真实同名目录、用户自建链接一律跳过并告警
  - doctor：断链 / expose 漂移 / 未登记 skill / 孤儿链接检测，`--fix` 自动修复
- 安全默认：`add` 后不开放给任何 Agent，由用户显式选择。
- 质量门：17 个单元测试全绿（vitest，沙箱隔离）+ 沙箱 e2e 全流程通过（init → add → enable → 按 Agent 可见性 → disable → doctor → remove）+ 真机只读检测 5/5 命中（Claude Code 取到版本 2.1.237）。

## 工程结构（M1 时点）

```
src/
├── cli.ts               # 命令面（commander）
├── paths.ts             # 中央仓库/Agent HOME 路径（SKILLPOT_HOME / SKILLPOT_AGENT_HOME 可覆盖）
├── types.ts             # SkillEntry / 开关矩阵 / 台账 / 检测结果类型
├── agents/registry.ts   # 五家 Agent 适配器（发现路径 + 验证依据）
├── agents/detect.ts     # 检测引擎：PATH 二进制 + 配置目录指纹
├── core/config.ts       # config.yaml 与 state.json 读写、init
├── core/store.ts        # 安装（本地/git[#subdir]）、checksum
├── core/sync.ts         # enable/disable：symlink 建/撤 + 台账
└── core/doctor.ts       # 体检与自动修复
tests/                   # vitest 单测 + fixtures（沙箱隔离）
scripts/e2e-sandbox.sh   # 沙箱端到端冒烟
```

## 下一步（M1 收尾 → M2）

- [ ] enable/disable 输出中提示"重启 Agent 会话后生效"
- [ ] `skillpot adopt`：收编 `~/.claude/skills` 现有 55+ skill（含来源标记与冲突处理）
- [ ] `update / outdated` + lockfile（git 来源版本锁定与 checksum 比对）
- [ ] OpenCode / Gemini CLI 实机 symlink 验证（装机后跑探针）
- [ ] TUI 开关矩阵；`lint` 安装前安全扫描；`skillpot mcp` bridge（B/C 档覆盖 Cursor/Qoder 等）
