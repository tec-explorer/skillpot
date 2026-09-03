# 安全策略

## 支持的版本

| 版本 | 是否提供安全修复 |
|---|---|
| 0.4.x | ✅ |
| < 0.4.0 | ❌（请升级） |

## 报告漏洞

**请勿通过公开 Issue 报告安全漏洞。**

- 首选：GitHub 仓库的 "Private vulnerability reporting"（私有安全报告）
- 备选：邮件至 `zhangmingyong`（见仓库主页联系方式），标题带 `[security]`

我们承诺在 7 天内首次响应，修复或给出缓解方案前不公开细节。

## 重点关注范围

SkillPot 的特殊安全面在于 **skill 本质是注入模型上下文的指令 + 可携带可执行脚本**：

1. **供应链**：`adopt`/`add` 拷贝第三方 skill 时的路径逃逸、symlink 攻击（如源目录内 symlink 指向仓库外敏感文件——当前以 `dereference` 拷贝内容 + `IGNORED_ENTRIES` 白名单缓解）、installFromGit 的命令注入。
2. **开关矩阵旁路**：MCP bridge 必须严格遵循 expose 过滤，任何未 enable 的 skill 不可被 list/read。
3. **文件边界**：enable/disable/doctor 只应操作 `state.json` 台账内或确认指向中央仓库的链接，不得触碰用户自建内容。
4. **MCP stdio**：无网络监听属预期设计；若发现远程可达面请报告。

## 不属于漏洞的范畴

- 用户主动安装恶意 skill 造成的模型行为异常（请配合 `skillpot lint` 自查，高危模式告警为 best-effort）
- Agent 自身对 symlink skill 的处理策略
