export interface SkillEntry {
  /** 来源：local:<绝对路径> 或 git:<url>#<subdir> */
  source: string;
  checksum: string;
  installed_at: string;
  /** agentId -> 是否开放（开关矩阵） */
  expose: Record<string, boolean>;
}

export interface SkillPotConfig {
  version: 1;
  skills: Record<string, SkillEntry>;
  /** 市场自定义源（git 仓库）；内置官方源不落盘 */
  sources?: ConfigSource[];
}

export interface ConfigSource {
  name?: string;
  url: string;
  added_at: string;
}

/** 本工具创建的链接台账：卸载/禁用只动台账内文件 */
export interface LedgerLink {
  skill: string;
  agent: string;
  link_path: string;
  /** 落地方式：symlink（默认）或 copy（B 档副本） */
  kind?: 'symlink' | 'copy';
}

export interface SkillPotState {
  version: 1;
  links: LedgerLink[];
}

/**
 * 发现路径的确认等级（如实标注，避免把未验证的能力呈现为确定能力）：
 * - live：实机实测确认 Agent 能发现 SkillPot 建立的链接
 * - docs：官方文档/规范确认路径，但未实机验证"链接能被发现"
 * - unverified：路径本身仍待确认
 */
export type VerifyLevel = 'live' | 'docs' | 'unverified';

export const VERIFY_LABELS: Record<VerifyLevel, string> = {
  live: '实测',
  docs: '文档确认',
  unverified: '未验证',
};

/**
 * 目标类型：
 * - agent：某个具体 Agent 的用户级 skills 目录（可精细开关）
 * - channel：跨工具共享目录 ~/.agents/skills（通用广播，对所有支持该约定的 Agent 可见）
 */
export type TargetKind = 'agent' | 'channel';

export interface AgentDetectResult {
  id: string;
  name: string;
  kind: TargetKind;
  installed: boolean;
  signals: string[];
  version: string | null;
  skillsDir: string;
  /** 实际落地方式（由适配器 materialize 决定） */
  strategy: 'symlink' | 'copy';
  /** 发现路径的确认等级 */
  verify: VerifyLevel;
  /** 确认依据（人类可读） */
  verified: string;
  note?: string;
}

export interface AgentAdapter {
  id: string;
  name: string;
  /** 缺省 agent（具体 Agent）；channel = 跨工具共享目录 */
  kind?: TargetKind;
  binaries: string[];
  fingerprints: (home: string) => string[];
  skillsDir: (home: string) => string;
  /** 发现路径的确认等级（缺省 unverified） */
  verify?: VerifyLevel;
  /** 确认依据（人类可读） */
  verified: string;
  note?: string;
  /** 落地方式：symlink（默认，即时生效）；copy = B 档副本（symlink 不被跟随的 Agent 用，enable 时重新拷贝刷新） */
  materialize?: 'symlink' | 'copy';
}

export interface Issue {
  level: 'error' | 'warn' | 'info';
  message: string;
  fix?: 'resync' | 'drop-ledger' | 'adopt';
}
