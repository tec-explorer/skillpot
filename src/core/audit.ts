import { deriveMatrix } from '../tui/matrix';
import { loadConfig } from './config';

/**
 * 审计（产品计划 §9.4）：回答"每个 Agent 实际生效的 skill 及来源"，
 * 发现被绕过/遮蔽（外部同名条目）与矩阵漂移。与 doctor 互补——
 * doctor 关心"不一致并修复"，audit 关心"实际生效视图 + 来源溯源"。
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
  /** 实际存在但并非本工具创建的同名条目（外部 skill / 被绕过） */
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

  for (const a of matrix.agents) {
    if (!a.installed) continue;
    const active: AuditActiveEntry[] = [];
    const external: AuditExternalEntry[] = [];
    const findings: AuditFinding[] = [];

    for (const skill of matrix.skills) {
      const cs = matrix.cells[skill]?.[a.id];
      if (!cs) continue;
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
        }
      } else if (cs.actual && !cs.managed) {
        external.push({ name: skill, path: `${a.skillsDir}/${skill}` });
        if (cs.enabled) {
          findings.push({
            level: 'error',
            agent: a.id,
            message: `'${skill}' 声明对 ${a.id} 开放，但该位置被外部同名条目占用——实际生效的不是中央仓库版本（可能被绕过/遮蔽）`,
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
