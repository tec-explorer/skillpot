# TUI 执行报告（2026-09-03）

> 状态：**TUI 开关矩阵交付**（版本 0.3.0），M2 全部遗留项清零。上一份：[M2 报告](./2026-09-03-m2-execution.md)。

## 交付内容

`skillpot tui`（别名体验同 CLI）：skill × Agent 交互式开关矩阵。

- **交互**：↑↓←→ / hjkl 移动选中格，空格/回车切换开放状态，`a` 整行开关，`r` 从磁盘刷新，`q`/Esc 退出。
- **单元格五态语义**（不只画 expose 声明，而是对照磁盘实况）：
  - `✓` 已开放且受管 symlink 就位
  - `⚠` 漂移——config 声明开放但链接缺失（或已关闭但链接仍在）
  - `!` 链接状态异常
  - `×` 外部同名占用（用户自建目录挡位）
  - `·` 未开放
- **操作反馈**：切换直接调用 enable/disable 同步引擎，冲突原因（如"真实同名目录，拒绝覆盖"）实时显示在底部消息栏，与 CLI 行为完全一致。
- **降级**：无 TTY（管道/CI）或 `--once` 时输出同一矩阵的静态文本版，保证可脚本化。

## 构建架构切换（本次的主要工程量）

TUI 引入 ink 5（纯 ESM）+ React 18，原 tsc 直出 CJS 的构建方式无法兼容，切换为：

- **esbuild 打包**为单文件 ESM 产物 `dist/cli.mjs`（约 1.8MB，含 ink/react），`tsc` 退为纯类型检查（`typecheck` script）；
- CLI 对外接口不变，bin 指向 `dist/cli.mjs`。

过程中踩掉的四个坑（记录备查）：

1. ink 类型是 ESM exports 形式 → tsconfig `moduleResolution: bundler`；
2. yoga-layout 使用顶层 await → 产物必须 `--format=esm`（CJS 装不下）；
3. ink 的 `react-devtools-core`（仅 DEV 用）→ esbuild `--alias` 指向空壳 shim；
4. ESM 产物中 CJS 依赖的内置模块 `require` → banner 注入 `createRequire` 桥接，同时 shebang 必须由 banner 注入第一行（源码 hashbang 会被 esbuild 排在其后）。

## 验证

- 单元测试 **46/46**（新增 8 个：矩阵推导三态、toggle 开/关/冲突/未知、静态渲染）。
- 沙箱 e2e 新增 tui 段（`tui --once` 渲染表头/图例/✓）——**退出码 0**。
- 真实环境只读：`tui --once` 在 Node 18 下加载完整打包 ink 栈正常输出。

## 遗留

- [ ] 交互模式需真人在 TTY 下体验确认（快捷键手感、选中高亮），属于主观调优项
- [ ] OpenCode / Gemini CLI 实机 symlink 验证（仍待装机）
- [ ] M3：npm 发布、git 立仓 + CI、registry / 团队共享 / GUI
