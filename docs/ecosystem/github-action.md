# 官方 GitHub Action：SkillPot Security & Policy Gate

> 仓库路径：[`action.yml`](../../action.yml) ｜ 市场标识：`tec-explorer/skillpot@v0.19.0`（或 `@main`）

SkillPot 提供标准化的 GitHub Action，方便团队在 CI/CD 流水线中针对 Agent Skills 设立**全量供应链安全扫描与组织合规门禁**。

---

## 1. 快速上手

### 基础用法：在 PR 中拦截高危提示词注入与恶意载荷

在项目仓库的 `.github/workflows/security.yml` 中添加：

```yaml
name: Agent Skills Security Gate

on:
  push:
    branches: [main]
  pull_request:

jobs:
  audit:
    name: Skill Supply Chain Audit
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Run SkillPot Security Gate
        uses: tec-explorer/skillpot@main
        with:
          args: 'audit --ci --fail-on error'
```

当 PR 中新增或修改的 Skill 含有**提示词覆写注入、隐藏 HTML 载荷、Unicode 零宽隐蔽字符、Base64 动态执行或恶意 lifecycle 脚本**时，Action 将以非零退出码自动阻断流水线合并。

---

## 2. 企业组织合规门禁

### 校验 `skillpot.policy.yaml` 策略基线

企业团队可通过维护代码化策略，强制要求 CI 流水线验证所有开发环境或打包资产是否符合组织基线：

```yaml
      - name: Enforce Organizational Skill Policy
        uses: tec-explorer/skillpot@main
        with:
          args: 'policy check --ci'
          policy: 'skillpot.policy.yaml'
```

若有开发者私自引入非白名单源（非公司内网 Git / 私有 Registry）或未安装组织强制开启的合规审查技能，Action 将阻断流水线并输出清晰违规报告。

---

## 3. Action 配置参数详解 (Inputs)

| 参数名 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `args` | String | `audit --ci --fail-on error` | 传递给 `skillpot` 的命令参数（如 `audit --ci`、`policy check --ci`） |
| `version` | String | `latest` | 指定 `@tec-explorer/skillpot` 的 npm 发布版本号，或传入 `local` 使用本地构建 |
| `policy` | String | `""` | 可选：指定自定义 `skillpot.policy.yaml` 路径 |
| `working-directory` | String | `.` | 执行命令的工作目录（适用于 Monorepo 子目录场景） |

---

## 4. 进阶场景

### 4.1 私有 Registry 认证注入

若企业自建了私有技能 Registry（如 JFrog Artifactory 或 Vercel SKILLS API），可通过 GitHub Actions Secrets 注入 Token：

```yaml
      - name: SkillPot Private Registry Audit
        uses: tec-explorer/skillpot@main
        env:
          SKILLPOT_REGISTRY_TOKEN: ${{ secrets.CORP_SKILLS_TOKEN }}
        with:
          args: 'policy check --ci'
```

### 4.2 输出 JSON 报告供企业 SOC / 监控平台抓取

```yaml
      - name: Generate Audit Report Artifact
        uses: tec-explorer/skillpot@main
        with:
          args: 'audit --json'
        continue-on-error: true

      - name: Upload Security Report
        uses: actions/upload-artifact@v4
        with:
          name: skillpot-audit-report
          path: audit-report.json
```
