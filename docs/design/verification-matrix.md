# Agent 逐家验证证据矩阵（Verification Matrix）

> 维护者与用户的一致信任基准。拒绝竞品式的“宣称支持 N 家却无证据”，SkillPot 公开每一家 Agent 的规范来源、发现路径、验证等级与实机探针测试方法。

---

## 验证等级定义与准则

| 等级 | 标识 | 含义 | 准入条件 |
|---|---|---|---|
| **实测** | `live` | 最高置信度 | 经实机探针（命令行参数 `-p` 或真实会话）确认能发现 SkillPot 建立的链接并正常触发 |
| **文档确认** | `docs` | 规范级置信度 | 路径与格式有官方公开文档、官方插件或官方内置样例明确支持，软链接发现待进一步实测记录 |
| **未验证** | `unverified` | 探索性适配 | 目录约定初步成型，但运行时加载逻辑或路径仍在演进中，纳管作为前瞻性约定 |

> [!IMPORTANT]
> **技术诚实原则**：宁可低报，绝不将仅停留在文档层面的路径谎报为 `live`。`enable` 后若 skill 静默失效是对开发者体验最大的伤害。

---

## 逐家验证证据总表

| 目标标识 | Agent 展示名 | 目标类型 | 用户级发现路径 | 验证等级 | 规范依据与验证证据 |
|---|---|---|---|---|---|
| `claude-code` | **Claude Code** | `agent` | `~/.claude/skills` | **实测** `live` | Anthropic 官方 Agent Skills 标准发源地；M0 探针实测 `claude -p` 与交互会话可无缝扫描并触发 |
| `zcode` | **ZCode** | `agent` | `~/.zcode/skills` | **文档确认** `docs` | 官方配置指南确认用户级路径；明确定义同名优先级（用户 > 共享 > 工作区 > 插件）；同时读取 `~/.agents/skills` |
| `codex` | **Codex CLI** | `agent` | `~/.codex/skills` | **文档确认** `docs` | 官方内置 `.system` 样例确认完全遵从 `SKILL.md` 标准；工作区另读 `.codex/prompts` |
| `opencode` | **OpenCode** | `agent` | `~/.config/opencode/skill` | **文档确认** `docs` | 官方文档公开约定为单数 `skill/` 目录，零改动兼容 Anthropic SKILL.md 格式 |
| `gemini-cli` | **Gemini CLI / Antigravity** | `agent` | `~/.gemini/skills` | **实测** `live` | Google Antigravity / Gemini CLI 官方 Customization System，原生支持渐进式加载 `SKILL.md`，实机探针确认生效 |
| `cursor` | **Cursor** | `agent` | `~/.cursor/skills` | **文档确认** `docs` | 官方 `create-skill` 技能与规则手册确认用户级 `~/.cursor/skills` 与项目级 `.cursor/skills` 约定 |
| `amp` | **Amp** | `agent` | `~/.config/amp/skills` | **文档确认** `docs` | Amp 官方技能规范公告明确支持用户级与项目级 skills 目录多路并发扫描 |
| `dsh` | **DeepSeek CLI** | `agent` | `~/.dsh/skills` | **未验证** `unverified` | 目录结构与 Anthropic 对齐，但 0.1.2 代码尚未完全收口动态扫描，纳管为前瞻性约定 |
| `broadcast` | **通用广播（共享目录）** | `channel` | `~/.agents/skills` | **实测** `live` | 跨工具共享开放规范（Vercel `skills` CLI、ZCode、Antigravity、Amp 原生读取），实机确认多工具共识 |

---

## 逐家详细验证详情与探针测试命令

### 1. Claude Code (`claude-code`)
- **路径**：`~/.claude/skills/<skill-name>/SKILL.md`
- **规范来源**：[Anthropic Agent Skills Open Standard](https://anthropic.com/engineering/agent-skills-open-standard)
- **验证方式**：
  ```bash
  # 建立测试软链接
  skillpot enable demo-skill --for claude-code
  # 验证会话能发现该 skill
  claude -p "List available skills and summarize demo-skill"
  ```
- **实测结论**：`claude` 会在会话启动时遍历 `~/.claude/skills` 下的所有软链接，正确解引用并读取 frontmatter 中的 description。

---

### 2. Gemini CLI / Antigravity (`gemini-cli`)
- **路径**：`~/.gemini/skills/<skill-name>/SKILL.md`（用户级）及 `.agents/skills`（工作区级）
- **规范来源**：Google Antigravity Customization System (`agy-customizations`)
- **验证方式**：
  ```bash
  # 建立测试软链接
  skillpot enable demo-skill --for gemini-cli
  # 或通过通用广播开放
  skillpot enable demo-skill --for broadcast
  ```
- **实测结论**：Antigravity 遵循渐进式加载（Progressive Disclosure），先解析 frontmatter 的 `name` 与 `description`，并在模型决策触发时完整加载 `SKILL.md` 正文。

---

### 3. ZCode (`zcode`)
- **路径**：`~/.zcode/skills/<skill-name>/SKILL.md`
- **规范来源**：ZCode 官方配置与扩展指南
- **遮蔽规则（同名处理）**：
  $$\text{User Level } (\sim/.zcode/skills) > \text{Shared Channel } (\sim/.agents/skills) > \text{Workspace } (.zcode/skills) > \text{Plugins}$$
- **注意事项**：ZCode 原生读取通用广播目录 `~/.agents/skills`，但 SkillPot 遵循精细控制原则，默认推荐使用 `~/.zcode/skills` 独立开关。

---

### 4. Codex CLI (`codex`)
- **路径**：`~/.codex/skills/<skill-name>/SKILL.md`
- **规范来源**：Codex CLI 内置 `.system/` skill 包结构
- **特点**：对 `SKILL.md` 的 YAML frontmatter 完全兼容，支持在 instructions 中引用外部脚本和 references。

---

### 5. OpenCode (`opencode`)
- **路径**：`~/.config/opencode/skill/<skill-name>/SKILL.md`
- **重要细节**：目录名为单数 `skill` 而非复数 `skills`，适配器内部已做精确适配。
- **规范来源**：[OpenCode Skills Docs](https://opencode.ai/docs/skills/)

---

### 6. Cursor (`cursor`)
- **路径**：`~/.cursor/skills/<skill-name>/SKILL.md`
- **规范来源**：Cursor 官方 `create-skill` 扩展与新版规范
- **历史说明**：早期 0.5.1 版本曾探测到部分机器上的 `skills-cursor` 目录，0.6.0 起已全面修正对齐为官方标准 `~/.cursor/skills`。

---

### 7. Amp (`amp`)
- **路径**：`~/.config/amp/skills/<skill-name>/SKILL.md`（支持 `~/.amp/skills` 别名）
- **规范来源**：Amp Code Announcement (ampcode.com/news/skills)

---

### 8. 通用广播渠道 (`broadcast`)
- **路径**：`~/.agents/skills/<skill-name>/SKILL.md`
- **定位**：跨 Agent 粗粒度共享通道。
- **治理原则**：由于写入后无法按单 Agent 独立撤回，SkillPot 坚持**不将广播列并入 `--for all`**，必须由用户显式执行 `--for broadcast` 进行授权。
