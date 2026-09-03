# 设计：MCP Bridge（C 档落地策略）

> 状态：已实现（v0.2.0）｜ 对应规划：[产品规划 §4 C 档](../product/product-plan.md)

## 目标

为没有原生 skills 目录机制的 Agent（部分 IDE、私有 harness 等）提供统一的 skill 消费通道：把 SkillPot 注册为其 MCP server，即可浏览、检索、读取中央仓库内容。**开关矩阵同样约束 MCP 通道**——`skillpot disable` 对 MCP 客户端即时生效，不产生旁路。

## 协议与形态

- 传输：stdio，newline-delimited JSON-RPC 2.0（MCP stdio 约定），零第三方依赖，Node ≥ 18 自带能力即可运行。
- 启动：`skillpot mcp`（CLI 子命令）。stderr 输出一行就绪提示，stdout 只承载协议消息。
- 握手：`initialize` 原样回显客户端 `protocolVersion`（缺省 `2025-06-18`），声明 `capabilities.tools`；`notifications/*` 不响应；`ping` 回空结果。

## 工具集

| 工具 | 输入 | 行为 |
|---|---|---|
| `skillpot_list` | `agent?` | 列出中央仓库 skill（name + description + source）；传入 `agent` 时按 expose 矩阵过滤 |
| `skillpot_read` | `skill` | 返回完整 `SKILL.md` 全文 + 文件树（渐进式加载的读取端由调用方 Agent 自行决定） |
| `skillpot_search` | `query` | 在 name/description 中做关键词匹配 |

## 过滤规则

优先级：`tools/call` 参数 `agent` > 环境变量 `SKILLPOT_AGENT=<agentId>` > 不过滤（全部已安装 skill）。

过滤依据是 `~/.skillpot/config.yaml` 的 `expose[agentId] === true`，因此 CLI 的 enable/disable 是唯一事实源。

## 接入示例（通用 MCP 客户端配置）

```json
{
  "mcpServers": {
    "skillpot": {
      "command": "skillpot",
      "args": ["mcp"],
      "env": { "SKILLPOT_AGENT": "codex" }
    }
  }
}
```

## 安全边界

- 工具全部只读：不提供写入/删除/执行类操作，skill 内置脚本是否执行由调用方 Agent 的既有权限体系决定。
- 遵循最小暴露：未 enable 给该 Agent 的 skill 对其不可见（list/search/read 均过滤）。
- 本地 stdio 传输，无网络监听、无需鉴权；但 MCP 配置写入即授权读取，属"本地信任模型"。

## 当前限制（→ M3）

- 未实现 MCP 的 resources / prompts / logging 能力。
- `skillpot_read` 不解析 skill 内引用文件的相对路径重写（返回原文 + 文件树）。
- 单进程单会话；并发由客户端侧保证。
