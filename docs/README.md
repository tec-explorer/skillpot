# SkillPot 文档中心

工程所有文档统一存放在本目录，根目录只保留 `README.md` 作为项目入口。

## 目录结构

```
docs/
├── README.md                  # 本索引
├── guide.md                   # 功能指南：TUI/GUI 全功能截图与分步说明（面向使用者）
├── images/                    # 文档截图（guide.md 与 README 引用）
├── product/                   # 产品文档：规划、需求、路线图
│   └── product-plan.md        # 产品规划（背景 / 定位 / 架构 / 兼容矩阵 / 路线图）
├── design/                    # 技术与架构设计（按需创建，如适配器协议、配置格式、MCP bridge）
│   ├── agent-adapters.md      # Agent 适配器与三档落地策略（含新增适配器指南）
│   └── mcp-bridge.md          # MCP bridge 设计（C 档落地策略）
├── reports/                   # 里程碑执行报告（一个里程碑一份，只增不改）
│   ├── 2026-09-03-m0-m1-execution.md
│   ├── 2026-09-03-m2-execution.md
│   ├── 2026-09-03-tui-execution.md
│   ├── 2026-09-03-adopt-move-ux-execution.md
│   ├── 2026-09-04-gui-g1-execution.md
│   ├── 2026-09-04-gui-g2-g3-g4-execution.md
│   └── 2026-09-04-followups-market-execution.md
└── decisions/                 # 关键决策记录 ADR（按需创建，只增不改）
```

## 管理约定

| 分类 | 路径 | 命名规则 | 说明 |
|---|---|---|---|
| 用户指南 | `docs/guide.md`（截图在 `docs/images/`） | 随功能更新 | 面向使用者的功能说明与操作截图 |
| 产品文档 | `docs/product/` | kebab-case，如 `product-plan.md`、`requirements.md` | 规划、需求、路线图；随产品演进更新 |
| 技术设计 | `docs/design/` | 一份主题一份，如 `agent-adapters.md`、`config-format.md` | 架构决策落地为设计文档后，代码 PR 引用此处 |
| 执行报告 | `docs/reports/` | `YYYY-MM-DD-<里程碑>-execution.md` | 里程碑复盘：结果、证据、遗留项；不回改历史 |
| 决策记录 | `docs/decisions/` | `NNNN-<kebab-title>.md` | ADR 风格：背景 / 备选 / 结论；推翻旧决策用新编号 |

- 新里程碑完成后：在 `reports/` 新增报告，并在 `product/product-plan.md` §14 更新指向最新一篇的链接。
- 文档间引用一律用相对路径；`product-plan.md` 是唯一的规划事实源（single source of truth）。
