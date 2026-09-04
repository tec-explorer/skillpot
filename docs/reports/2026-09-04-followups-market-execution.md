# 跟进批次执行报告(dsh/Cursor 修正 · 矩阵筛选 · 市场 M1)

日期:2026-09-04 · 状态:全部完成并验收;版本 0.6.0 待发布

## 背景

承接上轮规划:用户确认按 2(dsh/cursor 验证)→ 3(矩阵可用性)→ 1(市场集成 M1)顺序执行,4(团队共享)待定。5(0.5.1 发布)已由用户完成。

## 任务 2:dsh/Cursor 验证与修正(6edb6d7)

- **Cursor 官方路径确认**:官方 `create-skill` 技能明示个人技能目录为 `~/.cursor/skills/`(项目级 `.cursor/skills/`)——0.5.1 配置的 `skills-cursor` 并非官方约定(用户机器上该目录来源存疑,但用户已通过它收编过条目,来源记录不受影响),适配器已修正为 `~/.cursor/skills`
- **dsh 实证补充**:`~/.dsh/skills` 内存在用户手工创建、日常使用的 symlink(指向 Claude 插件技能),间接佐证 dsh 能发现 symlink;dsh CLI 本机损坏(`dsh-web` 报 `@deepseek-ai/dsh` 模块缺失,疑与 nvm 切版本有关),**待用户重装 dsh 后最终确认**
- dsh 身份确认:DeepSeek CLI(npm `@deepseek-ai/dsh`,settings.yaml 指向 deepseek-official)

## 任务 3:矩阵搜索与筛选(27eccec)

搜索框(名称子串)+ 分段筛选(全部/已开放/异常漂移)+ 计数显示。56+ skill 的实际规模下定位单个 skill 不再靠滚动。

## 任务 1:市场 M1——Git 源模式(本次)

- `core/market.ts`:源管理(内置官方源 `anthropics/skills` + 自定义源落 `config.yaml sources:` 段)、克隆缓存(`~/.skillpot/cache/market/<url-hash>`,刷新=强制重克隆)、递归扫描 SKILL.md 目录(frontmatter 名称/描述/子目录/已装标记)、`installFromMarket` 走 `addSkill` 全流程
- API:`/api/market/sources(+add/remove)`、`/api/market/scan?url=`、`/api/market/install`
- CLI:`skillpot source list|add|remove`、`skillpot market [url] [--refresh]`
- GUI 新「市场」Tab:源切换、添加/移除自定义源、skill 表格一键安装(已装标记、SSE 自动同步)
- 真实验收:官方源经代理克隆,扫描出 **20 个 skill**;`academy-guide` 一键安装成功(source=`git:https://github.com/anthropics/skills.git#skills/academy-guide`,lint 干净),页面自动同步显示「已安装」

## 实施中发现并修复

1. **半截缓存 bug**:扫描克隆被中断(如服务被杀)会在缓存目录留下不完整仓库,下次被误当有效缓存。修复:先克隆到临时目录、成功后原子改名。
2. **git 克隆无超时**:`installFromGit`/`updateSkills`/`scanSource` 统一加 5 分钟超时,防坏网络下永久挂起。
3. **网络依赖**:git clone 走用户自身 git/代理配置——本机直连 GitHub 不通,验证时以 `https_proxy` 环境变量注入沙箱服务;正式使用时用户按常规 git 代理配置即可。
4. 自动化验收备注:IAB 自动化对本页的定位器点击管道间歇性卡死(与 G1 记录同源),验收中按钮操作以坐标/接口直连完成;真实浏览器不受影响。

## 测试与遗留

- 全量 10 文件 73 用例通过(新增市场 6 项:源管理校验、扫描/缓存/安装、API 全链路+403)
- 遗留:M2 skills.sh 在线目录(auth 方案待研究其 CLI 源码)、Qoder 无 skills 目录暂不支持、dsh/cursor symlink 终验、团队共享(用户待定)
