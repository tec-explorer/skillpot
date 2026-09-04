import fs from 'node:fs';
import path from 'node:path';
import { agentHome, skillDir, storeDir } from '../paths';
import { detectAll } from '../agents/detect';
import { getAgent } from '../agents/registry';
import { loadConfig, saveConfig } from './config';
import { installFromLocal } from './store';
import { enableSkill } from './sync';
import { sanitizeSkillName } from '../util/frontmatter';

export type AdoptStatus =
  | 'imported'
  | 'linked'
  | 'exists'
  | 'skipped-managed'
  | 'skipped-invalid'
  | 'dry-run';

export interface AdoptItem {
  agent: string;
  name: string;
  path: string;
  status: AdoptStatus;
  detail?: string;
}

export interface AdoptReport {
  items: AdoptItem[];
  imported: number;
  /** move 模式下：已有同名 skill 的 Agent 目录被替换为 symlink 的数量 */
  linked: number;
  exists: number;
  skipped: number;
}

/** 该目录是否是本工具创建、指向中央仓库的 symlink（已被管理，不再收编） */
export function isManagedByStore(dir: string): boolean {
  try {
    if (!fs.lstatSync(dir).isSymbolicLink()) return false;
    const real = fs.realpathSync(dir);
    const storeReal = fs.realpathSync(storeDir());
    return real === storeReal || real.startsWith(storeReal + path.sep);
  } catch {
    return false;
  }
}

/** 扫描某个 Agent 用户级 skills 目录下的合法 skill（含指向目录的 symlink） */
export function scanAgentSkills(agentId: string): { name: string; path: string }[] {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`未知 agent '${agentId}'`);
  const dir = agent.skillsDir(agentHome());
  if (!fs.existsSync(dir)) return [];
  const out: { name: string; path: string }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (!fs.existsSync(path.join(p, 'SKILL.md'))) continue;
    out.push({ name: e.name, path: p });
  }
  return out;
}

/** 可收编的 skill：真实目录（排除一切 symlink——受管的已管理，外部的不动） */
export function scanAdoptable(agentId: string): { name: string; path: string }[] {
  return scanAgentSkills(agentId).filter((s) => {
    try {
      return !fs.lstatSync(s.path).isSymbolicLink();
    } catch {
      return false;
    }
  });
}

export interface AdoptOptions {
  /** 只扫描指定 agent；缺省 = 全部已检测安装的 agent */
  from?: string[];
  /** 导入后开放给哪些 agent（resolveAgentIds 的结果） */
  enableFor?: string[];
  /** 移动模式：导入（或已有同名）后，把来源 Agent 目录下的原目录替换为指向中央仓库的 symlink */
  move?: boolean;
  dryRun?: boolean;
  /** 只处理这些 (agent, name) 组合（GUI 勾选式收编）；缺省 = 扫描到的全部 */
  only?: { agent: string; name: string }[];
}

/**
 * 收编：把各 Agent 目录下已有的 skill 拷贝进中央仓库并登记。
 * - 本工具管理的 symlink、同名冲突（非 move）、外部 symlink、非法目录一律跳过并报告；
 * - move 模式在内容安全落库后才替换原目录，且分两阶段执行（先统一落盘 config，再建链接）。
 */
export function adoptSkills(opts: AdoptOptions = {}): AdoptReport {
  const agentIds = opts.from ?? detectAll().filter((r) => r.installed).map((r) => r.id);
  for (const id of agentIds) {
    if (!getAgent(id)) throw new Error(`未知 agent '${id}'`);
  }
  const config = loadConfig();
  const pickSet = opts.only
    ? new Set(opts.only.map((o) => `${o.agent}\u0000${o.name}`))
    : null;
  const items: AdoptItem[] = [];
  const importedNames: string[] = [];
  /** move 模式下待替换的来源目录（内容已确认在仓库后统一处理） */
  const pendingMoves: { agentId: string; name: string; path: string; existed: boolean }[] = [];

  for (const agentId of agentIds) {
    let found: { name: string; path: string }[];
    try {
      found = scanAgentSkills(agentId);
    } catch {
      continue;
    }
    for (const skill of found) {
      if (pickSet && !pickSet.has(`${agentId}\u0000${skill.name}`)) continue;
      if (isManagedByStore(skill.path)) {
        items.push({ agent: agentId, name: skill.name, path: skill.path, status: 'skipped-managed' });
        continue;
      }
      let isOwnSymlink = false;
      try {
        isOwnSymlink = fs.lstatSync(skill.path).isSymbolicLink();
      } catch {
        /* 已在上面 existsSync 把过关 */
      }
      if (isOwnSymlink) {
        items.push({
          agent: agentId,
          name: skill.name,
          path: skill.path,
          status: 'skipped-invalid',
          detail: '外部 symlink，跳过（避免拷入链接）',
        });
        continue;
      }
      let name: string;
      try {
        name = sanitizeSkillName(skill.name);
      } catch {
        items.push({ agent: agentId, name: skill.name, path: skill.path, status: 'skipped-invalid', detail: '目录名不合法' });
        continue;
      }
      const existsInStore = !!config.skills[name] || fs.existsSync(skillDir(name));

      if (opts.dryRun) {
        items.push({
          agent: agentId,
          name,
          path: skill.path,
          status: existsInStore ? 'exists' : 'dry-run',
          detail: existsInStore && opts.move ? 'move：将把本 Agent 目录替换为 symlink' : undefined,
        });
        continue;
      }

      if (existsInStore) {
        if (opts.move) {
          pendingMoves.push({ agentId, name, path: skill.path, existed: true });
        } else {
          items.push({ agent: agentId, name, path: skill.path, status: 'exists', detail: '中央仓库已有同名 skill' });
        }
        continue;
      }

      try {
        const res = installFromLocal(skill.path, name);
        config.skills[name] = {
          source: `adopt:${agentId}:${skill.path}`,
          checksum: res.checksum,
          installed_at: new Date().toISOString(),
          expose: {},
        };
        importedNames.push(name);
        if (opts.move) {
          pendingMoves.push({ agentId, name, path: skill.path, existed: false });
        } else {
          items.push({ agent: agentId, name, path: skill.path, status: 'imported' });
        }
      } catch (e) {
        items.push({
          agent: agentId,
          name,
          path: skill.path,
          status: 'skipped-invalid',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (opts.dryRun) {
    const imported = items.filter((i) => i.status === 'dry-run').length;
    return {
      items,
      imported,
      linked: 0,
      exists: items.filter((i) => i.status === 'exists').length,
      skipped: items.filter((i) => i.status.startsWith('skipped')).length,
    };
  }

  // enableSkill 从磁盘重读 config，必须先把导入结果落盘
  saveConfig(config);

  // move：内容已安全落库，现在替换来源目录为 symlink（enableSkill 同时登记台账与 expose）
  for (const mv of pendingMoves) {
    try {
      fs.rmSync(mv.path, { recursive: true, force: true });
      enableSkill(mv.name, [mv.agentId]);
      items.push({
        agent: mv.agentId,
        name: mv.name,
        path: mv.path,
        status: mv.existed ? 'linked' : 'imported',
        detail: '原目录已替换为 symlink',
      });
    } catch (e) {
      items.push({
        agent: mv.agentId,
        name: mv.name,
        path: mv.path,
        status: 'skipped-invalid',
        detail: `移动失败（内容已入仓库，可手动 skillpot enable）：${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  if (opts.enableFor && opts.enableFor.length) {
    for (const name of importedNames) {
      try {
        enableSkill(name, opts.enableFor);
      } catch {
        /* 冲突已由 enable 内部跳过并告警 */
      }
    }
  }

  const imported = items.filter((i) => i.status === 'imported').length;
  const linked = items.filter((i) => i.status === 'linked').length;
  const exists = items.filter((i) => i.status === 'exists').length;
  const skipped = items.filter((i) => i.status.startsWith('skipped')).length;
  return { items, imported, linked, exists, skipped };
}
