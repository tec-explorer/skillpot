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
