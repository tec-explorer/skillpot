export interface CellState {
  enabled: boolean;
  actual: boolean;
  managed: boolean;
}

export interface MatrixAgent {
  id: string;
  name: string;
  installed: boolean;
  skillsDir: string;
}

export interface Matrix {
  skills: string[];
  agents: MatrixAgent[];
  cells: Record<string, Record<string, CellState>>;
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
