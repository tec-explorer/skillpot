import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { SkillPotConfig, SkillPotState } from '../types';
import { configPath, skillpotHome, statePath, storeDir } from '../paths';
import { writeFileAtomic } from '../util/fsx';

export function emptyConfig(): SkillPotConfig {
  return { version: 1, skills: {}, sources: [] };
}

export function loadConfig(): SkillPotConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return emptyConfig();
  let data: SkillPotConfig | null;
  try {
    data = parse(fs.readFileSync(p, 'utf8')) as SkillPotConfig | null;
  } catch (e) {
    // 不静默降级为空配置：那会让"矩阵声明"凭空消失、台账与目录随之失配
    throw new Error(
      `config.yaml 解析失败（${p}）：${e instanceof Error ? e.message : String(e)}。` +
        `请修复该文件（或从备份恢复）后重试`,
    );
  }
  if (!data || typeof data !== 'object') return emptyConfig();
  return {
    version: 1,
    skills: data.skills ?? {},
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
}

export function lockPath(): string {
  return path.join(skillpotHome(), 'skillpot.lock.json');
}

/** 0.11 及更早的 lockfile 名（拼写沿用了旧名 skillspot），改名后清理残留 */
function legacyLockPath(): string {
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
  writeFileAtomic(lockPath(), JSON.stringify(lock, null, 2) + '\n');
  try {
    fs.rmSync(legacyLockPath(), { force: true });
  } catch {
    /* 清不掉旧名文件不影响功能，只是留个冗余快照 */
  }
}

export function saveConfig(config: SkillPotConfig): void {
  fs.mkdirSync(skillpotHome(), { recursive: true });
  writeFileAtomic(configPath(), stringify(config));
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
    // 台账损坏时静默返回空台账会让既有链接变成"孤儿"、卸载失去依据；
    // 把坏文件留证并显式告知，比悄悄丢弃安全
    const quarantine = `${p}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(p, quarantine);
      console.error(
        `⚠ state.json 损坏，已移出为 ${quarantine} 并临时按空台账处理；` +
          `请运行 skillpot doctor 核对（受管链接会显示为孤儿链接）`,
      );
    } catch {
      /* 移不动就继续按空台账处理 */
    }
    return emptyState();
  }
  if (!data || typeof data !== 'object') return emptyState();
  return { version: 1, links: Array.isArray(data.links) ? data.links : [] };
}

export function saveState(state: SkillPotState): void {
  fs.mkdirSync(skillpotHome(), { recursive: true });
  writeFileAtomic(statePath(), JSON.stringify(state, null, 2) + '\n');
}

/** 建立中央仓库骨架；幂等 */
export function initStore(): { created: boolean } {
  const existed = fs.existsSync(configPath());
  fs.mkdirSync(storeDir(), { recursive: true });
  if (!existed) saveConfig(emptyConfig());
  if (!fs.existsSync(statePath())) saveState(emptyState());
  return { created: !existed };
}
