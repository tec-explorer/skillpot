# 设计：企业级策略治理与私有 Registry 对接

> 状态：已实现（v0.15.0）｜ 对应规划：[产品规划 §4 Phase 4 企业级治理](../product/product-plan.md)

## 1. 背景与目标

随着 AI Agent Skills 深入企业内部落地，开发者往往不仅使用公共生态的 Skill，还需要引入公司内部沉淀的业务能力。在此过程中，企业面临三大关键治理挑战：
1. **合规基线缺失**：无法保证全员或所有终端强制开启指定安全技能（如安全代码审查、公司合规脱敏工具）。
2. **供应链风险失控**：开发者可能安装来源不明的公共技能、存在恶意提示词注入/代码注入的高危技能，或者公司明确禁止的第三方技能。
3. **私有资产隔离与管控**：内部封装的自研 Agent 技能通常托管在私有 Registry（如 JFrog Artifactory、自建 Vercel 兼容 Registry），需要统一的 Token 鉴权注入与私有化锁定策略（禁止访问未授权的公共源）。

SkillPot 在 **Phase 4** 引入了企业级策略治理引擎（Enterprise Policy Engine）与私有 Registry 适配协议，为组织与团队提供可代码化（Policy-as-Code）、可自动化（CI 门禁与自动修复）的完整解决方案。

---

## 2. 策略引擎架构与规范

### 2.1 策略文件结构 (`skillpot.policy.yaml`)

企业可通过在根目录、用户配置目录或指定路径维护 `skillpot.policy.yaml` 文件进行集中治理。

```yaml
version: "1.0"
mode: strict # strict（默认阻断）| audit（仅告警审查）

# 来源控制白名单
allowed_sources:
  - "https://github.com/my-org/*"
  - "https://skills.internal.mycompany.com/*"
  - "local:*"

# 目标 Agent / 广播渠道治理
targets:
  broadcast:
    allow: false # 禁用全局广播目录 ~/.agents/skills，防止所有 Agent 无界暴露
  allowed_agents:
    - claude-code
    - codex
    - gemini-cli

# 强制开启技能（合规基线）
enforce:
  - name: "security-guard"
    source: "https://github.com/my-org/security-guard.git"
    targets: ["all"] # 或具体指定 ["claude-code", "gemini-cli"]
    checksum: "sha256:abcd1234..." # 可选：强制锁定完整性哈希

# 禁止安装的技能黑名单
deny:
  - pattern: "*crypto*"
    reason: "组织禁止安装加密货币或未经审核的金融类技能"
  - pattern: "bad-actor-*"
    reason: "安全通报高危样本黑名单"
  - checksum: "sha256:99999999..."
    reason: "已知被投毒特定版本哈希拦截"

# 私有 Registry 配置
registry:
  endpoint: "https://skills.corp.example.com/api"
  token_env: "SKILLPOT_REGISTRY_TOKEN" # 推荐通过环境变量注入 Bearer Token
  force_private: true # 锁定模式：禁止回退到公共 Market 或第三方源
```

### 2.2 策略规则与匹配机制

1. **命名通配符匹配**：
   - 策略支持简单的 glob 匹配（如 `*test*`、`crypto-*`、`*malicious`）。
   - 大小写不敏感比对，确保防御全覆盖。
2. **哈希匹配 (`checksum`)**：
   - 支持对特定投毒版本哈希精准封锁，即便改名也无法规避拦截。
   - `enforce` 支持配置期望 checksum，一旦本地安装技能内容偏离（哈希不一致），将被检出为违规。
3. **来源白名单 (`allowed_sources`)**：
   - 支持 git URL 前缀通配符（如 `https://github.com/my-company/*`）与 `local:*`。
   - 未在白名单中的源（如非企业允许的第三方个人仓库）在添加时即刻被阻断。
4. **运行模式 (`mode`)**：
   - `strict`（严格模式）：违反 deny、allowed_sources 或 channel 策略时，直接阻断 `skillpot add` 与 `skillpot enable`。
   - `audit`（审计模式）：不强制中断日常操作（除非传入了黑名单或未显式覆盖），违规项记录在合规报告中，用于看板监测。

---

## 3. CLI 工具链与自动化闭环

### 3.1 策略管理命令

- **初始化策略模板**：
  ```bash
  skillpot policy init
  ```
  在当前目录生成包含组织基线、常用白名单和安全说明的 `skillpot.policy.yaml` 初始模板。

- **合规检查**：
  ```bash
  skillpot policy check
  skillpot policy check -p /etc/skillpot/corp-policy.yaml --json
  ```
  校验当前仓库中已安装的 Skill 是否满足：
  - 是否包含 `deny` 黑名单中的技能；
  - 是否安装了未列入 `allowed_sources` 的非白名单来源；
  - `enforce` 技能是否全员安装且正确开放给对应 Agent；
  - `enforce` 技能哈希是否偏离基线；
  - 是否违规开放了被禁用的广播渠道或未授权 Agent。
  若存在违规，退出码为非 0。

- **一键策略应用与自动修复 (`apply`)**：
  ```bash
  # 预览修复动作
  skillpot policy apply --dry-run

  # 执行自动修复
  skillpot policy apply
  ```
  `applyPolicy` 执行幂等收敛：
  1. 自动从各 Agent 目录卸载违规命中黑名单的技能；
  2. 自动撤销被禁用的渠道暴露（如禁用广播渠道 `broadcast`）；
  3. 自动根据 `enforce` 规则补齐缺失的技能安装（通过配置的 Git Source 安装），并同步 `enable` 到指定 Agent。

---

## 4. 私有 Registry 集成

SkillPot 兼容两大企业级技能 Registry 协议规范：
1. **JFrog Artifactory Agent Skills Registry**
2. **Vercel AI Skills API 规范**（`SKILLS_API_URL`）

### 4.1 终端解析与认证注入

Registry 地址与认证信息按如下优先级解析：
1. CLI 显式参数 `--endpoint` / `--token`
2. 环境变量：`SKILLPOT_REGISTRY_URL` / `SKILLS_API_URL`，以及 `SKILLPOT_REGISTRY_TOKEN` / `SKILLS_API_KEY`
3. 策略文件 `skillpot.policy.yaml` 中的 `registry` 节点配置
4. 默认公共 Registry（https://skills.sh）

请求发送时，客户端自动在 Header 中注入：
```http
Authorization: Bearer <TOKEN>
User-Agent: skillpot/<VERSION>
```

### 4.2 私有锁定模式 (`force_private`)

当策略文件中配置 `registry.force_private: true` 时：
- `skillpot market search` 强制只在私有 Registry 检索，禁止查询公共 Registry。
- `skillpot add` 拦截非私有 Registry 或非白名单的安装来源。
- 保证企业内网网络与资产闭环。

---

## 5. 持续集成（CI）与防御门禁

在企业 CI/CD Pipeline 或本地 Git 提交钩子（pre-commit / pre-push）中，可通过以下命令实现自动化质量与合规把关：

```bash
# 1. 运行企业合规检查与 CI 门禁
skillpot policy check --ci

# 2. 运行安全审计并输出 JSON 供企业 SOC / 监控平台抓取
skillpot audit --ci --json > audit-report.json
```

若存在任何 `error` 级别的高危提示词注入漏洞、供应链投毒或策略合规违规，命令均会返回非零状态码，自动熔断流水线。
