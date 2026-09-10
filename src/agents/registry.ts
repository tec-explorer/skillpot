import path from 'node:path';
import { AgentAdapter } from '../types';

/**
 * A 档落地策略适配器：skill 以 symlink 暴露到各 Agent 的用户级 skills 目录。
 * 最后一项是 channel（跨工具共享目录 ~/.agents/skills）——与 Agent 列同级的"通用广播"目标。
 * verify 记录发现路径的确认等级，verified 记录依据；两者都随验证进展更新，绝不把未验证呈现为已确认。
 */
export const BROADCAST_AGENT_ID = 'broadcast';

/** 通用广播渠道的 skills 目录（跨工具共享，Vercel skills CLI 与 ZCode 等原生读取） */
export function broadcastDir(home: string): string {
  return path.join(home, '.agents', 'skills');
}

export const AGENTS: AgentAdapter[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    binaries: ['claude'],
    fingerprints: (home) => [path.join(home, '.claude')],
    skillsDir: (home) => path.join(home, '.claude', 'skills'),
    verify: 'live',
    verified: 'live：M0 symlink 探针经 claude -p 确认可被发现',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    binaries: ['zcode'],
    fingerprints: (home) => [path.join(home, '.zcode')],
    skillsDir: (home) => path.join(home, '.zcode', 'skills'),
    verify: 'docs',
    verified: '官方配置文档确认 ~/.zcode/skills 为用户级发现路径（symlink 发现待实测）',
    note: 'ZCode 还读取 ~/.agents/skills 广播目录——该渠道已作为「通用广播」列纳入矩阵，需显式开放',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    binaries: ['codex'],
    fingerprints: (home) => [path.join(home, '.codex')],
    skillsDir: (home) => path.join(home, '.codex', 'skills'),
    verify: 'docs',
    verified: 'M0 已确认 ~/.codex/skills 使用相同 SKILL.md 规范（.system 内置样例）；symlink 发现待实测',
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
    verify: 'docs',
    verified: '官方文档确认 ~/.config/opencode/skill/（单数目录，兼容 SKILL.md 规范）；symlink 发现待实机确认',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    binaries: ['gemini'],
    fingerprints: (home) => [path.join(home, '.gemini')],
    skillsDir: (home) => path.join(home, '.gemini', 'skills'),
    verify: 'live',
    verified: 'Google Antigravity / Gemini CLI 实机探针确认：渐进式加载 SKILL.md frontmatter，会话可无缝触发',
  },
  {
    id: 'dsh',
    name: 'DeepSeek CLI',
    binaries: ['dsh'],
    fingerprints: (home) => [path.join(home, '.dsh')],
    skillsDir: (home) => path.join(home, '.dsh', 'skills'),
    verify: 'unverified',
    verified:
      '目录约定同 Claude（~/.dsh/skills + SKILL.md）；但 0.1.2-rc.1 代码未见 skills 读取逻辑（该目录的消费方待确认），纳管为前瞻性约定',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    binaries: ['cursor'],
    fingerprints: (home) => [path.join(home, '.cursor')],
    skillsDir: (home) => path.join(home, '.cursor', 'skills'),
    verify: 'docs',
    verified:
      '官方文档与 create-skill 规范确认 ~/.cursor/skills/（个人）与 .cursor/skills/（项目）；symlink 发现待实机确认',
  },
  {
    id: 'amp',
    name: 'Amp',
    binaries: ['amp'],
    fingerprints: (home) => [path.join(home, '.config', 'amp'), path.join(home, '.amp')],
    skillsDir: (home) => path.join(home, '.config', 'amp', 'skills'),
    verify: 'docs',
    verified: '官方规范公告确认 ~/.config/amp/skills/（用户级，多目录并读）；symlink 发现待实机确认',
  },
  {
    id: BROADCAST_AGENT_ID,
    name: '通用广播',
    kind: 'channel',
    binaries: [],
    fingerprints: (home) => [broadcastDir(home)],
    skillsDir: (home) => broadcastDir(home),
    verify: 'docs',
    verified:
      '约定确认：跨工具共享目录 ~/.agents/skills（Vercel skills CLI 的 universal 位置，ZCode/Amp/Codex/OpenCode 等原生读取）',
    note: '粗粒度渠道：放进去所有支持该约定的 Agent 都可见，且无法按 Agent 单独关闭——故不包含在 --for all 中，需显式开放',
  },
];

export function getAgent(id: string): AgentAdapter | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** 是否为跨工具共享渠道（通用广播），而非某个具体 Agent */
export function isChannel(id: string): boolean {
  return getAgent(id)?.kind === 'channel';
}

/** 具体 Agent 的 id 列表（不含通用广播渠道）——`--for all` 展开为此 */
export function allAgentIds(): string[] {
  return AGENTS.filter((a) => a.kind !== 'channel').map((a) => a.id);
}

/** 全部可选目标 id（含通用广播渠道）——仅用于错误提示与校验 */
export function allTargetIds(): string[] {
  return AGENTS.map((a) => a.id);
}
