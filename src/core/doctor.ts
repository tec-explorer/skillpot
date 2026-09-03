import fs from 'node:fs';
import path from 'node:path';
import { agentHome, skillDir, storeDir } from '../paths';
import { loadConfig, loadState, saveState } from './config';
import { enableSkill, disableSkill } from './sync';
import { AGENTS } from '../agents/registry';
import { Issue, SkillPotState } from '../types';

/**
 * 体检：config <-> 中央仓库 <-> 各 Agent 目录三方一致性。
 * 覆盖：仓库缺失/未登记、断链、台账漂移、孤儿链接、expose 漂移。
 */
export function runDoctor(): Issue[] {
  const issues: Issue[] = [];
  const config = loadConfig();
  const state = loadState();
  const home = agentHome();

  // 1. config <-> 中央仓库
  for (const [name, entry] of Object.entries(config.skills)) {
    if (!fs.existsSync(path.join(skillDir(name), 'SKILL.md'))) {
      issues.push({
        level: 'error',
        message: `config 中的 '${name}' 在中央仓库缺失（source=${entry.source}）`,
      });
    }
  }
  if (fs.existsSync(storeDir())) {
    for (const e of fs.readdirSync(storeDir(), { withFileTypes: true })) {
      if (
        e.isDirectory() &&
        !config.skills[e.name] &&
        fs.existsSync(path.join(storeDir(), e.name, 'SKILL.md'))
      ) {
        issues.push({
          level: 'warn',
          message: `中央仓库中的 '${e.name}' 未登记进 config（手动拷入？）`,
          fix: 'adopt',
        });
      }
    }
  }

  // 2. 台账健康
  for (const link of state.links) {
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(link.link_path);
    } catch {
      /* 缺失 */
    }
    if (!st) {
      issues.push({
        level: 'error',
        message: `断链：${link.link_path}（${link.skill} @ ${link.agent}）不存在`,
        fix: 'drop-ledger',
      });
      continue;
    }
    if (!st.isSymbolicLink()) {
      issues.push({
        level: 'error',
        message: `台账项 ${link.link_path} 已不是 symlink（被外部改动？）`,
      });
      continue;
    }
    if (!fs.existsSync(link.link_path)) {
      issues.push({
        level: 'error',
        message: `断链：${link.link_path} 指向的目标不存在`,
        fix: 'drop-ledger',
      });
    }
  }

  // 3. 孤儿链接：Agent 目录里指向中央仓库、但不在台账中的 symlink
  for (const agent of AGENTS) {
    const dir = agent.skillsDir(home);
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isSymbolicLink()) continue;
      const linkPath = path.join(dir, e.name);
      let target = '';
      try {
        target = fs.readlinkSync(linkPath);
      } catch {
        continue;
      }
      const ours = state.links.some((l) => l.link_path === linkPath);
      if (!ours && (target === skillDir(e.name) || sameRealPath(linkPath, skillDir(e.name)))) {
        issues.push({
          level: 'warn',
          message: `孤儿链接：${linkPath} 指向中央仓库但不在台账中`,
          fix: 'adopt',
        });
      }
    }
  }

  // 4. expose 漂移：config 声明与实际链接不一致
  for (const [name, entry] of Object.entries(config.skills)) {
    for (const agent of AGENTS) {
      const target = path.join(agent.skillsDir(home), name);
      const exposed = fs.existsSync(target);
      const wanted = entry.expose[agent.id] === true;
      if (wanted && !exposed) {
        issues.push({
          level: 'warn',
          message: `漂移：'${name}' 应对 ${agent.id} 开放但未建立链接（skillpot enable ${name} --for ${agent.id}）`,
          fix: 'resync',
        });
      } else if (!wanted && exposed && isOurSymlink(target, state, name, agent.id)) {
        issues.push({
          level: 'warn',
          message: `漂移：'${name}' 对 ${agent.id} 已关闭但链接仍在（skillpot disable ${name} --for ${agent.id}）`,
          fix: 'resync',
        });
      }
    }
  }

  return issues;
}

/** 自动修复：断链台账清理 + expose 漂移重同步；adopt 类问题需人工决定，仅保留提示 */
export function fixDoctor(): { fixed: string[]; remaining: Issue[] } {
  const fixed: string[] = [];
  const state = loadState();
  state.links = state.links.filter((l) => {
    let ok = false;
    try {
      ok = fs.existsSync(l.link_path) && fs.lstatSync(l.link_path).isSymbolicLink();
    } catch {
      ok = false;
    }
    if (!ok) {
      fixed.push(`清理断链台账：${l.link_path}`);
      return false;
    }
    return true;
  });
  saveState(state);

  const config = loadConfig();
  for (const [name, entry] of Object.entries(config.skills)) {
    if (!fs.existsSync(path.join(skillDir(name), 'SKILL.md'))) continue;
    for (const agent of AGENTS) {
      const target = path.join(agent.skillsDir(agentHome()), name);
      const exposed = fs.existsSync(target);
      const wanted = entry.expose[agent.id] === true;
      if (wanted && !exposed) {
        try {
          enableSkill(name, [agent.id]);
          fixed.push(`重同步 enable ${name} @ ${agent.id}`);
        } catch {
          /* 保持问题项可见 */
        }
      } else if (!wanted && exposed && isOurSymlink(target, loadState(), name, agent.id)) {
        try {
          disableSkill(name, [agent.id]);
          fixed.push(`重同步 disable ${name} @ ${agent.id}`);
        } catch {
          /* 保持问题项可见 */
        }
      }
    }
  }

  return { fixed, remaining: runDoctor() };
}

function isOurSymlink(target: string, state: SkillPotState, skill: string, agentId: string): boolean {
  let isLink = false;
  try {
    isLink = fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
  if (!isLink) return false;
  const inLedger = state.links.some(
    (l) => l.link_path === target && l.skill === skill && l.agent === agentId,
  );
  if (inLedger) return true;
  let real: string | null = null;
  try {
    real = fs.realpathSync(target);
  } catch {
    return false;
  }
  let storeReal: string | null = null;
  try {
    storeReal = fs.realpathSync(skillDir(skill));
  } catch {
    return false;
  }
  return real === storeReal;
}

function sameRealPath(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}
