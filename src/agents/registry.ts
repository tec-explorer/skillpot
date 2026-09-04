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
  {
    id: 'dsh',
    name: 'DeepSeek CLI',
    binaries: ['dsh'],
    fingerprints: (home) => [path.join(home, '.dsh')],
    skillsDir: (home) => path.join(home, '.dsh', 'skills'),
    verified:
      '目录约定同 Claude（~/.dsh/skills + SKILL.md）；目录内已存在用户手工创建并日常使用的 symlink，间接佐证 symlink 可被发现；dsh CLI 本机损坏（@deepseek-ai/dsh 模块缺失），待重装后最终确认',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    binaries: ['cursor'],
    fingerprints: (home) => [path.join(home, '.cursor')],
    skillsDir: (home) => path.join(home, '.cursor', 'skills'),
    verified:
      '官方 create-skill 技能明确：个人技能目录为 ~/.cursor/skills/（项目为 .cursor/skills/）；symlink 发现任待实机确认',
  },
];

export function getAgent(id: string): AgentAdapter | undefined {
  return AGENTS.find((a) => a.id === id);
}
