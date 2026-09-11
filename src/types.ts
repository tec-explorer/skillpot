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

/**
 * 企业/组织策略治理模型（Phase 4）
 */
export type PolicyMode = 'strict' | 'audit';

export interface EnforcedSkillRule {
  /** 强制技能名称 */
  name: string;
  /** 技能来源（git: 或 local: 或 registry:） */
  source: string;
  /** 可选版本校验和 */
  checksum?: string;
  /** 强制开放目标，如 all、或 claude-code,gemini-cli（缺省 all） */
  for?: string;
}

export interface DeniedSkillRule {
  /** 支持通配符匹配（如 *jailbreak*） */
  name?: string;
  /** 来源通配符匹配（如 *untrusted.org*） */
  source?: string;
  /** 精确 SHA256 哈希拉黑 */
  checksum?: string;
  /** 禁用理由说明 */
  reason?: string;
}

export interface RegistryPolicyConfig {
  /** 私有/企业 Registry 终端 URL（兼容 JFrog / Vercel skills.sh API 规范） */
  url?: string;
  /** 读取 token 的环境变量名称，如 CORP_SKILLS_TOKEN */
  token_env?: string;
  /** 直接配置 token（建议优先使用 token_env） */
  token?: string;
  /** 强制仅使用私有源，禁止回退公共 skills.sh */
  force_private?: boolean;
}

export interface TargetPolicyRule {
  /** 是否允许对该目标开放（如 broadcast: { allow: false } 严禁开放通用广播） */
  allow?: boolean;
}

export interface SkillPotPolicy {
  version: 1;
  name?: string;
  mode?: PolicyMode;
  registry?: RegistryPolicyConfig;
  /** 强制开启清单（合规基线） */
  enforce?: EnforcedSkillRule[];
  /** 组织禁用清单（黑名单） */
  deny?: DeniedSkillRule[];
  /** 允许的安装源白名单（前缀或通配符，如 git:https://github.com/my-corp/*） */
  allowed_sources?: string[];
  /** 目标渠道约束 */
  targets?: Record<string, TargetPolicyRule>;
}

export type PolicyViolationType =
  | 'enforce_missing'
  | 'enforce_not_exposed'
  | 'denied_installed'
  | 'denied_exposed'
  | 'disallowed_source'
  | 'target_disallowed';

export interface PolicyViolation {
  type: PolicyViolationType;
  severity: 'error' | 'warn';
  rule: string;
  skill?: string;
  target?: string;
  message: string;
}

export interface PolicyCheckResult {
  file: string;
  policy: SkillPotPolicy;
  compliant: boolean;
  violations: PolicyViolation[];
  enforcedCount: number;
  deniedCount: number;
}

export interface PolicyApplyAction {
  skill: string;
  action: 'installed' | 'exposed' | 'disabled' | 'uninstalled' | 'skipped' | 'failed';
  detail: string;
}

export interface PolicyApplyResult {
  file: string;
  actions: PolicyApplyAction[];
  violationsRemaining: PolicyViolation[];
}

export interface RegistryStatus {
  url: string;
  isPrivate: boolean;
  hasToken: boolean;
  tokenSource?: string;
  forcePrivate: boolean;
}

/**
 * Skill 与 Agent 适配度等级：
 * - recommended: 依赖满足、体量适中、契合 Agent 形态
 * - neutral: 通用辅助，体量正常，按需启用
 * - caution: 体量过大、广播渠道泛洪风险或 Agent 未验证/未安装
 * - incompatible: 缺少关键运行依赖或明确不兼容
 */
export type SuitabilityLevel = 'recommended' | 'neutral' | 'caution' | 'incompatible';

export interface SuitabilityAnalysis {
  level: SuitabilityLevel;
  score: number;
  summary: string;
  tokenCost: {
    tokens: number;
    level: 'light' | 'moderate' | 'heavy';
  };
  dependencies: {
    satisfied: string[];
    missing: string[];
  };
  reasons: {
    pros: string[];
    risks: string[];
  };
}
