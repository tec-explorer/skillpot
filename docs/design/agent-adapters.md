# 设计：Agent 适配器与三档落地策略

> 状态：随版本演进 ｜ 相关：[产品规划 §4](../product/product-plan.md)、[MCP bridge](./mcp-bridge.md)

## 三档落地策略

SkillPot 的核心能力是"把中央仓库里的 skill 暴露给某个 Agent"。按目标 Agent 的能力分三档，由对应适配器实现：

| 档 | 策略 | 适用 | 现状 |
|---|---|---|---|
| A | 原生 skills 目录 + **symlink** | 有用户级 skills 目录约定的 Agent | M1 已交付五家 |
| B | 生成式降级（prompts/rules 薄引导文件，摘要 + 按需读取仓库路径） | 只有 prompts/rules 机制的 Agent | 规划中（M2+ 按需） |
| C | **MCP bridge**（`skillpot mcp`） | 任何支持 MCP 的 Agent | 已交付（见 mcp-bridge.md） |

## A 档：适配器接口

```ts
// src/agents/registry.ts
interface AgentAdapter {
  id: string;                    // 稳定标识，如 'claude-code'（expose 矩阵的键）
  name: string;                  // 展示名
  binaries: string[];            // PATH 探测的二进制名（按序尝试，取 --version）
  fingerprints: (home: string) => string[];  // 配置目录指纹（任一存在即视为安装）
  skillsDir: (home: string) => string;       // 用户级 skills 目录（A 档 symlink 目标）
  verified: string;              // 发现路径的验证依据（随验证升级）
  note?: string;                 // 展示给用户的注意事项
}
```

检测（`agents/detect.ts`）= 二进制信号 ∪ 目录指纹，任一命中即 `installed`。

### 开关的物理含义

- `enable` = `symlink ~/.skillpot/skills/<name>  <skillsDir>/<name>`，并登记 `state.json` 台账；
- `disable` = 移除台账内（或确认指向仓库的）链接；
- 安全规则：真实同名目录、外部 symlink 一律跳过并告警，绝不覆盖。

### 同名遮蔽

部分 Agent（如 ZCode）按发现顺序取第一个同名 skill：`~/.zcode/skills` > `~/.agents/skills` > 工作区 > plugin。`doctor` 负责提示遮蔽风险；SkillPot 默认**不写入** `~/.agents/skills` 广播目录（粗粒度广播无法按 Agent 关闭）。

## 新增适配器 Checklist

1. **确认发现路径**：官方文档或实机验证——在该 Agent 的用户级 skills 目录放一个指向中央仓库的 symlink，确认会话能发现并触发。给出证据（文档链接或实测记录）。
2. **实现适配器**：`registry.ts` 增加条目；`verified` 字段如实标注（`live 实测` / `官方文档，待实机确认` / `待确认`）。
3. **注意特殊约定**：目录名单复数（`skill` vs `skills`）、是否读取共享目录（`~/.agents/skills`）、frontmatter 扩展字段兼容性。
4. **测试**：`tests/detect.test.ts` 增加 fingerprints/skillsDir 用例；e2e 沙箱中伪造该 Agent 目录跑通 enable/disable。
5. **文档**：README「支持的 Agent」表格、CHANGELOG、（里程碑性变更）`docs/reports/` 执行报告。

## 验证等级（verified 字段约定）

| 标注 | 含义 |
|---|---|
| `live 实测` | symlink 探针在该 Agent 真机上被发现（最高置信） |
| `官方文档确认` | 路径来自官方文档，未实机验证 |
| `M0 格式确认` | 本机目录中存在同规范样例（如 Codex `.system`） |
| `待实机确认` | 路径合理但未验证 |

## 当前五家（0.4.0）

| Agent | 用户级目录 | 等级 |
|---|---|---|
| Claude Code | `~/.claude/skills` | live 实测 |
| ZCode | `~/.zcode/skills` | 官方文档确认 |
| Codex CLI | `~/.codex/skills` | M0 格式确认 |
| OpenCode | `~/.config/opencode/skill` | 待实机确认 |
| Gemini CLI | `~/.gemini/skills` | 待实机确认 |
