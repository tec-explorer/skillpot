# Changelog

所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.20.0] - 2026-09-11

跨 Agent 技能适用性治理与 Web 控制台现代交互体验升级：轻量启发式 Token 估算、运行环境与依赖探测、渠道防泛洪评估、以及 Web GUI 全矩阵视觉与排版重构。

### Added
- **Skill 与 Agent 适配度分析引擎 (Advisor Engine) (`src/core/advisor.ts`, `src/util/token-estimator.ts`)**：
  - **启发式 Token 快速估算**：支持中英文与代码混合文本加权估算，提供 light (<500 tokens)、moderate (500~2.5k tokens) 与 heavy (>2.5k tokens) 体量分级。
  - **环境与运行时依赖安全探测**：自动识别 `scripts/`（Python/Bash/Node 等）执行环境依赖，以及正文与 frontmatter 声明的外部 CLI 命令（Docker, K8s, Helm 等），采用无子进程的安全 PATH 探针。
  - **渠道与 Agent 规则体系**：对通用广播渠道 (`broadcast`) 引入重型技能降级与专有技能警示；对未安装或未验证的 Agent 提供适配度打分惩罚与提醒。
  - **四级建议与量化分级**：综合输出 🟢 推荐启用 (recommended)、⚪ 按需启用 (neutral)、🟡 需留意 (caution)、🔴 缺依赖/不推荐 (incompatible)，并给出 0~100 量化得分、一句话诊断结论、Token 开销与优劣势理由。
  - 新增测试套件 `tests/advisor.test.ts`。

### Changed
- **Web GUI 矩阵全方位现代美学与排版重构 (`src/gui/style.css`, `src/gui/views/MatrixView.tsx`, `src/gui/views/DetailModal.tsx`)**：
  - **页面与列宽重构**：主容器自适应拓宽至 1240px，Agent 列收敛为 86px 紧凑等宽居中列，Skill 列充裕展示且强制禁止连字符断词折行。
  - **纯净代码质感排版**：彻底剔除密集的虚线下划线，采用标准 monospace 代码字形与优雅的悬停微交互。
  - **吸顶固定与微徽章表头**：长列表滚动时表头与技能列双向 Sticky 吸顶；表头状态使用微胶囊 Badge，全开/全停重构为紧凑双联药丸按钮组。
  - **整行导轨与微型 Switch Token**：新增整行高亮导轨 (`tr:hover`)；已开启采用浅绿微胶囊 Badge，未开启平时为淡灰小点、悬停时浮现淡蓝 `+` 开启暗示。
  - **实时悬停 Tooltip 与角标**：单元格右上角挂载适配指示点，鼠标悬停毫秒级浮出深色卡片呈现 Token、依赖就绪情况与优缺点诊断。
  - **详情弹窗 Agent 适配报告**：点击技能详情即可查看所有受管 Agent 的完整适配体检卡片。

## [0.19.1] - 2026-09-11

### Fixed
- **CI / 无头干净运行环境 Agent 检测缓存修复 (`src/agents/detect.ts`, `src/core/adopt.ts`, `src/cli.ts`)**：
  - 解决未预装 Agent 客户端二进制的机器上，`init` 生成包含 `installed: false` 的 5 分钟本地缓存导致随后的 `adopt` 漏检新建 skills 目录并引发 CI 失败的问题；
  - `adoptUnlocked()` 与 `suggestAdopt()` 强制调用 `detectAll({ refresh: true })` 实时探测，并补充扫描磁盘物理存在的 `skillsDir`；
  - `skillpot init` 新增 `clearDetectCache()` 保证干净初始化；
  - `detectAgent()` 增强：当 Agent 的 `skillsDir` 实际存在时直接认定安装并注入目录指纹信号。

## [0.19.0] - 2026-09-11

平台能力、团队协同与多源安全治理全面升级：远程策略中心、离线技能内联打包、GUI 提示词深度抽屉、局部安全抑制与跨进程防竞态锁固。

### Added
- **企业 Remote Policy 远程 URL 与离线容灾缓存 (`src/core/policy.ts`)**：
  - 新增 `resolvePolicy()`，支持从企业内网/公网 HTTP/HTTPS 远程拉取治理策略并原子缓存至 `~/.skillpot/cache/policy/<url-hash>.yaml`。
  - **离线平滑降级**：当内网抖动、网络异常或服务不可达时，自动平滑回退使用本地磁盘缓存（标记 `fromCache: true` 并给出黄色预警），确保 CI/CD 流程与日常开发不受网络故障阻断。
  - `skillpot policy check` 与 `skillpot policy apply` 新增 `-u, --url <url>` 与 `--refresh`（强制穿透缓存）参数；支持环境变量 `SKILLPOT_POLICY_URL`。
  - 新增测试套件 `tests/remote-policy.test.ts`。
- **团队 Manifest 本地技能内联打包 (`src/core/team-sync.ts`)**：
  - `ProjectSkillEntry` 结构扩充 `bundle: { files: Record<string, string> }` 规范。
  - 导出命令扩充 `skillpot sync --export --bundle-local`：递归打包纯本地技能的提示词正文、子目录脚本与二进制资源（Base64 data-uri），在 Git PR 中可直接 diff 审查提示词演进，消除 local 跨机器同步壁垒。
  - `skillpot sync` 自动从清单内嵌 bundle 还原目录结构并挂载 Agent 矩阵；本地手改发生校验和偏离时自动覆盖修复对齐。
  - 新增测试套件 `tests/team-bundle.test.ts`。
- **Web GUI 市场技能详情抽屉与 Prompt 深度预览 (`src/core/gui-server.ts`, `src/gui/views/MarketView.tsx`)**：
  - 后端提供 `GET /api/market/preview?url=...&subdir=...`，返回完整 frontmatter 元数据、文件树、`SKILL.md` 全文与静态安全扫描结果。
  - 前端新增 `MarketPreviewModal.tsx` 详情抽屉，支持点击技能名或「详情」按钮一键打开；提供安全扫描风险徽章、文件树列表、`SKILL.md` 指令行数与代码高亮，支持在抽屉内一键安装到中央仓库。
- **Git 来源 Tag/Branch/Commit 版本锁定与浅克隆 (`src/core/add.ts`, `src/core/update.ts`)**：
  - 支持 `repo.git@v1.0.0#subdir`、`repo#subdir@v1.0.0` 等丰富 URL 语法。
  - `skillpot add` 新增 `-r, --ref <ref>` 参数；采用 `git clone --depth 1 -b <ref>` 极速浅克隆并兼容 commit hash。
  - 新增测试套件 `tests/git-ref.test.ts`。
- **B 档 Copy 落地模式数据安全防护与一键刷新 (`src/core/sync.ts`)**：
  - 引入 `hasDirectoryDrift` 检测；在 `disable` 与 `enable` 覆盖时，若检测到副本被开发者修改，自动备份至 `${target}.backup.<timestamp>-<rand>`，杜绝抹除调试代码。
  - `skillpot sync` 新增 `--refresh-copies` 参数，一键比对并刷新所有落地的 copy 副本。
  - 新增测试套件 `tests/copy-safety.test.ts`。
- **`adopt` 存量收编同名冲突智能重命名 (`src/core/adopt.ts`)**：
  - `skillpot adopt` 新增 `--on-conflict <skip|rename>` 参数；同名冲突时自动更名为 `${name}-${agentId}` 收编进中央仓库，零资产丢失。
  - 新增测试套件 `tests/adopt-conflict.test.ts`。

### Changed
- **Lint 局部规则抑制与代码块智能降噪 (`src/core/lint.ts`)**：
  - 规范并稳定了所有安全规则 ID（如 `script/dangerous-command`、`security/remote-fetch-exec` 等）。
  - 支持 `<!-- skillpot-ignore [rules] -->`（文件级）与 `<!-- skillpot-disable-next-line [rules] -->`（单行级）注解抑制机制。
  - 智能区分 Markdown 正文与示例代码块（Fenced Code Blocks）；说明文档中的 `curl | bash` 示例从强阻断降级为非阻塞 `warn` 告警，消除开发者“安全疲劳”。
  - 新增测试套件 `tests/lint-suppression.test.ts`。
- **配置与台账跨进程互斥锁硬化 (`src/core/config.ts`, `src/core/market.ts`)**：
  - 底层 `saveConfig`、`saveState` 以及市场源读写统一包裹进可重入文件互斥锁 `withLockSync`，彻底隔绝 CLI 与长开 Web GUI 之间的并发写竞争。

## [0.18.0] - 2026-09-11

工程微调与跨平台韧性：Agent 检测本地文件缓存与 Windows 符号链接平滑降级。

### Added
- **Agent 检测本地文件缓存 (`src/agents/detect.ts`)**：
  - 引入轻量文件级检测缓存（`~/.skillpot/.agents-cache.json`），默认 TTL 为 5 分钟（300,000 ms）。
  - 解决 CLI/TUI 高频冷启动时遍历 PATH 与反复 spawn `--version` 的子进程创建开销，显著提速命令行执行。
  - `skillpot agents` 命令新增 `--refresh` 选项（强制忽略缓存重新探测实机环境）。
  - 新增测试套件 `tests/detect-cache.test.ts`。
- **Windows 符号链接 `EPERM` 自动平滑降级 (`src/core/sync.ts`)**：
  - 智能捕获符号链接创建失败时的 `EPERM` / `EACCES` 异常。
  - 针对 Windows 未开启开发者模式或非管理员环境，自动平滑降级为现成的 B 档拷贝模式（`copy`）落地并闭环记入台账。
  - 同步修正 `addLedger` 更新台账条目 `kind` 状态的机制。
  - 新增测试套件 `tests/windows-fallback.test.ts`。

## [0.17.1] - 2026-09-11

文档体系全面优化与纠错：策略 YAML 规范对齐、逐家验证矩阵表格纠偏、顶层架构全景图与规范手册。

### Fixed
- **策略 YAML 规范与示例对齐**：
  - 修正 `README.md`、`README.en.md` 与 `docs/design/enterprise-policy.md` 中的策略 YAML 示例（`version: 1`、`registry.url`、`enforce[].for`、`deny[].name`、`targets` 结构），避免用户复制配置后无法解析。
- **验证等级表格事实订正**：
  - 订正 `docs/guide.md` 与 `docs/design/agent-adapters.md` 表格：Gemini CLI 确认实测（`live`），OpenCode/Cursor/Amp 确认为文档确认（`docs`），消除早期与实际验证脱节的陈旧表述。
- **生态与 Homebrew 示例版本同步**：
  - 更新 `docs/ecosystem/github-action.md` 与 `docs/ecosystem/homebrew.md` 版本号与示例引用。

### Added
- **顶层系统架构与数据流全景图**：
  - 在中英文 README 增加系统顶层 Mermaid 架构图（上游来源 → 安全防线 → 策略引擎 → 中央仓库真身 → 多 Agent 落地暴露 → 全量审计与 CI 门禁 → 多端交互界面）。
- **企业策略规范速查手册与违规代码字典**：
  - 在 `docs/design/enterprise-policy.md` 增设完整字段级 Schema 规范表、违规代码字典（`enforce_missing`, `denied_installed` 等）及 CLI 退出码规范。
- **用户指南生态与 CI 扩圈章节**：
  - `docs/guide.md` 新增第 12 节详解 GitHub Action、Homebrew 安装及终端自更新检测器，更新安装指引与命令速查表。
- **文档中心索引补全**：
  - `docs/README.md` 补全 `docs/design/verification-matrix.md` 目录索引；`docs/product/product-plan.md` 补齐近期里程碑交付链接。

## [0.17.0] - 2026-09-10

生态与 CI 扩圈：官方 GitHub Action、Homebrew 分发、CLI 自更新检查与海外社区资产。

### Added
- **官方 GitHub Action (`action.yml`)**：
  - 复合 Action，支持在 CI 中以 `audit --ci --fail-on error` 或 `policy check --ci` 阻断恶意注入与合规偏离。
  - 在 `.github/workflows/ci.yml` 中完成 Dogfooding 自闭环校验。
  - 编写使用指南 `docs/ecosystem/github-action.md`。
- **Homebrew Tap 分发支持**：
  - 提供符合官方规范的 `Formula/skillpot.rb` 模板。
  - 自动化脚本 `scripts/generate-brew-formula.sh` 实时打包并计算发布物 SHA256。
  - 维护指南 `docs/ecosystem/homebrew.md` 支持 `brew tap tec-explorer/tap && brew install skillpot`。
- **CLI 自身版本更新提醒 (`src/util/update-notifier.ts`)**：
  - 异步非阻塞比对 npm registry 最新版本，带 800ms 严格超时与异常静默兜底。
  - 本地 24 小时缓存防抖（`~/.skillpot/.update-check.json`）。
  - 在 CI 环境、非 TTY 管道与 `--json` 模式下自动静默。
  - 新增自动化测试套件 `tests/update-notifier.test.ts`。
- **海外社区传播资产 (`docs/ecosystem/community-launch.md`)**：
  - 全套 Hacker News (Show HN)、Reddit、X (Twitter)、Discord 发布草案与 GitHub Topics 设置命令。

## [0.16.0] - 2026-09-10

Web GUI 策略治理与私有 Registry 面板：将组织级安全基线与私有分发接入图形控制台。

### Added
- **Web 控制台全新「策略」标签页**：
  - **策略与合规仪表盘**：可视化展示 `skillpot.policy.yaml` 状态、运行模式（`strict` / `audit`）、未配置时的引导初始化以及合规/违规状态总览（包含阻断与告警计数）。
  - **私有 Registry 状态卡片**：直观呈现私有/公共 Registry 终端 URL、Token 注入状态及 `force_private` 私有锁定标志。
- **合规审查与一键修复**：
  - 结构化表格展现违规规则、涉事技能/渠道与修复建议。
  - 支持 **「⚡ 一键自动修复」** 与 **「预演修复 (Dry Run)」**，自动执行黑名单清理、禁用渠道收回与强制基线补齐。
  - 弹窗展示操作结果，并通过 SSE 实时联动全应用状态更新。
- **策略规则拓扑可视化看板**：
  - 卡片网格分类展现来源白名单、强制开启基线、禁用黑名单及目标渠道访问规则。
- **在线 YAML 查看与编辑器**：
  - 提供轻量暗色代码编辑区，支持在线修改策略源码，带格式与结构校验。
- **服务端 Policy API 路由**：
  - 新增 `/api/policy/status`、`/api/policy/init`、`/api/policy/check`、`/api/policy/apply`、`/api/policy/save` 及 `/api/registry/status` 端点。
- **自动化测试套件**：
  - 新增 `tests/gui-policy.test.ts` 覆盖 API 路由与安全权限校验。

## [0.15.0] - 2026-09-10

Phase 4 落地：企业级策略治理与私有 Registry 对接——将管理层推向组织级 Policy-as-Code 与资产闭环。

### Added
- **企业策略引擎（`skillpot.policy.yaml`）**：
  - 支持 `mode: strict`（默认阻断）与 `mode: audit`（告警审查）双运行模式。
  - **合规基线强制开启（`enforce`）**：组织级强制安装指定的必要技能，支持锁定内容哈希校验（防篡改）并自动开放至目标 Agent（`targets: ["all"]` 或具体 Agent 列表）。
  - **高危技能全组织禁用（`deny`）**：支持通配符模式（如 `*crypto*`、`malicious-*`）与特定投毒版本哈希黑名单阻断。
  - **来源白名单管控（`allowed_sources`）**：限制只允许从企业内部 Git 源、私有 Registry 或本地路径安装技能。
  - **渠道与目标治理（`targets`）**：支持禁用 `broadcast` 全局广播暴露，或限定只允许向受管 Agent 开放。
- **策略 CLI 工具集（`skillpot policy`）**：
  - `skillpot policy init`：一键生成企业策略标准模板。
  - `skillpot policy check [--ci]`：审查当前仓库合规性，违规自动抛出非零退出码。
  - `skillpot policy apply [--dry-run]`：自动修复并对齐组织基线（卸载黑名单技能、收回禁用渠道、自动安装并开放 enforce 技能）。
- **运行时拦截防线**：
  - `skillpot add`：在安装前校验来源白名单与 deny 黑名单，严防违规技能落盘。
  - `skillpot enable`：在开放前校验目标渠道限制与 deny 黑名单，杜绝违规暴露。
  - `skillpot audit`：全量审计联动策略违规报告，整合至 Agent findings 与 `--ci` 门禁。
- **私有 Registry 适配与鉴权**：
  - 兼容 JFrog Artifactory Agent Skills Registry 与 Vercel `SKILLS_API_URL` 规范。
  - 自动注入 `Authorization: Bearer <TOKEN>` 认证头。
  - 支持 `force_private: true` 私有锁定模式，阻断非授权公共源查询。
  - 新增 `skillpot registry` 状态查看命令。
- **架构设计文档**：
  - 新增 `docs/design/enterprise-policy.md`。
- **自动化测试套件**：
  - 新增 `tests/policy.test.ts`（15 项）与 `tests/private-registry.test.ts`（7 项），端到端 E2E 沙箱全面覆盖策略与私有 Registry 流程。

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
