# Changelog

所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.14.0] - 2026-09-10

Phase 3 落地：把“验证过”变成可传播的信任资产与定位换轨——从“管理器”全面升级为“面向编程 Agent 的 Skill 供应链安全与跨工具治理层”。

### Added
- **逐家验证证据矩阵（`docs/design/verification-matrix.md`）**：
  - 详尽收录 8 家 Agent + 1 渠道的规范依据、发现路径、验证等级与遮蔽规则。
  - 公开透明判定基准：实测（`live`）、文档确认（`docs`）、未验证（`unverified`），绝不虚标。
- **自动化实机探针测试工具（`scripts/verify-probe.sh`）**：
  - 支持 `bash scripts/verify-probe.sh <agent-id>` 一键生成探针、建立链接、执行体检与审计验证。
  - 实测确认 Google Antigravity / Gemini CLI（`gemini-cli`）渐进式加载 `SKILL.md` 有效，验证等级升为 `live`。
- **中英文 README 挂载「逐家验证证据表」**：
  - 中英文 README (`README.md` 与 `README.en.md`) 显著挂载验证总表与探针使用指引，构筑真实透明壁垒。
- **品牌与定位文案换轨**：
  - 升级为“面向编程 Agent 的 Skill 供应链安全与跨工具治理层”。
  - 更新 CLI `--help`、`package.json` 描述与关键词、文档指南。

## [0.13.0] - 2026-09-10

Phase 2 落地：把安全做成真本事——构建供应链安全与治理防线。

### Added
- **`lint` 扫描 SKILL.md 正文与生命周期钩子**：
  - 提示词注入检测（Prompt Injection：忽略前序系统指令、规则覆写、越狱/开发者模式诱导，命中即 `error` 阻断）
  - 隐藏 HTML 注释扫描（`<!-- ... -->` 内嵌注入指令或 curl/rm/eval/base64 等高危载荷，命中即 `error` 阻断；普通说明注释零误报）
  - Unicode 零宽字符混淆与双向控制符（Zero-Width Characters / BiDi Override 隐蔽载荷，命中即 `error` 阻断）
  - Base64 解码并执行载荷扫描（`base64 -d | sh`、`eval(atob(...))` 等，正文与脚本全覆盖）
  - 运行时远程拉取执行指令（`curl/wget | source`、`source <(curl ...)`、`eval $(curl ...)` 等）
  - 依赖生命周期钩子扫描（`package.json` 中的 `preinstall`/`postinstall` 恶意执行命令）
- **安装前默认安全阻断**：
  - `addSkill` 调整生命周期：在文件拷贝进中央仓库前先执行 lint 校验
  - 发现 `error` 级别问题时中止安装，中央仓库不留文件、config 不登记、不建符号链接
  - CLI `skillpot add` 与 GUI / 市场接口增加 `-f, --force` 选项支持显式强制放行
- **`audit` 全量物理目录审计**：
  - 覆盖各 Agent 物理目录中的全部子项，不再局限于中央仓库已登记项
  - 识别绕过 SkillPot 手动放进 Agent 目录的未受管外部条目并汇报
  - 对外部未受管条目执行安全审查，发现注入或恶意载荷直接升级为 `error` 报警
- **`audit --ci --fail-on <level>` 自动化门禁**：
  - 支持挂载到 CI/CD 流程作为安全卡点
  - `--ci` 或 `--fail-on error` 在存在 error 级安全发现时退出码为 1
  - `--fail-on warn` 在存在 warn 或 error 时均以退出码 1 退出
- **安全回归测试语料库（`tests/lint-security.test.ts`）**：
  - 覆盖注入、隐藏注释、零宽混淆、远程动态执行、恶意 package 钩子及合法头部 skill 零误报等 21 项自动化用例

## [0.12.0] - 2026-09-10


一轮"让产品说的话与做的事一致"的诚实性修复 + 通用广播列升为一等目标。

### Added
- **通用广播成为矩阵一等列**：跨工具共享目录 `~/.agents/skills` 由 opt-in 侧门（`broadcast` 命令）升为与各 Agent 列同级的 `broadcast` 目标，走同一套 enable/disable/symlink/台账语义；TUI/GUI 矩阵新增该列（GUI 浅黄底 + 「共享目录·粗粒度」标注），CLI 新增 `--for broadcast` 与 `list --agent broadcast`。`skillpot broadcast` 保留为命令糖
- **适配器验证等级 `verify`**（`live` / `docs` / `unverified`）：`agents` 输出、`agents --json` 与 GUI 矩阵表头如实展示，每级附人类可读依据。当前口径下 8 家 Agent 中仅 Claude Code 为实测
- `src/core/expose.ts`：矩阵/体检/审计/列表/MCP 共用的可见性判定 `isExposed()` / `exposedTargets()`，杜绝各处口径不一
- `src/util/fsx.ts`：原子写（临时文件 + fsync + rename）与进程间互斥锁（计数式可重入，陈旧锁可抢占）
- `tests/persistence.test.ts`：原子写、锁（含重入/超时/陈旧抢占）、配置损坏与 lockfile 更名的回归

### Changed
- **MCP 身份过滤真正生效**：`SKILLPOT_AGENT` 此前仅出现在文档与启动横幅里、代码从未读取；现在优先于 `tools/call` 的 `agent` 参数，参数无法放宽矩阵。`skillpot_read` / `skillpot_search` 一并受矩阵约束（此前只有 `list` 过滤，存在读取旁路）
- `--for all` 展开为**全部具体 Agent，不含通用广播**：广播写入后无法按 Agent 单独撤销，混入 `all` 会让矩阵"显示已关闭、实际可见"；`enable`/`disable`/`add`/`adopt`/`install-search` 的 `--for` 说明与调试提示同步更新
- TUI 整行开关（`a`）跳过通用广播列；GUI 对该列的「全开/全停」二次确认中明确影响面
- 配置文件改为原子写；`enable`/`disable`/`broadcast`/`uninstall`/`adopt`/`fixDoctor` 及 `add` 的登记段加互斥锁（锁只包裹本地文件临界区，不含 git 克隆）
- `config.yaml` 损坏改为明确报错（原会静默降级为空配置，导致矩阵凭空消失）；`state.json` 损坏移出为 `state.json.corrupt-<ts>` 留证并降级为空台账
- `resolveAgentIds` 去重；`list --agent` 不再重复解析参数；未知目标报错文案改为「未知目标」
- `adopt` 缺省扫描范围只含具体 Agent（不再把共享广播目录当"待收编来源"）
- lockfile 更名 `skillspot.lock.json` → `skillpot.lock.json`（对齐项目名），写入时清理旧名残留
- 文档同步：README（中/英）、功能指南（矩阵/MCP/命令速查/支持的目标）、适配器设计（目标类型、验证等级口径、当前适配器表）、MCP bridge 设计（过滤优先级与安全边界）、产品规划 §4 决策记录 + §10 待办批次

### Fixed
- `enable` 的逐目标循环此前无容错：一个目标写失败（EACCES/EPERM/EEXIST）会跳过末尾落盘，导致已成功目标的台账与 `expose` 一并丢失、随后被体检判为孤儿链接。现逐目标兜错并照常落盘
- `detect.ts` 对所有适配器硬编码 `strategy: 'symlink'`（copy 档适配器也会被谎报为 symlink），现由 `materialize` 决定
- 0.11 及更早由 `broadcast` 写入的广播链接只落台账、未登记 `expose`，会被误判为"已关闭但链接残留"，`doctor --fix` 会把用户的广播撤掉。现由 `isExposed()` 以台账回退兼容
- `sync --export` 导出的清单会丢掉通用广播列（现纳入）；README 支持列表补上 0.11.0 已接入却漏列的 Amp

## [0.11.1] - 2026-09-09

### Fixed
- 项目元数据修正：`package.json` 的 `bugs`/`homepage` 与 `CONTRIBUTING.md` 的克隆地址统一指向新组织 `tec-explorer/skillpot`

## [0.11.0] - 2026-09-04

### Added
- **主线 C——落地策略**:B 档 copy 机制(适配器 `materialize: 'copy'`,enable 即重新拷贝刷新副本;doctor/台账/矩阵全链路兼容 copy)与**广播模式** `skillpot broadcast <skill> [--off]`(跨工具共享目录 `~/.agents/skills/`,显式开关、台账化)
- **主线 D——skills.sh 目录集成**:`skillpot search <关键词>`(匿名 `/api/search`,带安装量,与官方 npx skills CLI 同源)与 `skillpot install-search <owner/repo/slug> [--for agents]`(克隆缓存解析子目录后安装)
- Agent 注册表扩至八家:新增 **Amp**(`~/.config/amp/skills/`,官方文档确认);Cursor 验证依据升级为官方文档;dsh verified 按调研结论如实降级
- 英文版 `README.en.md`(中英互链)

## [0.10.0] - 2026-09-04

### Added
- **GUI「团队」页签**：团队对齐可视化——填入清单路径即可**预览**（逐项标注本机安装状态/版本锁一致性/中央仓库缺失/local 仅本机有效），**对齐**一键执行（可**预演**不落地），**导出清单**从当前中央仓库生成；清单路径跨会话记忆
- 新增 `inspectManifest`（清单体检）与 `/api/team/inspect|sync|export` 三个路由
- 修复：清单体检对"config 有登记但中央仓库目录已删除"的损坏状态误报 ENOENT——现精确标注"中央仓库缺失（对齐将重装）"

## [0.9.0] - 2026-09-04

### Added
- **团队对齐（主线 B）**：项目级 `.skillpot.yaml` 清单 + `skillpot sync`——`sync --export` 从中央仓库导出清单（来源/版本锁/开放矩阵，`--skill` 精选，local 来源自动警告），成员 `sync` 一键对齐：安装缺失、按 checksum 锁重装内容漂移、应用开放矩阵；支持 `--dry-run` 预览
- 对齐语义可预期：带 `checksum` 即版本锁（本地实际内容偏离清单自动重装）；不带则只保证已安装、不主动更新；`expose` 只做增量开启，不主动关闭
- 对齐安装走与 `add` 相同流程（lint、来源登记、lockfile 刷新）

## [0.8.0] - 2026-09-04

### Added
- **`skillpot audit [--json]`**：审计每个 Agent 实际生效的 skill、来源与异常——外部同名占用（被绕过/遮蔽，error）、受管链接残留、声明开放但链接缺失（漂移）（产品计划 §9.4）
- **`update` / `--check` 携带文件级 diff**（新增/修改/删除），更新前即可看到将产生的变化（§9.2）；CLI 表格与 GUI 维护页均展示
- **lint 安全规则扩展**（§9.1）：SSH/云厂商凭据文件触碰、密钥类环境变量读取、curl POST/PUT 外发数据、向远端主机拷贝、清 shell 历史（反取证），附不误报的常规用例回归
- 产品计划 §10 更新为四条主线（安全纵深/团队对齐/覆盖验证/生态触达）并回填 M0-M2 完成状态

## [0.7.0] - 2026-09-04

### Added
- **市场**:内置源扩至四个——Anthropic 官方、Vercel 官方（`vercel-labs/agent-skills`）、Superpowers 社区技能集（`obra/superpowers`）、Matt Pocock 技能集（`mattpocock/skills`）；新增过滤框（名称/说明/子目录）与「加载更多」分页（默认 20 条）
- **开关矩阵**:每个 Agent 列头新增「全开/全停」整列批量启停（带确认，走新增的 `POST /api/bulk`）；skill 列表默认 20 条 + 「加载更多」分页，与搜索/状态筛选联动
- **收编 / 维护**页新增过滤框（名称/路径/来源），批量数据处理更顺手
- `docs/guide.md` 功能指南:TUI/GUI 全功能截图与分步说明,README 挂载主视觉截图与指南入口

### Changed
- README 对照 0.6.0 全面校准:命令表补 gui/market/source、Agent 表扩至七家、快速开始补市场、FAQ 重写(skills.sh 关系、全局/本地安装排查)、安全模型补控制台 token 说明、docs 索引收录功能指南与执行报告

## [0.6.0] - 2026-09-04

### Added
- **市场**：技能源浏览与一键安装。内置官方源 `anthropics/skills`（20 个 skill），支持添加/移除自定义 git 源（存于 `config.yaml sources:` 段，随 lockfile 团队共享）；克隆缓存在 `~/.skillpot/cache/market/`，「刷新」强制更新
- GUI 新「市场」Tab：源切换、skill 列表（名称/说明/子目录/已装标记）、一键安装（走 `addSkill` 全流程含 lint）；CLI 新增 `skillpot source list|add|remove` 与 `skillpot market [url]`
- 开关矩阵搜索框与状态筛选（全部/已开放/异常漂移），应对大规模 skill 列表

### Fixed
- Cursor 适配器路径修正为官方的 `~/.cursor/skills/`（0.5.1 误配为 `skills-cursor`；已按旧路径收编的条目不受影响）
- 市场克隆先落临时目录再原子改名：中途失败/被杀不会留下"半截缓存"被误当有效；git 克隆统一加 5 分钟超时（含 `add`/`update` 的 git 路径）

### Changed
- Agent 注册表七家：新增 **DeepSeek CLI**（`~/.dsh/skills`）与 **Cursor**（官方路径）；dsh 有用户 symlink 实用佐证、两者 symlink 发现任待实机确认

## [0.5.1] - 2026-09-04

### Added
- Agent 注册表扩至七家：新增 **DeepSeek CLI**（`~/.dsh/skills`）与 **Cursor**（`~/.cursor/skills-cursor`，后于 0.6.0 修正为官方路径）适配器

## [0.5.0] - 2026-09-04

### Added
- `skillpot gui` 本地 Web 控制台：零依赖 `node:http` server（默认仅监听 127.0.0.1，`--host` 可开放局域网并强制全请求 token）；写操作校验随机 token（防 CSRF/DNS rebinding）；自动打开浏览器，`--port`/`--no-open` 可配
- GUI 开关矩阵视图：skill × Agent 三态着色（开放/漂移/冲突/未开放），点击单元格切换，复用 TUI 的 `toggleCell` 语义；点击 skill 名打开详情弹层（描述、文件树、SKILL.md 预览、lint、卸载）
- GUI 体检视图：问题按 错误/警告 分级列表 + 一键「全部修复」（`fixDoctor`）
- GUI 收编视图：扫描各 Agent 可收编目录，勾选式收编（`adoptSkills` 新增 `only` 过滤）、move 模式、收编后开放
- GUI 安装视图：本地目录 / git URL（`#subdir`）表单，安装即 lint、可选开放给指定 Agent（新增 `core/add.ts`，CLI `add` 复用同一流程）
- GUI 维护视图：git 来源 skill 检查/应用更新，本地来源跳过
- SSE 变更广播（`/api/events`）：任一写操作成功后通知浏览器自动刷新，多标签页保持同步
- 前端为 Vite + React（`src/gui/`），构建产物 `dist/gui/` 随 npm 包发布；API 核心抽为纯函数 `handleApiRequest` 并配套单测

### Changed
- `installFromGit` / `updateSkills` 改为异步（execFile promise）：GUI 服务端执行 git 操作时不再阻塞事件循环
- `deriveMatrix(agents?)` 支持传入预计算的 Agent 检测结果：GUI 服务端缓存 60 秒，避免每次拉状态都逐个 spawn Agent 二进制做 `--version` 探测
- `uninstallSkill` 抽为 core 函数（`core/uninstall.ts`），CLI `remove` 复用

### Fixed
- `--version` 与 MCP `serverInfo.version` 此前硬编码 `0.4.0`，现改为运行时从 `package.json` 读取，与包版本单一来源同步（新增 `src/version.ts`；该修复已随 0.4.2 发布）

## [0.4.2] - 2026-09-04

- 版本号运行时读取修复（见 0.5.0 Fixed；随 0.4.2 首次发布）

## [0.4.1] - 2026-09-04

### Added
- npm 分发支持：`prepare` 钩子（`npm install` / GitHub 直装 / `npm pack` 时自动构建 `dist`）与 `prepublishOnly` 钩子（发布前强制构建 + 测试，失败中断）
- GitHub Actions 发布流水线：push `v*` 标签自动构建、测试并发布到 npm（带 provenance，需仓库配置 `NPM_TOKEN` secret）

### Changed
- npm 包名改为 `@tec-explorer/skillpot`（挂 tec-explorer 组织 scope），`publishConfig.access: public` 保证 scope 包默认公开发布；bin 命令名 `skillpot` / `spot` 不变
- `package.json` `repository.url` 修正为实际仓库地址 `tec-explorer/skillpot`
- npm 包内容补充 `CHANGELOG.md`
- README 安装说明补充 GitHub 直装 / npx / 源码三种方式

## [0.4.0] - 2026-09-03

### Added
- `adopt --move` 移动模式：内容拷入中央仓库后，把来源 Agent 目录下的原目录替换为 symlink（来源 Agent 自动开放）
- `init` 空仓库检测提醒：自动扫描各已安装 Agent 的已有 skill，TTY 下交互询问是否移入
- 对 `init`/`adopt` 等命令的收编来源标记（`adopt:<agent>:<path>`）

### Fixed
- commander 静默吞掉多余位置参数（连接符打错时 adopt 被忽略且无提示）→ 现在显式报错
- 表格按 ANSI 剥离后的可见宽度对齐（修复彩色单元格错位）
- **symlink 解引用**：拷贝/_checksum 此前不解引用符号链接，导致仓库出现外部链接与空内容哈希；现在仓库自包含只存真实内容

### Changed
- MCP `serverInfo.version` 与包版本同步维护

## [0.3.0] - 2026-09-03

### Added
- `skillpot tui` 交互式开关矩阵（skill × Agent）：方向键移动、空格切换、整行开关、`--once` 静态输出；无 TTY 自动降级

### Changed
- 构建从 tsc 直出 CJS 切换为 esbuild 单文件 ESM 打包（`dist/cli.mjs`，内联 ink/react）；tsc 退为纯类型检查

## [0.2.0] - 2026-09-03

### Added
- `adopt` 收编：把各 Agent 目录下已有 skill 拷入中央仓库（`--dry-run` 预览、`--for` 导入即开放）
- `lint` 安全扫描：frontmatter 完整性 + 脚本高危模式（`rm -rf`、`curl|sh` 等）；`add` 自动执行
- `update [--check]` + `skillspot.lock.json`：git 来源版本比对与原位替换
- `skillpot mcp`：零依赖 stdio MCP server（`skillpot_list/read/search`），遵循开关矩阵过滤
- enable/disable 输出"重启示例会话后生效"提示

## [0.1.0] - 2026-09-03

### Added
- M1 MVP：`init / agents / add / list / enable / disable / remove / doctor`
- 中央仓库 `~/.skillpot`（唯一真身 + config.yaml 开关矩阵 + state.json 链接台账）
- 五家 Agent 适配器：Claude Code / ZCode / Codex CLI / OpenCode / Gemini CLI（symlink 落地策略）
- symlink 跨 Agent 发现经 Claude Code 实测验证（M0）
