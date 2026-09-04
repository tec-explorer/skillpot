import fs from 'node:fs';
import path from 'node:path';
import { agentHome, skillDir } from '../paths';
import { loadConfig, loadState, saveConfig, saveState } from './config';
import { AGENTS, getAgent } from '../agents/registry';
import { SkillPotConfig, SkillPotState } from '../types';

export interface SkippedItem {
  agent: string;
  reason: string;
}

export interface SyncResult {
  skill: string;
  /** 本次达成期望状态的 agent id */
  linked: string[];
  skipped: SkippedItem[];
}

/** 'a,b' 或 'all' -> 校验后的 agent id 列表 */
export function resolveAgentIds(spec: string): string[] {
  const ids = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new Error('--for 不能为空');
  if (ids.includes('all')) return AGENTS.map((a) => a.id);
  for (const id of ids) {
    if (!getAgent(id)) {
      throw new Error(`未知 agent '${id}'，可用：${AGENTS.map((a) => a.id).join(', ')} 或 all`);
    }
  }
  return ids;
}

function ledgerHas(state: SkillPotState, skill: string, agent: string, linkPath: string): boolean {
  return state.links.some(
    (l) => l.skill === skill && l.agent === agent && l.link_path === linkPath,
  );
}

function addLedger(
  state: SkillPotState,
  skill: string,
  agent: string,
  linkPath: string,
  kind: 'symlink' | 'copy' = 'symlink',
): void {
  if (!ledgerHas(state, skill, agent, linkPath)) {
    state.links.push({ skill, agent, link_path: linkPath, ...(kind === 'copy' ? { kind } : {}) });
  }
}

function dropLedger(state: SkillPotState, skill: string, agent: string): void {
  state.links = state.links.filter((l) => !(l.skill === skill && l.agent === agent));
}

function linkTarget(agentId: string, skill: string): string {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`未知 agent '${agentId}'`);
  return path.join(agent.skillsDir(agentHome()), skill);
}

function materializeOf(agentId: string): 'symlink' | 'copy' {
  return getAgent(agentId)?.materialize ?? 'symlink';
}

/** copy 档：把中央仓库内容拷贝到目标位置（B 档：Agent 不跟随 symlink 时的降级） */
function copyInto(src: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(src, target, { recursive: true, dereference: true });
}

/**
 * enable：在指定 Agent 的 skills 目录建立指向中央仓库的 symlink。
 * 只创建/接管本工具的链接；遇到真实同名目录（可能是用户自装的同名 skill）一律跳过并告警。
 */
export function enableSkill(skill: string, agentIds: string[]): SyncResult {
  const src = skillDir(skill);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    throw new Error(`中央仓库中找不到 skill '${skill}'（${src}）`);
  }
  const srcReal = fs.realpathSync(src);
  const config = loadConfig();
  const entry = requireEntry(config, skill);
  const state = loadState();
  const linked: string[] = [];
  const skipped: SkippedItem[] = [];

  for (const agentId of agentIds) {
    const target = linkTarget(agentId, skill);
    const kind = materializeOf(agentId);
    let existing: fs.Stats | null = null;
    try {
      existing = fs.lstatSync(target);
    } catch {
      /* ENOENT：正常路径 */
    }

    if (kind === 'copy') {
      if (existing) {
        if (ledgerHas(state, skill, agentId, target)) {
          // 已是本工具的副本：重新拷贝以刷新内容（enable 即同步）
          fs.rmSync(target, { recursive: true, force: true });
          copyInto(src, target);
          addLedger(state, skill, agentId, target, 'copy');
          entry.expose[agentId] = true;
          linked.push(agentId);
          continue;
        }
        skipped.push({
          agent: agentId,
          reason: `${target} 已存在真实${existing.isDirectory() ? '目录' : '文件'}（可能是同名 skill），拒绝覆盖`,
        });
        continue;
      }
      copyInto(src, target);
      addLedger(state, skill, agentId, target, 'copy');
      entry.expose[agentId] = true;
      linked.push(agentId);
      continue;
    }

    if (existing) {
      if (existing.isSymbolicLink()) {
        let resolved: string | null = null;
        try {
          resolved = fs.realpathSync(target);
        } catch {
          resolved = null; // 断链
        }
        if (resolved === srcReal) {
          addLedger(state, skill, agentId, target);
          entry.expose[agentId] = true;
          linked.push(agentId); // 已是期望状态，幂等
          continue;
        }
        if (!resolved && ledgerHas(state, skill, agentId, target)) {
          // 我们自己的链接断了（如 store 曾被移动）：重建
          fs.rmSync(target);
          fs.symlinkSync(src, target, 'dir');
          addLedger(state, skill, agentId, target);
          entry.expose[agentId] = true;
          linked.push(agentId);
          continue;
        }
        skipped.push({
          agent: agentId,
          reason: `${target} 已被其他链接占用 -> ${safeReadlink(target)}`,
        });
        continue;
      }
      skipped.push({
        agent: agentId,
        reason: `${target} 已存在真实${existing.isDirectory() ? '目录' : '文件'}（可能是同名 skill），拒绝覆盖`,
      });
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(src, target, 'dir');
    addLedger(state, skill, agentId, target);
    entry.expose[agentId] = true;
    linked.push(agentId);
  }

  saveState(state);
  saveConfig(config);
  return { skill, linked, skipped };
}

/**
 * disable：撤下 symlink。只动台账内或指向本仓库的链接；
 * 不存在的链接也视为已达成状态（清台账、记 expose=false）。
 */
export function disableSkill(skill: string, agentIds: string[]): SyncResult {
  const config = loadConfig();
  const entry = config.skills[skill];
  const state = loadState();
  const linked: string[] = [];
  const skipped: SkippedItem[] = [];
  let srcReal: string | null = null;
  try {
    srcReal = fs.realpathSync(skillDir(skill));
  } catch {
    /* store 可能已被删除 */
  }

  for (const agentId of agentIds) {
    const target = linkTarget(agentId, skill);
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(target);
    } catch {
      /* 不存在 */
    }

    if (st) {
      // copy 副本：台账内即本工具创建，直接删除
      if (!st.isSymbolicLink() && ledgerHas(state, skill, agentId, target)) {
        fs.rmSync(target, { recursive: true, force: true });
        dropLedger(state, skill, agentId);
        if (entry) entry.expose[agentId] = false;
        linked.push(agentId);
        continue;
      }
      if (st.isSymbolicLink()) {
        let pointsToStore = false;
        try {
          pointsToStore = !!srcReal && fs.realpathSync(target) === srcReal;
        } catch {
          pointsToStore = false;
        }
        if (pointsToStore || ledgerHas(state, skill, agentId, target)) {
          fs.rmSync(target);
          dropLedger(state, skill, agentId);
          if (entry) entry.expose[agentId] = false;
          linked.push(agentId);
          continue;
        }
        skipped.push({
          agent: agentId,
          reason: `${target} 指向 ${safeReadlink(target)}，不属于本工具管理`,
        });
        continue;
      }
      skipped.push({
        agent: agentId,
        reason: `${target} 是真实${st.isDirectory() ? '目录' : '文件'}，不是本工具创建的链接`,
      });
      continue;
    }

    dropLedger(state, skill, agentId);
    if (entry) entry.expose[agentId] = false;
    linked.push(agentId);
  }

  saveState(state);
  saveConfig(config);
  return { skill, linked, skipped };
}

function requireEntry(config: SkillPotConfig, skill: string) {
  const entry = config.skills[skill];
  if (!entry) {
    throw new Error(`config 中没有 skill '${skill}'，请先 skillpot add`);
  }
  return entry;
}

function safeReadlink(p: string): string {
  try {
    return fs.readlinkSync(p);
  } catch {
    return '?';
  }
}

/**
 * 广播模式（产品计划 §4）：把 skill 放进跨工具共享目录 ~/.agents/skills/，
 * 所有支持该约定的 Agent 都可见——粗粒度，无法按 Agent 单独关闭，故仅显式使用。
 */
export function broadcastSkill(skill: string, off = false): { changed: boolean; message: string } {
  const src = skillDir(skill);
  const state = loadState();
  const target = path.join(agentHome(), '.agents', 'skills', skill);

  if (off) {
    if (!fs.existsSync(src)) throw new Error(`中央仓库中找不到 skill '${skill}'`);
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(target);
    } catch {
      /* 不存在 */
    }
    let pointsToStore = false;
    if (st?.isSymbolicLink()) {
      try {
        pointsToStore = fs.realpathSync(target) === fs.realpathSync(src);
      } catch {
        pointsToStore = false;
      }
    }
    if (st && (pointsToStore || ledgerHas(state, skill, 'broadcast', target))) {
      fs.rmSync(target, { recursive: true, force: true });
      dropLedger(state, skill, 'broadcast');
      saveState(state);
      return { changed: true, message: `'${skill}' 已撤下广播（~/.agents/skills）` };
    }
    return { changed: false, message: '广播目录中没有该 skill' };
  }

  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    throw new Error(`中央仓库中找不到 skill '${skill}'（${src}）`);
  }
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(target);
  } catch {
    /* 不存在 */
  }
  if (st) {
    let pointsToStore = false;
    if (st.isSymbolicLink()) {
      try {
        pointsToStore = fs.realpathSync(target) === fs.realpathSync(src);
      } catch {
        pointsToStore = false;
      }
    }
    if (pointsToStore || ledgerHas(state, skill, 'broadcast', target)) {
      return { changed: false, message: `'${skill}' 已在广播中` };
    }
    throw new Error(`${target} 已存在且非本工具创建的广播链接，拒绝覆盖`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(src, target, 'dir');
  addLedger(state, skill, 'broadcast', target);
  saveState(state);
  return { changed: true, message: `'${skill}' 已广播到 ~/.agents/skills（所有支持该约定的 Agent 可见）` };
}
