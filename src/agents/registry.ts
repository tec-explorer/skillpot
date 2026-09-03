import path from 'node:path';
import { AgentAdapter } from '../types';

/**
 * A 档落地策略适配器：skill 以 symlink 暴露到各 Agent 的用户级 skills 目录。
 * M1 覆盖五家；Cursor / Qoder / MCP bridge（B/C 档）在 M2 扩展。
 * verified 字段记录该路径的确认依据，随 M0/M2 验证进展更新。
 */
export const AGENTS: AgentAdapter[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    binaries: ['claude'],
    fingerprints: (home) => [path.join(home, '.claude')],
    skillsDir: (home) => path.join(home, '.claude', 'skills'),
    verified: 'live：M0 symlink 探针经 claude -p 确认可被发现',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    binaries: ['zcode'],
    fingerprints: (home) => [path.join(home, '.zcode')],
    skillsDir: (home) => path.join(home, '.zcode', 'skills'),
    verified: '官方配置文档确认 ~/.zcode/skills 为用户级发现路径',
    note: 'ZCode 还读取 ~/.agents/skills 广播目录；SkillPot 默认不写入，避免破坏按 Agent 开关',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    binaries: ['codex'],
    fingerprints: (home) => [path.join(home, '.codex')],
    skillsDir: (home) => path.join(home, '.codex', 'skills'),
    verified: 'M0 已确认 ~/.codex/skills 使用相同 SKILL.md 规范（.system 内置样例）',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    binaries: ['opencode'],
    fingerprints: (home) => [
      path.join(home, '.config', 'opencode'),
      path.join(home, '.opencode'),
    ],
    skillsDir: (home) => path.join(home, '.config', 'opencode', 'skill'),
    verified: '官方文档路径，待实机确认',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    binaries: ['gemini'],
    fingerprints: (home) => [path.join(home, '.gemini')],
    skillsDir: (home) => path.join(home, '.gemini', 'skills'),
    verified: '官方支持 Agent Skills，待实机确认',
  },
];

export function getAgent(id: string): AgentAdapter | undefined {
  return AGENTS.find((a) => a.id === id);
}
