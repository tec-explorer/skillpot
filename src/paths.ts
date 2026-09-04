import os from 'node:os';
import path from 'node:path';

/** 中央仓库根目录。默认 ~/.skillpot，可用 SKILLPOT_HOME 覆盖（测试/多仓场景） */
export function skillpotHome(): string {
  return process.env.SKILLPOT_HOME || path.join(os.homedir(), '.skillpot');
}

/** Agent 配置所在的 HOME。默认真实 home，可用 SKILLPOT_AGENT_HOME 覆盖（沙箱测试） */
export function agentHome(): string {
  return process.env.SKILLPOT_AGENT_HOME || os.homedir();
}

export function storeDir(): string {
  return path.join(skillpotHome(), 'skills');
}

export function skillDir(name: string): string {
  return path.join(storeDir(), name);
}

export function configPath(): string {
  return path.join(skillpotHome(), 'config.yaml');
}

export function statePath(): string {
  return path.join(skillpotHome(), 'state.json');
}

/** 市场源的克隆缓存目录（~/.skillpot/cache/market/<url-hash>） */
export function marketCacheDir(): string {
  return path.join(skillpotHome(), 'cache', 'market');
}
