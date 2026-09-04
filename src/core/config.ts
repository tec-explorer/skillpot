import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { SkillPotConfig, SkillPotState } from '../types';
import { configPath, skillpotHome, statePath, storeDir } from '../paths';

export function emptyConfig(): SkillPotConfig {
  return { version: 1, skills: {}, sources: [] };
}

export function loadConfig(): SkillPotConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return emptyConfig();
  const data = parse(fs.readFileSync(p, 'utf8')) as SkillPotConfig | null;
  if (!data || typeof data !== 'object') return emptyConfig();
  return {
    version: 1,
    skills: data.skills ?? {},
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
}

export function lockPath(): string {
  return path.join(skillpotHome(), 'skillspot.lock.json');
}

/** lockfile：安装内容的机器可读快照（来源 + checksum），随 config 变更自动刷新 */
export function writeLock(config: SkillPotConfig): void {
  const lock = {
    version: 1,
    generated_at: new Date().toISOString(),
    skills: Object.fromEntries(
      Object.entries(config.skills).map(([k, v]) => [
        k,
        { source: v.source, checksum: v.checksum, installed_at: v.installed_at },
      ]),
    ),
  };
  fs.writeFileSync(lockPath(), JSON.stringify(lock, null, 2) + '\n');
}

export function saveConfig(config: SkillPotConfig): void {
  fs.mkdirSync(skillpotHome(), { recursive: true });
  fs.writeFileSync(configPath(), stringify(config));
  writeLock(config);
}

export function emptyState(): SkillPotState {
  return { version: 1, links: [] };
}

export function loadState(): SkillPotState {
  const p = statePath();
  if (!fs.existsSync(p)) return emptyState();
  let data: SkillPotState;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8')) as SkillPotState;
  } catch {
    return emptyState();
  }
  return { version: 1, links: Array.isArray(data.links) ? data.links : [] };
}

export function saveState(state: SkillPotState): void {
  fs.mkdirSync(skillpotHome(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n');
}

/** 建立中央仓库骨架；幂等 */
export function initStore(): { created: boolean } {
  const existed = fs.existsSync(configPath());
  fs.mkdirSync(storeDir(), { recursive: true });
  if (!existed) saveConfig(emptyConfig());
  if (!fs.existsSync(statePath())) saveState(emptyState());
  return { created: !existed };
}
