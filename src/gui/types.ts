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
