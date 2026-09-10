import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { skillpotHome } from '../paths';
import { loadConfig, loadState, saveConfig } from './config';
import { exposedTargets } from './expose';
import { allTargetIds } from '../agents/registry';
import { addSkill } from './add';
import { disableSkill, enableSkill, resolveAgentIds } from './sync';
import { uninstallSkill } from './uninstall';
import {
  PolicyApplyAction,
  PolicyApplyResult,
  PolicyCheckResult,
  PolicyMode,
  PolicyViolation,
  SkillPotConfig,
  SkillPotPolicy,
  SkillPotState,
} from '../types';

/** 默认策略文件名 */
export const DEFAULT_POLICY_FILE = 'skillpot.policy.yaml';

/**
 * 寻找策略文件路径。查找优先级：
 * 1. 显式指定的路径（不存在则报错）
 * 2. 环境变量 SKILLPOT_POLICY_FILE
 * 3. 当前工作目录（skillpot.policy.yaml / .skillpot.policy.yaml / skillpot-policy.yaml）
 * 4. 中央仓库目录（~/.skillpot/policy.yaml）
 * 5. 系统级策略目录（/etc/skillpot/policy.yaml）
 */
export function findPolicyFile(explicitPath?: string): string | undefined {
  if (explicitPath) {
    const p = path.resolve(process.cwd(), explicitPath);
    if (!fs.existsSync(p)) {
      throw new Error(`指定的策略文件不存在：${explicitPath}`);
    }
    return p;
  }

  const envPath = process.env.SKILLPOT_POLICY_FILE;
  if (envPath) {
    const p = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(p)) return p;
  }

  const cwdCandidates = [
    path.join(process.cwd(), 'skillpot.policy.yaml'),
    path.join(process.cwd(), '.skillpot.policy.yaml'),
    path.join(process.cwd(), 'skillpot-policy.yaml'),
  ];
  for (const c of cwdCandidates) {
    if (fs.existsSync(c)) return c;
  }

  const userPath = path.join(skillpotHome(), 'policy.yaml');
  if (fs.existsSync(userPath)) return userPath;

  const sysPath = '/etc/skillpot/policy.yaml';
  try {
    if (fs.existsSync(sysPath)) return sysPath;
  } catch {
    // 忽略权限问题
  }

  return undefined;
}

/**
 * 加载并校验策略文件。未找到时返回 null。
 */
export function loadPolicy(explicitPath?: string): { policy: SkillPotPolicy; file: string } | null {
  const file = findPolicyFile(explicitPath);
  if (!file) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`读取策略文件失败 (${file})：${e instanceof Error ? e.message : String(e)}`);
  }

  let data: any;
  try {
    data = parse(raw);
  } catch (e) {
    throw new Error(`解析策略文件失败 (${file})：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`策略文件内容无效 (${file})`);
  }

  if (data.version !== 1) {
    throw new Error(`不支持的策略文件版本：${data.version}（当前仅支持 version: 1）`);
  }

  const policy: SkillPotPolicy = {
    version: 1,
    name: typeof data.name === 'string' ? data.name : undefined,
    mode: data.mode === 'audit' ? 'audit' : 'strict',
    registry: data.registry && typeof data.registry === 'object' ? data.registry : undefined,
    enforce: Array.isArray(data.enforce) ? data.enforce : undefined,
    deny: Array.isArray(data.deny) ? data.deny : undefined,
    allowed_sources: Array.isArray(data.allowed_sources) ? data.allowed_sources : undefined,
    targets: data.targets && typeof data.targets === 'object' ? data.targets : undefined,
  };

  return { policy, file };
}

/**
 * 通配符模式匹配（支持 * 与 ?，不区分大小写）
 */
export function matchesPattern(str: string, pattern: string): boolean {
  if (pattern === '*' || pattern === str) return true;
  // 转义正则特殊字符，并将 * 替换为 .*，? 替换为 .
  const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexStr, 'i').test(str);
}

/**
 * 校验来源是否在白名单中
 */
export function isSourceAllowed(source: string, allowedList?: string[]): boolean {
  if (!allowedList || allowedList.length === 0) return true;
  for (const pattern of allowedList) {
    if (matchesPattern(source, pattern)) return true;
    // 如果 pattern 没有以 * 结尾且是 URL 前缀匹配
    if (source.startsWith(pattern.replace(/\*$/, ''))) return true;
  }
  return false;
}

/**
 * 执行策略合规检查
 */
export function checkPolicy(
  policy: SkillPotPolicy,
  policyFile: string,
  customConfig?: SkillPotConfig,
  customState?: SkillPotState,
): PolicyCheckResult {
  const config = customConfig ?? loadConfig();
  const state = customState ?? loadState();
  const violations: PolicyViolation[] = [];
  const knownTargets = allTargetIds();
  const mode: PolicyMode = policy.mode ?? 'strict';
  const defaultSeverity = mode === 'strict' ? 'error' : 'warn';

  // 1. 检查强制安装清单（Enforce Rules）
  const enforceList = policy.enforce ?? [];
  for (const rule of enforceList) {
    const existing = config.skills[rule.name];
    if (!existing) {
      violations.push({
        type: 'enforce_missing',
        severity: defaultSeverity,
        rule: `enforce:${rule.name}`,
        skill: rule.name,
        message: `合规缺失：强制技能 '${rule.name}' 未安装（来源应为 ${rule.source}）`,
      });
      continue;
    }

    // 版本校验和比对
    if (rule.checksum && existing.checksum !== rule.checksum) {
      violations.push({
        type: 'enforce_missing',
        severity: defaultSeverity,
        rule: `enforce:${rule.name}`,
        skill: rule.name,
        message: `版本偏离：强制技能 '${rule.name}' 实际校验和 (${existing.checksum}) 与策略要求 (${rule.checksum}) 不符`,
      });
    }

    // 检查开放目标
    const requiredTargets = resolveAgentIds(rule.for || 'all');
    const currentlyExposed = new Set(exposedTargets(existing, state, rule.name, knownTargets));
    for (const reqTarget of requiredTargets) {
      if (!currentlyExposed.has(reqTarget)) {
        violations.push({
          type: 'enforce_not_exposed',
          severity: defaultSeverity,
          rule: `enforce:${rule.name}`,
          skill: rule.name,
          target: reqTarget,
          message: `暴露不足：强制技能 '${rule.name}' 未对目标 '${reqTarget}' 开放`,
        });
      }
    }
  }

  // 2. 检查禁用清单（Deny Rules）
  const denyList = policy.deny ?? [];
  for (const [name, entry] of Object.entries(config.skills)) {
    for (const rule of denyList) {
      let matched = false;
      if (rule.name && matchesPattern(name, rule.name)) {
        matched = true;
      }
      if (rule.source && matchesPattern(entry.source, rule.source)) {
        matched = true;
      }
      if (rule.checksum && entry.checksum === rule.checksum) {
        matched = true;
      }

      if (matched) {
        const reasonSuffix = rule.reason ? `（原因：${rule.reason}）` : '';
        violations.push({
          type: 'denied_installed',
          severity: 'error', // 禁用技能无论 strict 还是 audit 均为 error
          rule: `deny:${rule.name || rule.source || rule.checksum}`,
          skill: name,
          message: `策略违规：已安装技能 '${name}' 命中组织禁用规则${reasonSuffix}`,
        });

        const activeTargets = exposedTargets(entry, state, name, knownTargets);
        if (activeTargets.length > 0) {
          violations.push({
            type: 'denied_exposed',
            severity: 'error',
            rule: `deny:${rule.name || rule.source || rule.checksum}`,
            skill: name,
            message: `严重违规：被禁用的技能 '${name}' 仍处于开放生效状态（对 ${activeTargets.join(', ')}）`,
          });
        }
      }
    }
  }

  // 3. 检查来源白名单（Allowed Sources）
  if (policy.allowed_sources && policy.allowed_sources.length > 0) {
    for (const [name, entry] of Object.entries(config.skills)) {
      if (!isSourceAllowed(entry.source, policy.allowed_sources)) {
        violations.push({
          type: 'disallowed_source',
          severity: defaultSeverity,
          rule: 'allowed_sources',
          skill: name,
          message: `非受信源：技能 '${name}' 的来源 (${entry.source}) 未在组织受信白名单中`,
        });
      }
    }
  }

  // 4. 检查目标渠道限制（Targets Rules）
  if (policy.targets) {
    for (const [targetId, rule] of Object.entries(policy.targets)) {
      if (rule.allow === false) {
        // 检查该目标下是否有生效链接
        for (const [name, entry] of Object.entries(config.skills)) {
          const activeTargets = exposedTargets(entry, state, name, knownTargets);
          if (activeTargets.includes(targetId)) {
            violations.push({
              type: 'target_disallowed',
              severity: 'error',
              rule: `targets.${targetId}.allow=false`,
              skill: name,
              target: targetId,
              message: `渠道违规：策略严禁向目标 '${targetId}' 开放技能，但 '${name}' 已对其生效`,
            });
          }
        }
      }
    }
  }

  return {
    file: policyFile,
    policy,
    compliant: violations.length === 0,
    violations,
    enforcedCount: enforceList.length,
    deniedCount: denyList.length,
  };
}

/**
 * 自动应用策略修复（Policy Apply）
 */
export async function applyPolicy(
  policy: SkillPotPolicy,
  policyFile: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<PolicyApplyResult> {
  const actions: PolicyApplyAction[] = [];
  const knownTargets = allTargetIds();

  // 1. 先清理违规与被禁用的技能
  const initialCheck = checkPolicy(policy, policyFile);
  const toUninstall = new Set<string>();
  const toDisableTargets: { skill: string; targets: string[] }[] = [];

  for (const v of initialCheck.violations) {
    if (v.type === 'denied_installed' && v.skill) {
      toUninstall.add(v.skill);
    } else if (v.type === 'target_disallowed' && v.skill && v.target) {
      toDisableTargets.push({ skill: v.skill, targets: [v.target] });
    }
  }

  for (const skill of toUninstall) {
    if (opts.dryRun) {
      actions.push({
        skill,
        action: 'uninstalled',
        detail: `[dry-run] 将卸载被禁用的技能 '${skill}' 并撤除所有链接`,
      });
    } else {
      try {
        uninstallSkill(skill);
        actions.push({
          skill,
          action: 'uninstalled',
          detail: `已卸载被禁用的技能 '${skill}' 并撤除所有链接`,
        });
      } catch (e) {
        actions.push({
          skill,
          action: 'failed',
          detail: `卸载 '${skill}' 失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  for (const item of toDisableTargets) {
    if (toUninstall.has(item.skill)) continue; // 已卸载无需单独 disable
    if (opts.dryRun) {
      actions.push({
        skill: item.skill,
        action: 'disabled',
        detail: `[dry-run] 将对禁用渠道 '${item.targets.join(',')}' 关闭技能 '${item.skill}'`,
      });
    } else {
      try {
        disableSkill(item.skill, item.targets);
        actions.push({
          skill: item.skill,
          action: 'disabled',
          detail: `已对禁用渠道 '${item.targets.join(',')}' 关闭技能 '${item.skill}'`,
        });
      } catch (e) {
        actions.push({
          skill: item.skill,
          action: 'failed',
          detail: `关闭目标失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  // 2. 补齐强制技能并开放至目标
  const enforceList = policy.enforce ?? [];
  for (const rule of enforceList) {
    const config = loadConfig();
    const existing = config.skills[rule.name];

    if (!existing) {
      if (opts.dryRun) {
        actions.push({
          skill: rule.name,
          action: 'installed',
          detail: `[dry-run] 将安装强制技能 '${rule.name}' (来源: ${rule.source})`,
        });
      } else {
        try {
          await addSkill(rule.source, {
            name: rule.name,
            force: opts.force ?? true, // 策略下发默认强制放行
          });
          actions.push({
            skill: rule.name,
            action: 'installed',
            detail: `已安装强制技能 '${rule.name}' (来源: ${rule.source})`,
          });
        } catch (e) {
          actions.push({
            skill: rule.name,
            action: 'failed',
            detail: `安装强制技能 '${rule.name}' 失败：${e instanceof Error ? e.message : String(e)}`,
          });
          continue; // 安装失败则无法继续 enable
        }
      }
    }

    // 补齐开放
    const reqTargets = resolveAgentIds(rule.for || 'all');
    const freshConfig = loadConfig();
    const freshState = loadState();
    const currentExposed = new Set(
      freshConfig.skills[rule.name]
        ? exposedTargets(freshConfig.skills[rule.name], freshState, rule.name, knownTargets)
        : [],
    );
    const needExpose = reqTargets.filter((t) => !currentExposed.has(t));

    if (needExpose.length > 0) {
      if (opts.dryRun) {
        actions.push({
          skill: rule.name,
          action: 'exposed',
          detail: `[dry-run] 将对目标 '${needExpose.join(',')}' 开放强制技能 '${rule.name}'`,
        });
      } else {
        try {
          enableSkill(rule.name, needExpose);
          actions.push({
            skill: rule.name,
            action: 'exposed',
            detail: `已对目标 '${needExpose.join(',')}' 开放强制技能 '${rule.name}'`,
          });
        } catch (e) {
          actions.push({
            skill: rule.name,
            action: 'failed',
            detail: `开放目标失败：${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    }
  }

  // 3. 复查剩余违规
  const remaining = opts.dryRun ? initialCheck.violations : checkPolicy(policy, policyFile).violations;

  return {
    file: policyFile,
    actions,
    violationsRemaining: remaining,
  };
}

/**
 * 运行时拦截：检查添加是否合规
 */
export function checkAddAllowed(
  name: string,
  source: string,
  checksum?: string,
  policy?: SkillPotPolicy | null,
  opts?: { force?: boolean },
): void {
  if (!policy) return;
  const isStrict = policy.mode !== 'audit';

  // 1. 检查黑名单
  if (policy.deny) {
    for (const rule of policy.deny) {
      let matched = false;
      if (rule.name && matchesPattern(name, rule.name)) matched = true;
      if (rule.source && matchesPattern(source, rule.source)) matched = true;
      if (rule.checksum && checksum && checksum === rule.checksum) matched = true;

      if (matched) {
        const reason = rule.reason ? `（${rule.reason}）` : '';
        if (isStrict || !opts?.force) {
          throw new Error(
            `策略阻断：技能 '${name}'（来源 ${source}）命中组织禁用黑名单${reason}`,
          );
        }
      }
    }
  }

  // 2. 检查白名单
  if (policy.allowed_sources && policy.allowed_sources.length > 0) {
    if (!isSourceAllowed(source, policy.allowed_sources)) {
      if (isStrict || !opts?.force) {
        throw new Error(
          `策略阻断：来源 '${source}' 不在组织允许的白名单（allowed_sources）中`,
        );
      }
    }
  }
}

/**
 * 运行时拦截：检查开启目标是否合规
 */
export function checkEnableAllowed(
  name: string,
  targets: string[],
  policy?: SkillPotPolicy | null,
): void {
  if (!policy) return;

  // 1. 是否为被禁用的 skill
  if (policy.deny) {
    for (const rule of policy.deny) {
      if (rule.name && matchesPattern(name, rule.name)) {
        throw new Error(`策略阻断：禁止开放命中组织禁用规则的技能 '${name}'`);
      }
    }
  }

  // 2. 目标限制
  if (policy.targets) {
    for (const target of targets) {
      if (policy.targets[target]?.allow === false) {
        throw new Error(`策略阻断：组织策略严禁向目标 '${target}' 开放技能`);
      }
    }
  }
}

/**
 * 生成策略模版内容
 */
export function generatePolicyTemplate(): string {
  return `# SkillPot 企业/组织级安全治理策略文件
# 放置在项目根目录、~/.skillpot/policy.yaml 或 /etc/skillpot/policy.yaml
version: 1
name: enterprise-security-baseline
mode: strict # strict: 违规直接阻断 | audit: 仅审计与 CI 告警

# 1. 私有 / 企业级 Registry 对接
registry:
  url: https://skills.corp.internal/api
  token_env: CORP_SKILLS_TOKEN
  force_private: false # 设置为 true 时禁止搜索/拉取公共 skills.sh

# 2. 合规技能基线（全员强制安装并开启）
enforce:
  # - name: company-guardrail
  #   source: git:https://github.com/my-corp/company-guardrail.git
  #   checksum: "sha256:..."
  #   for: all

# 3. 组织禁用黑名单（严禁安装与生效）
deny:
  - name: "*jailbreak*"
    reason: "防范越狱/提示词覆写风险"
  - name: "*malicious*"
    reason: "高危恶意样本"
  - source: "*untrusted-domain.com*"
    reason: "非受信外部来源"

# 4. 允许的安装源白名单（可选，未配置时不限制来源）
# allowed_sources:
#   - "git:https://github.com/my-corp/*"
#   - "git:https://github.com/anthropics/*"
#   - "registry:*"

# 5. 目标渠道限制（防范粗粒度广播扩散）
targets:
  broadcast:
    allow: false # 禁止企业内部向 ~/.agents/skills 广播
`;
}

/**
 * 读取策略文件的原始 YAML 内容与路径，未找到时返回 null
 */
export function readPolicyRaw(explicitPath?: string): { content: string; path: string } | null {
  const file = findPolicyFile(explicitPath);
  if (!file) return null;
  const content = fs.readFileSync(file, 'utf8');
  return { content, path: file };
}

/**
 * 保存原始 YAML 策略内容，保存前进行语法与基本结构校验
 */
export function savePolicyRaw(rawYaml: string, explicitPath?: string): { path: string } {
  let data: any;
  try {
    data = parse(rawYaml);
  } catch (e) {
    throw new Error(`YAML 语法错误：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('策略文件必须为有效的 YAML 对象');
  }

  if (data.version !== 1) {
    throw new Error(`不支持的策略文件版本：${data.version}（当前仅支持 version: 1）`);
  }

  const target = explicitPath
    ? path.resolve(process.cwd(), explicitPath)
    : (findPolicyFile() || path.join(process.cwd(), DEFAULT_POLICY_FILE));
  fs.writeFileSync(target, rawYaml, 'utf8');
  return { path: target };
}

/**
 * 初始化策略文件
 */
export function initPolicyFile(explicitPath?: string): { path: string; created: boolean } {
  const target = explicitPath ? path.resolve(process.cwd(), explicitPath) : path.join(process.cwd(), DEFAULT_POLICY_FILE);
  if (fs.existsSync(target)) {
    return { path: target, created: false };
  }
  fs.writeFileSync(target, generatePolicyTemplate(), 'utf8');
  return { path: target, created: true };
}

