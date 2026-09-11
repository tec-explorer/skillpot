# 设计：Agent 适配器与三档落地策略

> 状态：随版本演进 ｜ 相关：[产品规划 §4](../product/product-plan.md)、[MCP bridge](./mcp-bridge.md)

## 三档落地策略

SkillPot 的核心能力是"把中央仓库里的 skill 暴露给某个 Agent"。按目标 Agent 的能力分三档，由对应适配器实现：

| 档 | 策略 | 适用 | 现状 |
|---|---|---|---|
| A | 原生 skills 目录 + **symlink** | 有用户级 skills 目录约定的 Agent | M1 已交付五家 |
| B | 生成式降级（prompts/rules 薄引导文件，摘要 + 按需读取仓库路径） | 只有 prompts/rules 机制的 Agent | 规划中（M2+ 按需） |
| C | **MCP bridge**（`skillpot mcp`） | 任何支持 MCP 的 Agent | 已交付（见 mcp-bridge.md） |

## 目标类型：agent 与 channel

矩阵的列（`expose` 的键）分两类目标，走**同一套** enable/disable/symlink/台账语义：

| kind | 含义 | 例子 | 是否并入 `--for all` |
|---|---|---|---|
| `agent` | 某个 Agent 的用户级 skills 目录 | `claude-code`、`codex` | 是 |
| `channel` | 跨工具共享目录（粗粒度广播） | `broadcast` → `~/.agents/skills` | **否**（须显式指定） |

`broadcast` 不并入 `all` 的原因是可撤销性：某 Agent 同时读自己的目录与 `~/.agents/skills` 时，
`disable --for <agent>` 撤不掉共享目录里的那一份，矩阵会出现"显示已关闭、实际仍可见"。
因此它只由显式开放产生，UI 上单独标注（TUI 整行开关跳过该列、GUI 批量操作带二次确认）。

0.11 及更早由 `skillpot broadcast` 写入的广播链接只落在台账、未登记 `expose`；
`src/core/expose.ts` 的 `isExposed()` 对这一列额外以台账为准，矩阵/体检/审计/列表统一走它，
避免老用户的广播被误判为"已关闭但链接残留"并被 `doctor --fix` 撤掉。

## A 档：适配器接口

```ts
// src/agents/registry.ts
interface AgentAdapter {
  id: string;                    // 稳定标识，如 'claude-code'（expose 矩阵的键）
  name: string;                  // 展示名
  kind?: 'agent' | 'channel';    // 缺省 agent；channel = 跨工具共享目录
  binaries: string[];            // PATH 探测的二进制名（按序尝试，取 --version）
  fingerprints: (home: string) => string[];  // 配置目录指纹（任一存在即视为安装）
  skillsDir: (home: string) => string;       // 用户级 skills 目录（symlink/copy 目标）
  materialize?: 'symlink' | 'copy';          // 落地方式（缺省 symlink）
  verify?: VerifyLevel;          // live | docs | unverified（缺省 unverified）
  verified: string;              // 人类可读的确认依据
  note?: string;                 // 展示给用户的注意事项
}
```

检测（`agents/detect.ts`）= 二进制信号 ∪ 目录指纹，任一命中即 `installed`；
**channel 例外**：它不是"装没装某 Agent"，而是始终可写的共享通道，`installed` 恒为 true。

### 开关的物理含义

- `enable` = `symlink ~/.skillpot/skills/<name>  <skillsDir>/<name>`，并登记 `state.json` 台账；
- `disable` = 移除台账内（或确认指向仓库的）链接；
- 安全规则：真实同名目录、外部 symlink 一律跳过并告警，绝不覆盖。

### 同名遮蔽

部分 Agent（如 ZCode）按发现顺序取第一个同名 skill：`~/.zcode/skills` > `~/.agents/skills` > 工作区 > plugin。`doctor` 负责提示遮蔽风险。`~/.agents/skills` 现已作为 `broadcast` 渠道列纳入矩阵，但它仍是**粗粒度**通道：写进去的 skill 对该约定的所有 Agent 可见，无法按 Agent 单独关闭，所以默认不写入、也不并入 `--for all`。

## 新增适配器 Checklist

1. **确认发现路径**：官方文档或实机验证——在该 Agent 的用户级 skills 目录放一个指向中央仓库的 symlink，确认会话能发现并触发。给出证据（文档链接或实测记录）。
2. **实现适配器**：`registry.ts` 增加条目；`verify` 如实标注（`live` / `docs` / `unverified`），并在 `verified` 里写清依据。
3. **注意特殊约定**：目录名单复数（`skill` vs `skills`）、是否读取共享目录（`~/.agents/skills`）、frontmatter 扩展字段兼容性。
4. **测试**：`tests/detect.test.ts` 增加 fingerprints/skillsDir 用例；e2e 沙箱中伪造该 Agent 目录跑通 enable/disable。
5. **文档**：README「支持的 Agent」表格、CHANGELOG、（里程碑性变更）`docs/reports/` 执行报告。

## 验证等级（`verify` 字段）

机器可读三档（`src/types.ts` 的 `VerifyLevel`），`agents` 命令与 GUI 矩阵表头按此如实展示：

| 等级 | 展示 | 含义 |
|---|---|---|
| `live` | 实测 | symlink 探针在该 Agent 真机上被发现（最高置信） |
| `docs` | 文档确认 | 路径有官方文档/规范依据，链接发现未实测 |
| `unverified` | 未验证 | 路径本身仍待确认 |

判定口径以**"该 Agent 能否发现 SkillPot 建立的链接"**为准：官方文档确认了路径、但没人实测过链接被发现，就是 `docs` 或 `unverified`，不是 `live`。宁可低报，不可把未验证呈现为已确认——`enable` 后 skill 静默不生效是最伤用户的失败模式。

## 当前适配器（8 家 + 1 渠道）

以 `src/agents/registry.ts` 为唯一事实源（逐家证据详见 [verification-matrix.md](./verification-matrix.md)）：

| 目标 | kind | 目录 | 等级 |
|---|---|---|---|
| Claude Code | agent | `~/.claude/skills` | live 实测 |
| Gemini CLI | agent | `~/.gemini/skills` | live 实测 |
| ZCode | agent | `~/.zcode/skills` | docs |
| Codex CLI | agent | `~/.codex/skills` | docs |
| OpenCode | agent | `~/.config/opencode/skill` | docs |
| Cursor | agent | `~/.cursor/skills` | docs |
| Amp | agent | `~/.config/amp/skills` | docs |
| 通用广播 | channel | `~/.agents/skills` | docs |
| DeepSeek CLI | agent | `~/.dsh/skills` | unverified |

