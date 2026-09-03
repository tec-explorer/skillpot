# M2 执行报告（2026-09-03）

> 状态：**M2 核心功能全部交付并验证**（TUI 与实机探针两项遗留，见文末）。对应规划：[产品规划](../product/product-plan.md)；上一份：[M0+M1 报告](./2026-09-03-m0-m1-execution.md)。

## 交付内容（版本 0.2.0）

| 功能 | 说明 |
|---|---|
| `adopt` 收编 | 扫描各已检测 Agent 的用户级 skills 目录，把已有 skill 拷贝进中央仓库并登记来源（`adopt:<agent>:<path>`）；`--dry-run` 预览、`--for` 导入即开放、`--from` 指定来源。本工具管理的 symlink、同名冲突、外部 symlink、非法目录一律跳过并报告；**来源 Agent 的原目录保留不动** |
| `lint` 安全扫描 | frontmatter 完整性（description 缺失为 error，过短/过长为 warn）+ 脚本静态扫描（`rm -rf`、`curl|sh`、`wget|sh`、`sudo`、`chmod 777`）；`--strict` 供 CI；`add` 时自动输出 lint 摘要 |
| `update` + lockfile | git 来源（含 `file://`）浅克隆比对 checksum；`--check` 只报告 outdated；应用时**原位替换**中央仓库内容（symlink 指向路径不变，无需重连）；`skillspot.lock.json` 随每次 config 变更自动刷新（来源 + checksum 快照） |
| `mcp` bridge（C 档） | 零依赖 stdio JSON-RPC 2.0 MCP server，工具：`skillpot_list / skillpot_read / skillpot_search`；按 `agent` 参数或 `SKILLPOT_AGENT` 环境变量遵循开关矩阵过滤。设计文档：[design/mcp-bridge.md](../design/mcp-bridge.md) |
| 体验细节 | enable/disable 输出增加"重启示例会话后生效"提示；`add` 支持 `file://` 本地 git 仓库 |

## 过程中修复的真实 Bug

1. **`.git` 污染 checksum**：`installFromGit` 将克隆产物（含 `.git`）整体拷入仓库，导致同一内容的两次克隆 checksum 必然不同，update 永远误报"有更新"。修复：安装与 checksum 统一忽略 `.git` / `.DS_Store`。
2. **adopt 开放时序**：`adoptSkills` 在 `saveConfig` 落盘之前调用 `enableSkill`（其内部从磁盘重读 config），新导入的 skill 因此 enable 失败且被静默吞掉。修复：先落盘再 enable。
3. **dry-run 计数**：dry-run 摘要把"待导入"计为 0。修复：dry-run 项计入 imported。真实环境预览时由该 bug 暴露（56 个 skill 但摘要显示 0）。

## 验证

- 单元测试：**38/38 通过**（新增 lint 5、adopt 5、update 4、mcp 7 组用例；含 git 仓库 fixture 的真实 update 流程）。
- 沙箱 e2e：在 M1 流程之上扩展 adopt（dry-run → 导入 → gemini-cli 开放 → 原目录保留）、lint、update（v1→v2 原位替换 + lockfile 生成）、MCP（initialize / tools/list / 按矩阵过滤：gemini-cli 可见、codex 不可见）——全部通过。
- 真实环境（只读）：`adopt --dry-run` 预览本机 `~/.claude/skills`，**56 个 skill 待导入、0 冲突**；未触碰真实目录。

## 遗留与下一步

- [ ] TUI 开关矩阵（skill × Agent 勾选视图）——M2 唯一未做项，依赖 Ink，评估后单独排期
- [ ] OpenCode / Gemini CLI 实机 symlink 验证（待装机后跑探针）
- [ ] Dogfood 部署：`skillpot init && skillpot adopt` 完成真机收编（dry-run 已验证，等待执行）
- [ ] M3：npm 发布 `skillpot@0.2.0`、git 立仓 + CI、registry / 团队共享
