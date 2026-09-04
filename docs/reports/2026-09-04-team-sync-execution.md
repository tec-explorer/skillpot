# 主线 B(团队对齐)执行报告

日期:2026-09-04 · 状态:已完成,E2E 验收通过;v0.9.0 已发布

## 交付内容

- **项目清单** `.skillpot.yaml`(随项目仓库提交):`skills.<name>.source / checksum(可选版本锁)/ expose(可选开放矩阵)`
- **`skillpot sync`**:按清单对齐本机——安装缺失、checksum 锁版本不一致时重装、应用开放矩阵;`--dry-run` 预览;`--file` 自定义路径
- **`skillpot sync --export`**:从当前中央仓库导出清单(`--skill a,b` 精选;`local:` 来源自动警告"队友无法对齐")
- 核心:`core/team-sync.ts`(`loadManifest / exportManifest / syncManifest`),对齐安装复用 `addSkill` 全流程(lint、来源登记、lockfile 刷新)

## 对齐语义(可预期优先)

- 清单带 `checksum` = **版本锁**:同步时用本地仓库**实际内容**的校验和与清单比对(可发现手改漂移),偏离即重装;重装后仍不一致则提示"远端可能已更新,建议更新清单"
- 不带 `checksum`:只保证已安装,不主动更新(可预期;刷新用 `skillpot update`)
- `expose` 只做增量开启(true 的 Agent),不主动关闭用户自行开放的
- `local:` 来源:未装则跳过,已装则提示仅本机有效

## 验收

- 单测 8 项:导出(含 local 警告/精选过滤/空仓库报错)、安装+expose+幂等、dry-run 不落地、checksum 漂移重装、无锁不主动更新、local 跳过、坏清单报错
- E2E(双 HOME 实测):队长 `sync --export` → 队友全新 HOME `sync` → git 源 skill 自动安装并 symlink 暴露;local 来源正确跳过并警告
- 全量 12 文件 93 用例通过(Node 22 实测)

## 过程记录

- 实施中发现并修复:`git:` 前缀剥离早于来源校验导致的误跳过;版本号改动遗漏出commit 致 v0.9.0 首次发布被 npm 403(已补提交并重打标签重发)
- 环境事件:用户本机 Node 18 → 20/22 迁移(v18 已删),global 安装(含 skillpot/dsh)需在新版本下重装

## 遗留与后续

- GUI 团队对齐面板(当前 CLI 优先);`skillpot sync` 的 `--except`/选择性关闭语义
- 主线 C:dsh(Node 升级后)/Cursor symlink 实机终验;B 档 copy+sync
- 主线 D:skills.sh 在线目录、英文 README
