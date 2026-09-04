# GUI G1 执行报告(骨架 + 开关矩阵 + 体检)

日期:2026-09-04 · 状态:已完成并浏览器验收通过

## 目标

为 skillpot 增加图形界面。经方案评审确定:**本地 Web GUI**(新增 `skillpot gui` 命令,浏览器访问)+ **里程碑式交付**(G1 骨架 → G2 收编/安装 → G3 维护视图 → G4 打磨)。本报告覆盖 G1。

## 决策与理由

- **形态选本地 Web 而非 Electron/Tauri**:core 层(除 CLI/MCP 外)本就是无 I/O 耦合的纯函数库,HTTP server 可零重构直接调用;不引入新运行时,前端产物随 npm 包发布,与现有零依赖风格(手写 MCP server)一致。
- **安全模型**:仅监听 127.0.0.1;启动时生成随机 token,所有 POST 要求 `x-skillpot-token` 头匹配,防 CSRF/DNS rebinding 借道本机端口改动文件系统。token 通过 `?token=` 传入,前端收进 sessionStorage 后立即清理地址栏。
- **可测性**:仿 mcp-server 模式,API 核心抽为纯函数 `handleApiRequest(method, path, query, body, expectedToken, gotToken)`,socket 层薄封装。

## 交付清单

| 模块 | 内容 |
|---|---|
| `src/core/gui-server.ts` | `handleApiRequest` 纯函数路由(`GET /api/state`、`POST /api/toggle`、`GET /api/doctor`、`POST /api/doctor/fix`、`GET /api/lint`)+ `startGuiServer`(node:http、MIME 表、SPA fallback、防路径穿越、openBrowser) |
| `src/cli.ts` | 新增 `gui` 命令(`--port`、`--no-open`),非法端口显式报错 |
| `src/gui/` | Vite + React 客户端:`App`(Tab 框架/toast/状态加载)、`MatrixView`(skill×Agent 三态着色,点击切换)、`DoctorView`(分级列表+一键修复)、`api.ts`(token 引导+请求封装) |
| `src/tui/matrix.ts` | `deriveMatrix(agents?)` 支持预计算检测结果;GUI 服务端缓存 60s(detectAll 逐个 spawn `--version`,不宜每请求执行) |
| 构建打包 | `vite.config.ts`(root=src/gui,outDir=dist/gui);`build` = typecheck → esbuild → vite;新增 devDeps:vite、@vitejs/plugin-react、@types/react-dom;deps:+react-dom@18 |
| 测试 | `tests/gui-server.test.ts` 9 项:纯函数路由(state/toggle/doctor fix/404/403/400/lint)+ HTTP 集成(静态页、无 token 403、带 token toggle) |

## 验证

- `npm run build` 0 错误;全量测试 9 文件 59 用例全过;`npm pack` 确认 `dist/gui/` 随包
- 沙箱冒烟(隔离 SKILLPOT_HOME):静态页 200;`/api/state` 返回矩阵;无 token POST → 403;带 token toggle → ok 且落盘
- 浏览器实测(In-app Browser + 截图):矩阵三态着色与图例正确;点击 ZCode 单元格 → 绿 ✓ 变灰 ·、toast 提示;人工制造断链后体检列出 错误+警告,「全部修复」后回到「未发现问题」;token 从地址栏清除

## 已知边界与后续

- `installFromGit`/`updateSkills` 为同步执行(execFileSync),G2/G3 接入时在 GUI 上表现为请求阻塞(单用户本地场景可接受),G4 计划迁 worker_threads
- Playwright 高层定位器在本页 td 上点击管道超时(原因待查),浏览器验收改走坐标路径;不影响用户真实浏览器
- G2:adopt 扫描/勾选/move、add 表单、lint 集成;G3:update、skill 详情、remove;G4:长任务异步化、SSE 进度、可选 `--host`
- 依赖审计提示 vite 开发依赖有已知 advisory(不随包发布),后续升级 vite 跟进
