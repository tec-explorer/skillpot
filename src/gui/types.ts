export interface CellState {
  enabled: boolean;
  actual: boolean;
  managed: boolean;
}

export type VerifyLevel = 'live' | 'docs' | 'unverified';

export const VERIFY_LABEL: Record<VerifyLevel, string> = {
  live: '实测',
  docs: '文档确认',
  unverified: '未验证',
};

export interface MatrixAgent {
  id: string;
  name: string;
  /** agent = 具体 Agent 目录；channel = 跨工具共享目录（通用广播） */
  kind: 'agent' | 'channel';
  installed: boolean;
  skillsDir: string;
  /** 发现路径的确认等级（未验证的在表头如实标注） */
  verify: VerifyLevel;
}

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

export interface Matrix {
  skills: string[];
  agents: MatrixAgent[];
  cells: Record<string, Record<string, CellState>>;
  advisor?: Record<string, Record<string, SuitabilityAnalysis>>;
}

export interface SkillEntry {
  source: string;
  checksum: string;
  installed_at: string;
  expose: Record<string, boolean>;
}

export interface StateResp {
  version: string;
  skills: Record<string, SkillEntry>;
  matrix: Matrix;
}

export interface Issue {
  level: 'error' | 'warn' | 'info';
  message: string;
  fix?: 'resync' | 'drop-ledger' | 'adopt';
}

export interface ToggleResp {
  ok: boolean;
  message: string;
}

export interface LintIssue {
  level: 'error' | 'warn' | 'info';
  message: string;
}

export interface AddResult {
  name: string;
  description: string;
  checksum: string;
  source: string;
  lint: LintIssue[];
  enabled: string[];
  skipped: { agent: string; reason: string }[];
}

export interface AdoptScanItem {
  name: string;
  path: string;
  valid: boolean;
  inStore: boolean;
}

export interface AdoptAgent {
  id: string;
  name: string;
  skills: AdoptScanItem[];
}

export type AdoptStatus =
  | 'imported'
  | 'linked'
  | 'exists'
  | 'skipped-managed'
  | 'skipped-invalid'
  | 'dry-run';

export interface AdoptReport {
  items: { agent: string; name: string; path: string; status: AdoptStatus; detail?: string }[];
  imported: number;
  linked: number;
  exists: number;
  skipped: number;
}

export const ADOPT_STATUS_LABEL: Record<AdoptStatus, string> = {
  imported: '已导入',
  linked: '已链接(move)',
  exists: '同名跳过',
  'skipped-managed': '已受管',
  'skipped-invalid': '跳过',
  'dry-run': '待收编',
};

export interface SkillDetail {
  name: string;
  meta: { name?: string; description?: string } | null;
  files: string[];
  skillMd: string | null;
  lint: LintIssue[];
  agentSuitability?: Record<string, SuitabilityAnalysis>;
}

export interface MarketSkillPreview {
  name: string;
  subdir: string;
  url: string;
  description: string;
  meta: { name?: string; description?: string } | null;
  files: string[];
  skillMd: string | null;
  lint: LintIssue[];
  installed: boolean;
}

export type UpdateStatus = 'up-to-date' | 'outdated' | 'updated' | 'local' | 'error';

export interface UpdateDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

export interface UpdateResult {
  skill: string;
  status: UpdateStatus;
  detail?: string;
  diff?: UpdateDiff;
}

export const UPDATE_STATUS_LABEL: Record<UpdateStatus, string> = {
  'up-to-date': '＝ 已是最新',
  outdated: '↑ 有更新',
  updated: '✔ 已更新',
  local: '· 本地来源',
  error: '✗ 失败',
};

export interface SourceInfo {
  name: string;
  url: string;
  builtin: boolean;
}

export interface MarketSkill {
  name: string;
  subdir: string;
  description: string;
  installed: boolean;
}

export interface ManifestInspectItem {
  skill: string;
  source: string;
  checksum?: string;
  expose: Record<string, boolean>;
  installed: boolean;
  checksumMatch: boolean | null;
  storeMissing?: boolean;
  localOnly: boolean;
}

export interface ManifestInspect {
  file: string;
  skills: ManifestInspectItem[];
  warnings: string[];
}

export type SyncAction = 'install' | 'reinstall' | 'ok' | 'skip' | 'error';

export interface SyncItem {
  skill: string;
  action: SyncAction;
  dryRun?: boolean;
  detail?: string;
}

export const SYNC_ACTION_LABEL: Record<SyncAction, string> = {
  install: '安装',
  reinstall: '重装对齐',
  ok: '已一致',
  skip: '跳过',
  error: '失败',
};

export interface PolicyViolationView {
  type: string;
  severity: 'error' | 'warn';
  rule: string;
  skill?: string;
  target?: string;
  message: string;
}

export interface PolicyRuleItem {
  name?: string;
  source?: string;
  targets?: string[];
  pattern?: string;
  reason?: string;
  checksum?: string;
}

export interface PolicyObjectView {
  version: number;
  name?: string;
  mode?: 'strict' | 'audit';
  enforce?: PolicyRuleItem[];
  deny?: PolicyRuleItem[];
  allowed_sources?: string[];
  targets?: Record<string, { allow?: boolean }>;
  registry?: { endpoint?: string; url?: string; token_env?: string; force_private?: boolean };
}

export interface PolicyCheckResultView {
  compliant: boolean;
  file: string;
  policy: PolicyObjectView;
  enforcedCount: number;
  deniedCount: number;
  violations: PolicyViolationView[];
}

export interface RegistryStatusView {
  url: string;
  isPrivate: boolean;
  hasToken: boolean;
  tokenSource?: string;
  forcePrivate: boolean;
}

export interface PolicyStatusResp {
  hasPolicy: boolean;
  file: string | null;
  raw: string;
  policy: PolicyObjectView | null;
  checkResult: PolicyCheckResultView | null;
  registryStatus: RegistryStatusView;
}

export interface PolicyApplyActionView {
  action: 'installed' | 'enabled' | 'uninstalled' | 'disabled' | 'failed';
  skill: string;
  target?: string;
  detail: string;
}

export interface PolicyApplyResultView {
  actions: PolicyApplyActionView[];
  violationsRemaining: PolicyViolationView[];
}

