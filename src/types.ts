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

export interface AgentDetectResult {
  id: string;
  name: string;
  installed: boolean;
  signals: string[];
  version: string | null;
  skillsDir: string;
  strategy: string;
  verified: string;
  note?: string;
}

export interface AgentAdapter {
  id: string;
  name: string;
  binaries: string[];
  fingerprints: (home: string) => string[];
  skillsDir: (home: string) => string;
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
