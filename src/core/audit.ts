import fs from 'node:fs';
import path from 'node:path';
import { deriveMatrix } from '../tui/matrix';
import { loadConfig } from './config';
import { lintSkill, LintIssue } from './lint';
import { skillDir } from '../paths';

/**
 * 审计（产品计划 §9.4）：回答"每个 Agent 实际生效的 skill 及来源"，
 * 发现被绕过/遮蔽（外部同名条目）、未受管外部 skill、安全隐患与矩阵漂移。与 doctor 互补——
 * doctor 关心"不一致并修复"，audit 关心"实际生效视图 + 来源溯源 + 安全发现"。
 */

export interface AuditActiveEntry {
  skill: string;
  /** config 中记录的来源（git:<url>#subdir / local:<path> / adopt:<agent>:<path>） */
  source: string;
  /** 矩阵声明是否开放（受管链接存在但声明关闭 = 残留异常） */
  enabled: boolean;
}

export interface AuditExternalEntry {
  name: string;
  path: string;
}

export interface AuditFinding {
  level: 'error' | 'warn';
  agent: string;
  message: string;
}

export interface AgentAudit {
  agent: string;
  agentName: string;
  /** 实际生效的受管 skill（symlink 指向中央仓库） */
  active: AuditActiveEntry[];
  /** 实际存在但并非本工具创建的条目（外部同名占用 / 绕过管理未受管 skill） */
  external: AuditExternalEntry[];
  findings: AuditFinding[];
}

export interface AuditReport {
  agents: AgentAudit[];
  generatedAt: string;
}

export function runAudit(): AuditReport {
  const matrix = deriveMatrix();
  const config = loadConfig();
  const agents: AgentAudit[] = [];
  const lintCache = new Map<string, LintIssue[]>();

  const getIssues = (dir: string) => {
    if (!lintCache.has(dir)) {
      try {
        lintCache.set(dir, lintSkill(dir));
      } catch {
        lintCache.set(dir, []);
      }
    }
    return lintCache.get(dir)!;
  };


  for (const a of matrix.agents) {
    if (!a.installed) continue;
    const active: AuditActiveEntry[] = [];
    const external: AuditExternalEntry[] = [];
    const findings: AuditFinding[] = [];
    const seenNames = new Set<string>();

    // 1. 扫描中央仓库已登记的 skill 在该 Agent 下的状态
    for (const skill of matrix.skills) {
      const cs = matrix.cells[skill]?.[a.id];
      if (!cs) continue;
      seenNames.add(skill);

      if (cs.actual && cs.managed) {
        active.push({
          skill,
          source: config.skills[skill]?.source ?? '未登记（中央仓库存在但 config 缺失）',
          enabled: cs.enabled,
        });
        if (!cs.enabled) {
          findings.push({
            level: 'warn',
            agent: a.id,
            message: `'${skill}' 受管链接仍存在，但矩阵已声明关闭（disable 或 doctor --fix 可清理）`,
          });
        } else {
          // 生效中的 skill 存在 error 级缺陷 → 产生 error 级审计发现
          const issues = getIssues(skillDir(skill));
          const errors = issues.filter((i) => i.level === 'error');
          if (errors.length > 0) {
            findings.push({
              level: 'error',
              agent: a.id,
              message: `'${skill}' 当前对 ${a.id} 开放生效，但存在严重安全隐患（${errors.map((e) => e.message).join('; ')}）`,
            });
          }
        }
      } else if (cs.actual && !cs.managed) {
        external.push({ name: skill, path: `${a.skillsDir}/${skill}` });
        if (cs.enabled) {
          findings.push({
            level: 'error',
            agent: a.id,
            message: `'${skill}' 声明对 ${a.id} 开放，但该位置被外部同名条目占用——实际生效的不是中央仓库版本（可能被绕过/遮蔽）`,
          });
        } else {
          findings.push({
            level: 'warn',
            agent: a.id,
            message: `'${skill}' 存在外部同名条目（${a.skillsDir}/${skill}），非 SkillPot 纳管版本`,
          });
        }
      } else if (cs.enabled && !cs.actual) {
        findings.push({
          level: 'warn',
          agent: a.id,
          message: `'${skill}' 声明开放但链接缺失（漂移，doctor --fix 可重同步）`,
        });
      }
    }

    // 2. 全量物理目录扫描（Phase 2: 发现绕过 SkillPot 直接安装在 Agent 目录下的未受管条目）
    if (a.skillsDir && fs.existsSync(a.skillsDir)) {
      try {
        const physicalEntries = fs
          .readdirSync(a.skillsDir)
          .filter((name) => !['.DS_Store', '.git'].includes(name));

        for (const item of physicalEntries) {
          if (seenNames.has(item)) continue; // 已在上面登记检查过
          const fullPath = path.join(a.skillsDir, item);
          external.push({ name: item, path: fullPath });

          findings.push({
            level: 'warn',
            agent: a.id,
            message: `发现未受管外部 skill '${item}'（${fullPath}）——绕过 SkillPot，无法追踪来源与版本`,
          });

          // 对未受管外部 skill 进行安全体检
          if (fs.existsSync(path.join(fullPath, 'SKILL.md'))) {
            const issues = getIssues(fullPath);
            const errors = issues.filter((i) => i.level === 'error');
            if (errors.length > 0) {
              findings.push({
                level: 'error',
                agent: a.id,
                message: `外部未受管 skill '${item}' 存在严重安全隐患（${errors.map((e) => e.message).join('; ')}）`,
              });
            }
          }
        }
      } catch {
        /* 目录读取权限或不存在 */
      }
    }


    agents.push({
      agent: a.id,
      agentName: a.name,
      active,
      external,
      findings,
    });
  }

  return { agents, generatedAt: new Date().toISOString() };
}

