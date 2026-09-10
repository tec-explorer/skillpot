import fs from 'node:fs';
import path from 'node:path';
import { agentHome, skillDir } from '../paths';
import { loadConfig, loadState, saveConfig, saveState } from './config';
import { BROADCAST_AGENT_ID, allAgentIds, allTargetIds, getAgent, isChannel } from '../agents/registry';
import { SkillPotConfig, SkillPotState } from '../types';
import { withLockSync } from '../util/fsx';

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

/**
 * 'a,b' 或 'all' -> 校验后的目标 id 列表。
 * `all` 展开为全部**具体 Agent**，不含通用广播渠道——广播是粗粒度渠道，
 * 一旦写入就无法按 Agent 单独关闭（`disable --for claude-code` 撤不掉它），
 * 若混入 all 会让矩阵"看起来关闭、实际仍可见"。要广播请显式写 broadcast。
 */
export function resolveAgentIds(spec: string): string[] {
  const raw = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length === 0) throw new Error('--for 不能为空');
  const out: string[] = [];
  for (const id of raw) {
    if (id === 'all') {
      out.push(...allAgentIds());
      continue;
    }
    if (!getAgent(id)) {
      throw new Error(`未知目标 '${id}'，可用：${allTargetIds().join(', ')} 或 all`);
    }
    out.push(id);
  }
  return [...new Set(out)];
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
  if (!agent) throw new Error(`未知目标 '${agentId}'`);
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

function safeReadlink(p: string): string {
  try {
    return fs.readlinkSync(p);
  } catch {
    return '?';
  }
}

function requireEntry(config: SkillPotConfig, skill: string) {
  const entry = config.skills[skill];
  if (!entry) {
    throw new Error(`config 中没有 skill '${skill}'，请先 skillpot add`);
  }
  return entry;
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** 把单个目标推到"开放"状态；返回 null 表示已达成，否则返回跳过原因 */
function enableOne(
  ctx: {
    config: SkillPotConfig;
    state: SkillPotState;
    entry: SkillPotConfig['skills'][string];
    skill: string;
    src: string;
    srcReal: string;
  },
  agentId: string,
): string | null {
  const { config, state, entry, skill, src, srcReal } = ctx;
  const target = linkTarget(agentId, skill);
  const kind = materializeOf(agentId);
  const existing = lstatOrNull(target);

  if (kind === 'copy') {
    if (existing) {
      if (ledgerHas(state, skill, agentId, target)) {
        // 已是本工具的副本：重新拷贝以刷新内容（enable 即同步）
        fs.rmSync(target, { recursive: true, force: true });
        copyInto(src, target);
        addLedger(state, skill, agentId, target, 'copy');
        entry.expose[agentId] = true;
        return null;
      }
      return `${target} 已存在真实${existing.isDirectory() ? '目录' : '文件'}（可能是同名 skill），拒绝覆盖`;
    }
    copyInto(src, target);
    addLedger(state, skill, agentId, target, 'copy');
    entry.expose[agentId] = true;
    return null;
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
        return null; // 已是期望状态，幂等
      }
      if (!resolved && ledgerHas(state, skill, agentId, target)) {
        // 我们自己的链接断了（如 store 曾被移动）：重建
        fs.rmSync(target);
        fs.symlinkSync(src, target, 'dir');
        addLedger(state, skill, agentId, target);
        entry.expose[agentId] = true;
        return null;
      }
      return `${target} 已被其他链接占用 -> ${safeReadlink(target)}`;
    }
    return `${target} 已存在真实${existing.isDirectory() ? '目录' : '文件'}（可能是同名 skill），拒绝覆盖`;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(src, target, 'dir');
  addLedger(state, skill, agentId, target);
  entry.expose[agentId] = true;
  return null;
}

/** 把单个目标撤到"关闭"状态；返回 null 表示已达成，否则返回跳过原因 */
function disableOne(
  ctx: {
    state: SkillPotState;
    entry: SkillPotConfig['skills'][string] | undefined;
    skill: string;
    srcReal: string | null;
  },
  agentId: string,
): string | null {
  const { state, entry, skill, srcReal } = ctx;
  const target = linkTarget(agentId, skill);
  const st = lstatOrNull(target);

  if (st) {
    // copy 副本：台账内即本工具创建，直接删除
    if (!st.isSymbolicLink() && ledgerHas(state, skill, agentId, target)) {
      fs.rmSync(target, { recursive: true, force: true });
      dropLedger(state, skill, agentId);
      if (entry) entry.expose[agentId] = false;
      return null;
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
        return null;
      }
      return `${target} 指向 ${safeReadlink(target)}，不属于本工具管理`;
    }
    return `${target} 是真实${st.isDirectory() ? '目录' : '文件'}，不是本工具创建的链接`;
  }

  dropLedger(state, skill, agentId);
  if (entry) entry.expose[agentId] = false;
  return null;
}

/**
 * enable：在指定目标的 skills 目录建立指向中央仓库的 symlink。
 * 只创建/接管本工具的链接；遇到真实同名目录（可能是用户自装的同名 skill）一律跳过并告警。
 * 单个目标失败（权限/IO）只影响该目标，其余目标与台账照常落盘。
 */
export function enableSkill(skill: string, agentIds: string[]): SyncResult {
  return withLockSync(() => {
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
    const ctx = { config, state, entry, skill, src, srcReal };

    for (const agentId of agentIds) {
      try {
        const reason = enableOne(ctx, agentId);
        if (reason) skipped.push({ agent: agentId, reason });
        else linked.push(agentId);
      } catch (e) {
        // 一个目标写失败（EACCES/EPERM/EEXIST…）不该丢掉此前所有目标的成果
        skipped.push({
          agent: agentId,
          reason: `建立链接失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    saveState(state);
    saveConfig(config);
    return { skill, linked, skipped };
  });
}

/**
 * disable：撤下 symlink。只动台账内或指向本仓库的链接；
 * 不存在的链接也视为已达成状态（清台账、记 expose=false）。
 */
export function disableSkill(skill: string, agentIds: string[]): SyncResult {
  return withLockSync(() => {
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
    const ctx = { state, entry, skill, srcReal };

    for (const agentId of agentIds) {
      try {
        const reason = disableOne(ctx, agentId);
        if (reason) skipped.push({ agent: agentId, reason });
        else linked.push(agentId);
      } catch (e) {
        skipped.push({
          agent: agentId,
          reason: `撤下链接失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    saveState(state);
    saveConfig(config);
    return { skill, linked, skipped };
  });
}

/** 台账中是否存在该 skill 的广播链接（含 0.11 及更早由 broadcast 命令写入的条目） */
function broadcastOn(skill: string, state = loadState()): boolean {
  return state.links.some((l) => l.skill === skill && l.agent === BROADCAST_AGENT_ID);
}

/**
 * 通用广播列的命令糖：等价于 enable/disable --for broadcast，
 * 目标目录是跨工具共享的 ~/.agents/skills（所有支持该约定的 Agent 可见，粗粒度）。
 */
export function broadcastSkill(skill: string, off = false): { changed: boolean; message: string } {
  if (off) {
    const was = broadcastOn(skill);
    const res = disableSkill(skill, [BROADCAST_AGENT_ID]);
    const reason = res.skipped[0]?.reason;
    if (reason) throw new Error(reason);
    return was
      ? { changed: true, message: `'${skill}' 已撤下广播（~/.agents/skills）` }
      : { changed: false, message: '广播目录中没有该 skill' };
  }

  if (!fs.existsSync(path.join(skillDir(skill), 'SKILL.md'))) {
    throw new Error(`中央仓库中找不到 skill '${skill}'（${skillDir(skill)}）`);
  }
  if (broadcastOn(skill)) {
    return { changed: false, message: `'${skill}' 已在广播中` };
  }
  const res = enableSkill(skill, [BROADCAST_AGENT_ID]);
  const reason = res.skipped[0]?.reason;
  if (reason) throw new Error(reason);
  return {
    changed: true,
    message: `'${skill}' 已广播到 ~/.agents/skills（所有支持该约定的 Agent 可见）`,
  };
}

/** 供 CLI/GUI 提示：该目标是否为粗粒度的跨工具共享渠道 */
export function isBroadcastTarget(agentId: string): boolean {
  return isChannel(agentId);
}
