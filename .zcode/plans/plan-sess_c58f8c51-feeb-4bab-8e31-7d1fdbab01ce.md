# skillpot GUI 实现方案(G1:骨架 + 开关矩阵 + 体检)

## 架构总览

```
skillpot gui (CLI 命令)
  └─ src/core/gui-server.ts   node:http 零依赖,仅监听 127.0.0.1
       ├─ 静态服务 dist/gui/   (Vite 产物,随 npm 包发布)
       └─ /api/* JSON API     → 直接调用现有 core 函数(零重构)
  └─ 自动打开浏览器(带 token)

src/gui/  React 客户端(Vite 独立构建,不进 cli.mjs bundle)
```

探索结论:core 层(除 CLI/MCP 外)无 console/readline/process.exit 耦合,全部返回结构化数据——`deriveMatrix()`(tui/matrix.ts:30)就是 GUI 矩阵需要的 `{skill, agent, enabled/actual/managed}` 三态数据,`toggleCell()`(tui/cells.ts:35)带错误捕获,直接复用,语义与 TUI 完全一致。

## G1 交付内容

**1. 服务端(零依赖延续)**
- `src/core/gui-server.ts`:`startGuiServer({port?, open?})`,crypto 随机 token,POST 类操作校验 `x-skillpot-token` 头(防 DNS rebinding/CSRF);静态文件服务带 MIME 表 + SPA fallback,`new URL('./gui/', import.meta.url)` 定位产物(npm/git/dev 三种安装形态均兼容)
- 仿 MCP 的可测设计:核心逻辑抽为纯函数 `handleApiRequest(method, path, body, token) → {status, body}`,socket 层薄封装
- API(G1):`GET /api/state`(config skills + deriveMatrix + detectAll + VERSION)、`POST /api/toggle`(toggleCell)、`GET /api/doctor`(runDoctor)、`POST /api/doctor/fix`(fixDoctor)、`GET /api/lint`(lintSkill)
- `cli.ts`新增 `gui` 命令(`--port`、`--no-open`),复用 run() 错误出口

**2. 客户端(Vite + React,新增依赖:react-dom、vite、@vitejs/plugin-react)**
- `src/gui/main.tsx + App.tsx`:顶部 Tab(开关矩阵 / 体检,G2/G3 再扩展),普通 CSS(不引 Tailwind)
- 矩阵视图:skill × Agent 表格,单元格按 enabled/actual/managed 三态着色,图例说明;点击切换(乐观更新,失败回滚并提示,复用 toggleCell 的 ok/message)
- 体检视图:Issue 列表按 error/warn/info 分级徽标,`fix` 字段可操作的项显示"修复"按钮 + "全部修复"
- token 从 URL `?token=` 读入 sessionStorage,之后每次请求带 header

**3. 构建与打包**
- `package.json`:`build:gui` = `vite build`(outDir `dist/gui`);`build` 顺序调整为 typecheck → esbuild cli → vite(gui 放最后避免被 `rm -rf dist` 清掉);tsconfig 加 `lib: ["ES2022","DOM","DOM.Iterable"]`(客户端需要 DOM,服务端不受影响)
- `files` 不用改(dist/gui 自动随包);tarball 预计增 ~200KB

**4. 测试与文档**
- `tests/gui-server.test.ts`:handleApiRequest 单测(state/toggle/doctor/fix + token 拒绝),复用 `makeSandbox()` 环境隔离
- README 特性区 + 快速开始补 `skillpot gui`;CHANGELOG 未发布节;交付后按惯例写 `docs/reports/2026-09-04-gui-g1-execution.md`
- 验证:build + 全量测试 + 沙箱环境起服务 curl /api/state + 真机浏览器过一遍矩阵切换/体检修复

## 后续里程碑(本次不做)
- **G2 收编与安装**:adopt 扫描/勾选/move 模式视图、add 表单(本地路径/git URL、--for 预选)、lint 结果集成到安装流程
- **G3 维护视图**:update(check/apply)、skill 详情(SKILL.md 预览 + 文件树,抽 mcp-server 的读取逻辑共用)、remove
- **G4 打磨**:installFromGit/updateSkills 的 execFileSync 是同步阻塞,迁移 worker_threads;操作进度流(SSE);可选 `--host` 局域网访问

版本:G1 随 **0.5.0** 发布(minor 新特性)。

## 执行步骤
1. 安装 devDeps(vite、@vitejs/plugin-react)与 react-dom;tsconfig 加 DOM lib
2. 写 src/core/gui-server.ts(handleApiRequest + startGuiServer)+ cli.ts gui 命令
3. 搭 src/gui/ 客户端骨架(Vite 配置、Tab 框架、token 处理)
4. 实现矩阵视图与体检视图
5. build:gui 接入构建脚本,npm pack 验证产物
6. 单测 + 沙箱冒烟 + 真机验证
7. README/CHANGELOG/执行报告,提交(是否打 0.5.0 标签发布听你安排)