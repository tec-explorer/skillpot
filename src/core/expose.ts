import { BROADCAST_AGENT_ID } from '../agents/registry';
import { SkillEntry, SkillPotState } from '../types';

/**
 * "该 skill 是否对目标开放"的统一判定——矩阵/体检/审计/列表共用同一语义，避免各处口径不一。
 *
 * 通用广播列的特殊之处：0.11 及更早由 `skillpot broadcast` 写入的广播链接只落在台账里、
 * 没有登记 expose，因此该列额外以台账为准（否则老用户的广播会被误判为"已关闭但链接残留"）。
 */
export function isExposed(
  entry: SkillEntry | undefined,
  state: SkillPotState,
  skill: string,
  agentId: string,
): boolean {
  if (entry?.expose[agentId] === true) return true;
  if (agentId === BROADCAST_AGENT_ID) {
    return state.links.some((l) => l.skill === skill && l.agent === BROADCAST_AGENT_ID);
  }
  return false;
}

/**
 * 开放给哪些目标（CLI 列表 / 清单导出共用）：显式登记为 true 的照原样保留
 * （含历史或已移除的 id），再补齐由 isExposed 判定出的目标。
 */
export function exposedTargets(
  entry: SkillEntry,
  state: SkillPotState,
  skill: string,
  knownIds: string[],
): string[] {
  const ids = new Set<string>(
    Object.entries(entry.expose)
      .filter(([, on]) => on === true)
      .map(([id]) => id),
  );
  for (const id of knownIds) if (isExposed(entry, state, skill, id)) ids.add(id);
  return [...ids];
}
