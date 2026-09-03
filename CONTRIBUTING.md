# 贡献指南

感谢关注 SkillPot！无论是报告问题、补充文档还是提交代码，都欢迎。

## 环境要求

- Node.js ≥ 18（推荐 20 LTS）
- git（`update` 功能与本地仓库测试需要）

## 快速上手

```bash
git clone https://github.com/zhangmingyong/skillpot.git
cd skillpot
npm install
npm test          # vitest 单元测试（沙箱隔离，不碰真实 HOME）
npm run test:e2e  # 沙箱端到端冒烟（构建 + scripts/e2e-sandbox.sh）
npm run build     # tsc 类型检查 + esbuild 打包 dist/cli.mjs
```

## 项目结构

```
src/
├── cli.ts               # commander 命令面
├── paths.ts             # 中央仓库 / Agent HOME 路径（SKILLPOT_HOME、SKILLPOT_AGENT_HOME）
├── agents/registry.ts   # Agent 适配器注册表（发现路径 + 验证依据）
├── agents/detect.ts     # 检测：PATH 二进制 + 配置目录指纹
├── core/                # config(开关矩阵/台账/lockfile)、store(安装)、sync(symlink 引擎)、
│                        # adopt(收编)、lint、update、doctor、mcp-server
├── tui/                 # matrix/cells 纯逻辑 + App.tsx（ink 交互）
└── util/                # frontmatter 解析、表格渲染
tests/                   # vitest 单测 + fixtures（全部沙箱隔离）
scripts/e2e-sandbox.sh   # 端到端冒烟
docs/                    # 文档中心（索引见 docs/README.md）
```

## 提交 Pull Request 前

- [ ] `npm test` 与 `npm run test:e2e` 全绿
- [ ] 新功能有对应单元测试；涉及用户可见行为的变更已同步 README / CHANGELOG
- [ ] 里程碑性变更在 `docs/reports/` 新增执行报告（约定见 `docs/README.md`）
- [ ] 不在真实 HOME 上做手工验证的残留（测试一律走 `SKILLPOT_HOME` / `SKILLPOT_AGENT_HOME` 沙箱）

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：
`feat: ...`、`fix: ...`、`docs: ...`、`chore: ...`。

## 如何新增一个 Agent 适配器

完整设计见 [docs/design/agent-adapters.md](./docs/design/agent-adapters.md)。最小步骤：

1. 在 `src/agents/registry.ts` 增加 `AgentAdapter`：`id`、`binaries`、`fingerprints`、`skillsDir`，并在 `verified` 字段写明发现路径的验证依据（实测 / 官方文档 / 待确认）。
2. 确认该 Agent 用户级 skills 目录放一个指向中央仓库的 symlink 后能被发现（`SKILLPOT_AGENT_HOME` 沙箱 + 实机各验证一次）。
3. 补充 `tests/detect.test.ts` 或独立用例；更新 README「支持的 Agent」表格与 CHANGELOG。

## 报告问题

提交 Issue 前请先搜索已有条目；Bug 报告请附 `skillpot agents --json`、`skillpot doctor` 输出与操作系统/Node 版本。安全类问题**不要**走公开 Issue，见 [SECURITY.md](./SECURITY.md)。

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
