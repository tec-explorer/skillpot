# GUI G2/G3/G4 执行报告(收编安装 / 维护视图 / 异步化与 SSE)

日期:2026-09-04 · 状态:已完成,浏览器端到端验收通过

## 交付总览

在 G1(骨架+矩阵+体检,见同日 g1 报告)基础上连续交付三个里程碑,GUI 覆盖全部核心命令:

| 里程碑 | 内容 | 提交 |
|---|---|---|
| G2 | 收编视图(扫描/勾选/move/收编后开放)、安装视图(本地/git 表单、安装即 lint、可选开放);`core/add.ts` 抽取 `addSkill` 供 CLI/GUI 共用;`adoptSkills` 新增 `only` 勾选过滤;`POST /api/adopt|add`、`GET /api/adopt` | c2325bc |
| G3 | 维护视图(git 来源检查/应用更新)、详情弹层(描述/文件树/SKILL.md/lint/卸载);`core/skill-detail.ts` 抽取 `readSkillDetail`(MCP `skillpot_read` 复用)、`core/uninstall.ts` 抽取 `uninstallSkill`(CLI remove 复用);`GET /api/skill/:name`、`POST /api/update|remove` | 1fdac5e |
| G4 | `installFromGit`/`updateSkills` 异步化(execFile promise,GUI 调用 git 时不再阻塞事件循环);SSE 变更广播(`/api/events`,写操作成功即广播,多标签页自动同步);`--host` 非回环绑定时所有请求强制 token;客户端 EventSource 订阅(150ms 去抖刷新) | 本次 |

## 关键设计

- **同步转异步的取舍**:原计划 G4 用 worker_threads 迁移 git 操作;实施时发现直接把 `installFromGit`/`updateSkills` 改为 promise 化 execFile 即可解除事件循环阻塞,且避免单文件 bundle 下的 worker 入口打包复杂度,故改为异步化方案。
- **SSE 与状态同步**:广播只在 GUI API 写操作成功后触发;外部 CLI 直接改文件不走 server、无事件(边界,见下)。客户端以变更序号 `rev` 驱动自取数据视图(体检/收编)重新拉取,不重挂载——首版用 key 重挂载会清空用户本地状态(如维护页检查结果),已修正。
- **非回环安全**:`--host 0.0.0.0` 时所有请求(含 GET/SSE)都要求 token,SSE 无法带请求头故支持 `?token=` 查询串认证。

## 验证

- 全量测试 9 文件 67 用例通过(新增:勾选收编+move 替换 symlink、add 重复报错、详情/卸载/update local、SSE 收到 change 事件、非回环 403/带 token 200)
- 浏览器实测:详情弹层与卸载入口、维护页检查更新(git-skill「＝ 已是最新」、demo-skill「· 本地来源」)、SSE 自动刷新(curl 走 GUI API 改状态后,无操作的页面 150ms 去抖后自动同步)
- CLI 回归:`add` 重构后输出保持不变

## 已知边界

- 外部 CLI 直接改动不会触发 SSE(无文件监听);GUI 页内的显示在下次交互/刷新后一致。后续可加 chokidar 类 watcher 或轮询 checksum。
- G2 收编扫描列表在 SSE 刷新时会重新扫描并恢复默认勾选,用户进行中的勾选可能被重置(变更通常由自身操作触发,影响小)。
- Playwright 高层定位器对本页 td 点击管道超时(G1 已记录),浏览器验收中按钮/输入走定位器、表格单元格走坐标路径。
- 依赖审计:vite 等 dev 依赖存在已知 advisory(不随包发布),待 vite 5.4.x 后续版本跟进。
