# SkillPot 功能指南

本文带你走一遍 SkillPot 的全部功能。所有截图来自演示环境(虚构的 skill 名)。

- 安装: `npm install -g @tec-explorer/skillpot`，或 Homebrew: `brew tap tec-explorer/tap && brew install skillpot` (短别名 `spot`，亦可 `npx @tec-explorer/skillpot` 免安装运行)
- 要求: Node ≥ 18
- 命令总览: `skillpot --help`

---

## 1. 初始化:一处收拢所有 skill

```bash
skillpot init
```

创建中央仓库 `~/.skillpot/`(唯一真身所在),自动检测本机安装的 Agent。仓库为空且检测到各 Agent 目录已有 skill 时,会交互式询问是否移入。

目录布局:

```
~/.skillpot/
├── skills/<name>/SKILL.md   # 中央仓库:唯一真身(自包含,symlink 已解引用)
├── config.yaml              # 来源/版本/校验和 + skill×目标 开关矩阵
├── state.json               # 链接台账(卸载只动台账内文件)
└── skillpot.lock.json       # 机器可读快照(团队共享/审计)
```

## 2. 开关矩阵:一个界面管所有 Agent

```bash
skillpot gui     # 浏览器控制台(推荐)
spot tui         # 终端交互版
```

### GUI 开关矩阵

矩阵的**行是 skill,列是目标**。目标分两类:**具体 Agent**(`claude-code`、`codex`…),以及最后一个**通用广播**列(跨工具共享目录 `~/.agents/skills`)。单元格五种状态:

| 符号 | 含义 |
|---|---|
| ✓(绿) | 已开放:目标目录里有指向中央仓库的受管 symlink |
| ⚠(黄) | 漂移:config 声明开放,但链接缺失(比如链接被手动删了) |
| !(黄/红) | 链接状态异常 |
| ×(红) | 外部同名占用:该位置有个不是 SkillPot 创建的同名条目,点击不生效 |
| ·(灰) | 未开放 |

![GUI 开关矩阵](images/gui-matrix.png)

- **点击单元格**即切换:开放 = 在该目标的目录创建指向中央仓库的 symlink;关闭 = 撤下。切换后台灯提示结果,**Agent 重启示例会话后生效**。
- **列头「全开 / 全停」**:对该目标下的全部 skill 一键启停(带确认),批量管理不用逐个点击。通用广播列额外提示影响面——它是粗粒度渠道,所有支持该约定的 Agent 都可见,且事后无法按 Agent 单独关闭。
- **通用广播列**(浅黄底、标注「共享目录·粗粒度」)写的是 `~/.agents/skills`:放进去的 skill 对所有支持该约定的 Agent(Vercel skills CLI 的 universal 位置、ZCode、Amp、Codex、OpenCode…)可见。它**不包含在 `--for all` 里**,只能在这里点开,或用 `skillpot enable <skill> --for broadcast`。
- 表头标注 `(未验证)` 的列,表示该 Agent 的链接发现路径只有文档依据、没有实机验证过,开放后可能静默不生效。悬停可看目录与验证等级;`skillpot agents` 会打印每个目标的等级与依据。
- 顶部**搜索框**按名称过滤;**分段筛选**可只看「已开放」或「异常/漂移」的 skill——skill 一多时快速定位。
- 列表默认每页 20 条,点**「加载更多」**追加;列头灰显 `(未检测到)` 表示本机没装该 Agent(仍可开放,但建议先安装)。
- 点击 **skill 名**打开详情。

### skill 详情

详情弹层展示描述、文件树、SKILL.md 原文与 lint 结论,并可**卸载**(撤下所有 Agent 链接 + 删除中央仓库内容,带确认)。

![skill 详情](images/gui-detail.png)

### 实时同步

任意写操作成功后,服务端通过 SSE 广播,所有打开的控制台标签页**自动刷新**——你在终端里用 CLI 做的收编/安装,GUI 会在下次数据变化后同步;多标签页之间保持一致。

### 安全模型

服务只监听 `127.0.0.1`;启动时生成随机 token,所有**写操作**必须携带(token 经首次访问地址 `?token=` 自动收进会话)。需要局域网访问时用 `skillpot gui --host 0.0.0.0`,届时读取也强制认证。

## 3. 体检:三方一致性自动诊断

```bash
skillpot doctor        # 只报告
skillpot doctor --fix  # 自动修复
```

体检覆盖:config 与中央仓库不一致、断链、台账漂移、孤儿链接、expose 漂移。GUI 中问题按 **错误/警告** 分级展示,可自动修复的项提供**一键「全部修复」**(等价 `--fix`:清理失效台账 + 重同步 symlink;需人工决策的项只提示不动手)。

![体检](images/gui-doctor.png)

上例:手工删掉了 `release-notes` 在 Claude Code 的链接,体检给出断链(错误)与漂移(警告)各一条,点「全部修复」即恢复一致。

## 4. 收编:把散落各处的 skill 移进中央仓库

```bash
skillpot adopt --dry-run   # 预览
skillpot adopt             # 拷贝收编,原目录保留
skillpot adopt --move      # 移动模式:原目录替换为 symlink
```

GUI「收编」Tab 自动扫描各已检测 Agent 目录下的真实 skill 目录(symlink 会跳过),**勾选式收编**,支持按名称/路径过滤、移动模式与"收编后开放给来源 Agent":

![收编](images/gui-adopt.png)

移动模式最适合"同一个 skill 在多个 Agent 目录各有一份"的场景:内容拷入中央仓库后,原目录替换为 symlink——所有 Agent 共用一份真身,后续更新一处完成。

## 5. 安装:本地目录或 git 仓库

```bash
skillpot add ~/demo/my-skill
skillpot add https://github.com/owner/skills.git#skills/pdf   # # 后定位仓库内子目录
```

GUI「安装」Tab 同样支持两种来源,并可勾选安装后立即对哪些 Agent 开放。安装即执行 **lint 安全扫描**(frontmatter 完整性 + 脚本高危模式如 `rm -rf`、`curl | sh`),结果直接展示:

![安装](images/gui-add.png)

## 6. 市场:从技能源浏览与一键安装

```bash
skillpot source list                 # 列出技能源
skillpot source add <url> [名称]      # 添加自定义源(git 仓库)
skillpot source remove <url>
skillpot market [url] [--refresh]    # 命令行浏览源内 skill
```

GUI「市场」Tab 内置四个技能源——**Anthropic 官方技能库**、**Vercel 官方技能集**、**Superpowers 社区技能集**、**Matt Pocock 技能集**——并可添加任意自定义 git 源。选中源后列出其中全部 skill(名称/说明/仓库内子目录/已装标记),顶部**搜索框**过滤,默认展示 20 条、**「加载更多」**追加,**一键安装**——安装走与「安装」Tab 相同的流程(lint、默认不开放),之后去矩阵打勾开放。

![市场](images/gui-market.png)

说明:

- 源仓库克隆缓存在 `~/.skillpot/cache/market/`,「刷新」按钮强制更新;
- 官方源中 `docx` / `pdf` / `pptx` / `xlsx` 四个文档技能为 source-available 许可(非开源),使用前请阅原仓库说明;
- 从 skills.sh 等目录站看到的 skill,只要它托管在 GitHub 上,同样可以用「安装」Tab 的 `owner/repo#子目录` 方式安装。

## 7. 更新与卸载:一处更新,安全下架

```bash
skillpot update            # 拉取 git 来源 skill 的最新内容,原位替换
skillpot update --check    # 只检查不应用
skillpot remove <skill>    # 撤下所有 Agent 链接 + 删除中央仓库内容
```

GUI「维护」Tab 汇总所有 skill 的来源:git 来源可**检查/应用更新**(symlink 指向不变,无需重连 Agent);点击 skill 名可查看详情并卸载。本地来源会明确标注跳过。

![维护](images/gui-update.png)

## 8. TUI:终端里的开关矩阵

```bash
spot tui
```

↑↓←→ 移动光标,空格切换开关,`a` 整行切换,`q` 退出;非 TTY 环境用 `spot tui --once` 输出静态矩阵(适合脚本/CI)。

![TUI 矩阵](images/tui-matrix.png)

## 9. MCP bridge:让 Agent 直接读中央仓库

```bash
skillpot mcp
```

零依赖 stdio MCP server,提供 `skillpot_list` / `skillpot_read` / `skillpot_search` 三个工具,遵循开关矩阵过滤。任何支持 MCP 的 Agent 都能把 SkillPot 当作技能后端。

**推荐在 Agent 的 MCP 配置里声明身份**,而不是靠调用时传参:

```jsonc
{ "command": "skillpot", "args": ["mcp"], "env": { "SKILLPOT_AGENT": "codex" } }
```

- 声明了 `SKILLPOT_AGENT`,服务端就**以它为准**,`tools/call` 里的 `agent` 参数会被忽略——否则消费方可以自称任意 Agent 绕过矩阵;未声明时才退回用参数(兼容人工调试),启动横幅会提示这一点。
- 三个工具都受矩阵约束:`read` 只读**对当前身份开放**的 skill(未开放直接拒绝),`search` 只在可见范围内搜。
- 通用广播列不会自动让每个 Agent 可见:MCP 这里按 `skill × agent` 单元格判定。

## 10. 团队协作：项目清单一键对齐

CLI 三条命令之外，GUI「团队」页签提供同样的能力：填入项目里 `.skillpot.yaml` 的路径，**预览清单**逐项标注本机状态（未安装 / 与版本锁一致 / 内容偏离 / 中央仓库缺失 / local 仅本机有效），**对齐**一键执行（可先**预演**不落地），**导出清单**则从当前中央仓库生成。对齐完成与 local 来源警告均有提示：

![团队对齐](images/gui-team.png)

在项目仓库提交 `.skillpot.yaml`，声明项目需要哪些 skill，成员一条命令对齐：

```bash
skillpot sync --export      # 队长：从中央仓库导出清单（--skill a,b 可精选）
skillpot sync               # 成员：安装缺失、对齐版本锁、应用开放矩阵
skillpot sync --dry-run     # 先预览将对齐的动作
```

- 清单带 `checksum` 即版本锁：本机内容偏离清单自动重装；不带只保证已装
- `local:` 来源无法跨机器对齐（导出时警告）；建议团队 skill 一律走 git 源
- 对齐安装同样经过 lint 与来源登记

## 11. 策略治理与私有 Registry（GUI「策略」页）

在 Web 控制台切换到**「策略」**标签页：

1. **策略总览仪表盘**：
   - 查看当前生效的 `skillpot.policy.yaml` 路径与模式（严格阻断 `strict` / 仅审计告警 `audit`）。
   - 查看合规审查状态（是否满足基线、是否存在错误违规与告警违规）。
   - 查看私有 Registry 连接状态、Bearer Token 注入与是否开启 `force_private` 私有锁定模式。
2. **合规审查与一键修复**：
   - 结构化列出所有违规项（黑名单禁用项、非白名单来源、强制基线缺失或偏离、被禁渠道违规暴露）。
   - **「⚡ 一键自动修复」**：自动卸载黑名单技能、收回禁用渠道暴露并安装强制基线技能。
   - **「预演修复 (Dry Run)」**：预览修复动作而不改变实际环境。
3. **策略规则拓扑可视化**：
   - 规则卡片网格直观展示来源白名单、强制开启基线、禁用黑名单及渠道权限。
4. **在线 YAML 查看与编辑**：
   - 内置轻量 YAML 编辑器，支持即时修改策略源码、格式校验并自动重新验证。

## 12. 生态扩圈与 CI/CD 自动化门禁

### 12.1 官方 GitHub Action（CI 安全与策略门禁）

在持续集成流水线中，通过官方 GitHub Action 为代码仓库设立**供应链安全与合规门禁**：

```yaml
- name: Run SkillPot Security Gate
  uses: tec-explorer/skillpot@main
  with:
    args: 'audit --ci --fail-on error'
```

- **安全防御**：`audit --ci --fail-on error` 扫描物理目录与修改的 Skill 正文，发现高危提示词注入、隐藏载荷或恶意脚本直接返回非零状态码阻断 PR 合并。
- **策略合规**：配合企业策略文件执行 `policy check --ci`，严禁私自引入非白名单源或漏装强制基线。
- **私有凭据**：支持传入 `SKILLPOT_REGISTRY_TOKEN` 环境变量打通内部私有 Registry。
- 详见 [docs/ecosystem/github-action.md](ecosystem/github-action.md)。

### 12.2 Homebrew 原生分发

针对 macOS 与 Linux 开发者，提供官方 Homebrew Tap 支持：

```bash
brew tap tec-explorer/tap
brew install skillpot
```

安装后开箱立得 `skillpot` 与短别名 `spot` 命令，后续通过 `brew upgrade skillpot` 保持最新。详见 [docs/ecosystem/homebrew.md](ecosystem/homebrew.md)。

### 12.3 终端自更新检测

CLI 内置非阻塞版本更新提示器（`src/util/update-notifier.ts`）：
- 命令正常执行完成后，异步检测 npm 官方源是否存在新版本并友善打印更新提示。
- 内置 24 小时本地缓存防抖，避免高频网络请求干扰。
- 在 CI 环境、管道非 TTY 环境或 `--json` 格式化输出时自动静默，零侵入性。

## 13. 命令速查

| 命令 | 说明 |
|---|---|
| `skillpot init` | 初始化中央仓库 + Agent 检测 |
| `skillpot agents [--json]` | 检测本机 Agent、skills 目录与各目标验证等级 |
| `skillpot add <source> [-f]` | 安装(本地目录 / git URL#subdir)，安装前安全扫描，`-f` 强制放行 |
| `skillpot list [--agent id\|broadcast]` | 列出仓库 skill 与开放状态 |
| `skillpot enable/disable <skill> --for <targets>` | 开关(targets 支持逗号分隔、`broadcast` 或 `all`;`all` 不含通用广播) |
| `skillpot broadcast <skill> [--off]` | 通用广播列的命令糖(= `enable --for broadcast`) |
| `skillpot remove <skill>` | 卸载(撤下所有链接 + 删除中央仓库内容) |
| `skillpot adopt [--move] [--dry-run]` | 收编既有 skill，`--move` 替换原目录为受管 symlink |
| `skillpot lint [skill] [--strict]` | 深度安全/质量扫描(提示词注入、隐藏注释、Unicode 混淆) |
| `skillpot update [skill] [--check]` | git 来源原位更新与变更 diff 对比 |
| `skillpot doctor [--fix]` | 体检(断链/漂移/同名遮蔽/孤儿链接)与自动修复 |
| `skillpot audit [--json] [--ci] [--fail-on <lvl>]` | 全量审计各目标物理 skill、来源、未受管条目与 CI 阻断门禁 |
| `skillpot policy check/apply/init [--ci]` | 企业策略治理：审查合规基线、一键自动修复与模板初始化 |
| `skillpot registry` | 查看私有/公共 Registry 终端连接、Token 注入与私有锁定状态 |
| `skillpot gui [--port] [--host] [--no-open]` | Web 浏览器控制台(矩阵/体检/收编/安装/市场/维护/策略) |
| `skillpot tui [--once]` | 终端交互式开关矩阵；无 TTY 自动降级输出 |
| `skillpot mcp` | 以 MCP server (stdio) 运行，受 `SKILLPOT_AGENT` 身份约束 |
| `skillpot source list/add/remove` | 市场源管理(内置官方源 + 自定义 git 仓库源) |
| `skillpot market [url] [--refresh]` | 命令行浏览源内 skill 并一键安装 |
| `skillpot search <关键词>` / `install-search <id>` | 搜索并安装 skills.sh 目录中的 skill |
| `skillpot sync [--file] [--export] [--dry-run]` | 团队对齐：按项目清单 `.skillpot.yaml` 安装/导出/对齐 |

## 14. 支持的目标

**八家 Agent**——Claude Code、ZCode、Codex CLI、OpenCode、Gemini CLI、DeepSeek CLI(dsh)、Cursor、Amp,加上**通用广播渠道**(`~/.agents/skills`)。适配器 = "用户级 skills 发现路径" + 二进制/目录指纹检测。

每个目标都带**验证等级**,如实标注发现路径的确认程度:

| 等级 | 含义 | 当前 |
|---|---|---|
| 实测 | 真机确认过该 Agent 能发现 SkillPot 建立的链接 | Claude Code、Gemini CLI / Antigravity |
| 文档确认 | 路径有官方依据,链接发现未实测 | ZCode、Codex CLI、OpenCode、Cursor、Amp、通用广播 |
| 未验证 | 路径本身仍待确认 | DeepSeek CLI (dsh) |

`skillpot agents` 会逐个打印等级与依据。开放后 skill 静默不生效是最伤用户的失败模式,所以这里宁可低报——实机验证证据全景与自动化测试探针（`scripts/verify-probe.sh`）见 [docs/design/verification-matrix.md](design/verification-matrix.md)。实机验证过请提 PR 把它升为「实测」。

新增 Agent:只要它扫描某个用户级目录下的 `SKILL.md` 目录,就能以约十行适配器接入(欢迎 PR),步骤见 [docs/design/agent-adapters.md](design/agent-adapters.md)。

---

更多设计细节见 [README](../README.md) 与 [docs/](.) 下的设计文档。
