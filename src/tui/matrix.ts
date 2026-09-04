import fs from 'node:fs';
import path from 'node:path';
import { agentHome, skillDir } from '../paths';
import { detectAll } from '../agents/detect';
import { loadConfig } from '../core/config';

export interface CellState {
  /** 开关矩阵声明：应对该 Agent 开放 */
  enabled: boolean;
  /** Agent 目录里实际存在同名条目 */
  actual: boolean;
  /** 实际条目是本工具创建、指向中央仓库的 symlink */
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

/**
 * 从 config + 各 Agent 目录现状推导矩阵（只读，不修改任何状态）。
 * agents 可传入预计算的检测结果（GUI 服务端会缓存，避免每次拉状态都 spawn 二进制探测）。
 */
export function deriveMatrix(agents?: MatrixAgent[]): Matrix {
  const config = loadConfig();
  const skills = Object.keys(config.skills).sort();
  const list =
    agents ??
    detectAll().map((r) => ({
      id: r.id,
      name: r.name,
      installed: r.installed,
      skillsDir: r.skillsDir,
    }));
  const cells: Record<string, Record<string, CellState>> = {};
  for (const s of skills) {
    cells[s] = {};
    for (const a of list) {
      const target = path.join(a.skillsDir, s);
      let actual = false;
      let managed = false;
      try {
        const st = fs.lstatSync(target);
        actual = true;
        managed = st.isSymbolicLink() && fs.realpathSync(target) === fs.realpathSync(skillDir(s));
      } catch {
        /* ENOENT：未暴露 */
      }
      cells[s][a.id] = {
        enabled: config.skills[s].expose[a.id] === true,
        actual,
        managed,
      };
    }
  }
  return { skills, agents: list, cells };
}
