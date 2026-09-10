import fs from 'node:fs';
import path from 'node:path';
import { skillDir } from '../paths';
import { detectAll } from '../agents/detect';
import { loadConfig, loadState } from '../core/config';
import { isExposed } from '../core/expose';
import { TargetKind, VerifyLevel } from '../types';

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
  /** agent = 具体 Agent 目录；channel = 跨工具共享目录（通用广播） */
  kind: TargetKind;
  installed: boolean;
  skillsDir: string;
  /** 发现路径的确认等级（未验证的列在 UI 上如实标注） */
  verify: VerifyLevel;
}

export interface Matrix {
  skills: string[];
  agents: MatrixAgent[];
  cells: Record<string, Record<string, CellState>>;
}

/** 从 config + 各 Agent 目录现状推导矩阵（只读，不修改任何状态）。
 * agents 可传入预计算的检测结果（GUI 服务端会缓存，避免每次拉状态都 spawn 二进制探测）。
 */
export function deriveMatrix(agents?: MatrixAgent[]): Matrix {
  const config = loadConfig();
  const state = loadState();
  const skills = Object.keys(config.skills).sort();
  const list =
    agents ??
    detectAll().map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      installed: r.installed,
      skillsDir: r.skillsDir,
      verify: r.verify,
    }));
  const cells: Record<string, Record<string, CellState>> = {};
  const ledgeredCopy = (skill: string, agentId: string, target: string): boolean =>
    state.links.some(
      (l) =>
        l.skill === skill && l.agent === agentId && l.link_path === target && l.kind === 'copy',
    );
  for (const s of skills) {
    cells[s] = {};
    for (const a of list) {
      const target = path.join(a.skillsDir, s);
      let actual = false;
      let managed = false;
      try {
        const st = fs.lstatSync(target);
        actual = true;
        managed =
          ledgeredCopy(s, a.id, target) ||
          (st.isSymbolicLink() && fs.realpathSync(target) === fs.realpathSync(skillDir(s)));
      } catch {
        /* ENOENT：未暴露 */
      }
      cells[s][a.id] = {
        enabled: isExposed(config.skills[s], state, s, a.id),
        actual,
        managed,
      };
    }
  }
  return { skills, agents: list, cells };
}
