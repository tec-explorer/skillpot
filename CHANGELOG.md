# Changelog

所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [未发布]

### Added
- `docs/guide.md` 功能指南:TUI/GUI 全功能截图与分步说明(开关矩阵、详情、体检、收编、安装、市场、维护、TUI、MCP),README 挂载主视觉截图与指南入口

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
