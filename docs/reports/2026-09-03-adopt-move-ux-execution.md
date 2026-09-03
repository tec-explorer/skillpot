# 收编交互与 move 模式执行报告（2026-09-03）

> 版本 0.4.0。上一份：[TUI 报告](./2026-09-03-tui-execution.md)。触发来源：首次真机使用反馈。

## 用户反馈 → 修复对照

| 反馈/问题 | 根因 | 修复 |
|---|---|---|
| `skillpot init $$ skillpot adopt` 里 adopt 静默没执行，tui 显示空仓库 | commander 默认静默吞掉多余位置参数，连接符打错时无任何提示 | 所有命令 `allowExcessArguments(false)`，多打参数变成显式报错（`error: too many arguments`） |
| `skillpot add / adopt` 报"✗ / 中没有 SKILL.md" | 同上，`/` 被当作 source | 同上，现在报 `too many arguments for 'add'` |
| 表格列错位（agents 表 Installed 列） | picocolors 色码被计入 padEnd 宽度 | renderTable 按 ANSI 剥离后的可见宽度对齐 |

## 新功能：空仓库检测提醒 + move 移动模式

- **init 检测提醒**：中央仓库为空时，自动扫描各已安装 Agent 的 skills 目录并汇总展示"可收编"数量；TTY 下交互询问"是否移入 SkillPot？[Y/n]"，由用户选择触发；非 TTY（脚本/CI）降级为提示文案。
- **`adopt --move`**：移动模式——内容拷入中央仓库核验后，把来源 Agent 目录下的原目录替换为指向仓库的 symlink（来源 Agent 经由 symlink 继续使用，且自动对该 Agent 开放）。与仓库同名时同样执行"替换为 symlink"（状态 `⇄ 已链接`）。实现上分两阶段：先统一落盘 config，再逐个建链接（规避 enable 从磁盘重读 config 的时序问题）。
- 交互实现：`parseAsync` + 异步 action，`promptConfirm`（默认 Y）。

## 过程中抓到的严重数据 Bug：symlink 未解引用

用户真机首次 adopt 后 56 条 checksum 全部为空内容哈希（sha256 of ""），仓库目录里是指向 `~/.claude` 的外部 symlink。根因：用户 `~/.claude/skills` 中不少 skill 内部文件本身就是 symlink（如 `browse/SKILL.md → gstack/browse/SKILL.md`），而 `cpSync` 默认不解引用、`dirChecksum` 用 lstat 语义跳过 symlink。

修复：
1. `installFromLocal` 拷贝加 `dereference: true`——仓库必须自包含，只存真实内容；
2. `dirChecksum` 遍历跟随 symlink（断链/循环安全跳过）；
3. 新增回归测试（含 symlink 的源 → 拷贝后为真实文件、checksum 非空）。

真机数据修复：`~/.skillpot` 当时仅含坏产物（空壳目录 + 外链 + 空 checksum，state 台账为空，源目录未动），清除后重新收编 56 个 skill，checksum 恢复为真实内容哈希，tui 矩阵正常渲染。

## 验证

- 单元测试 **50/50**（新增 move 导入、move 同名 linked、scanAdoptable 排除 symlink、dereference 拷贝、ANSI 对齐）。
- 沙箱 e2e 新增 `adopt --move` 流程段，退出码 0，13 项断言全过。
- 真机：`add / adopt` 显式报错 ✓；init 检测提醒（非 TTY 分支）✓；56 skill 重新收编后内容/校验和正常 ✓。

## 遗留

- [ ] 用户执行 `skillpot adopt --move` 完成移动部署（或用 tui 逐个开关）
- [ ] OpenCode / Gemini CLI 实机 symlink 验证；M3：npm 发布、git 立仓 + CI、registry
