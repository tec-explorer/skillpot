import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentAdapter, AgentDetectResult } from '../types';
import { AGENTS } from './registry';
import { agentHome, skillpotHome } from '../paths';
import { VERSION } from '../version';

export interface DetectOptions {
  /** 强制忽略缓存重新探测 */
  refresh?: boolean;
  /** 完全不读写缓存 */
  noCache?: boolean;
}

export interface DetectCacheData {
  timestamp: number;
  ttl: number;
  version: string;
  results: AgentDetectResult[];
}

export const DETECT_CACHE_FILE = '.agents-cache.json';
export const DEFAULT_DETECT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

export function detectCachePath(): string {
  return path.join(skillpotHome(), DETECT_CACHE_FILE);
}

/** 清理检测缓存文件 */
export function clearDetectCache(): void {
  try {
    const file = detectCachePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // 忽略删除失败
  }
}

function findBinary(bin: string): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, bin);
    try {
      if (fs.statSync(full).isFile()) {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      }
    } catch {
      /* 继续扫描下一个 PATH 目录 */
    }
  }
  return null;
}

function binaryVersion(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (out.trim().split(/\r?\n/)[0] || '').slice(0, 48) || null;
  } catch {
    return null;
  }
}

function shorten(home: string, p: string): string {
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

/** 单个 Agent 检测：PATH 二进制 + 配置目录指纹两类信号；channel 类目标始终可用 */
export function detectAgent(adapter: AgentAdapter): AgentDetectResult {
  const home = agentHome();
  const isChannelTarget = adapter.kind === 'channel';
  const dir = adapter.skillsDir(home);
  const signals: string[] = [];
  // 渠道（~/.agents/skills）不是"装没装某个 Agent"，而是始终可写的共享通道
  let installed = isChannelTarget;
  let version: string | null = null;

  if (isChannelTarget) {
    signals.push('channel:跨工具共享目录');
    if (fs.existsSync(dir)) signals.push(`dir:${shorten(home, dir)}`);
  } else {
    for (const bin of adapter.binaries) {
      if (findBinary(bin)) {
        installed = true;
        signals.push(`binary:${bin}`);
        version = binaryVersion(bin);
        break;
      }
    }
    for (const fp of adapter.fingerprints(home)) {
      if (fs.existsSync(fp)) {
        installed = true;
        signals.push(`dir:${shorten(home, fp)}`);
      }
    }
    if (fs.existsSync(dir)) {
      installed = true;
      const shortDir = `dir:${shorten(home, dir)}`;
      if (!signals.includes(shortDir)) {
        signals.push(shortDir);
      }
    }
  }

  return {
    id: adapter.id,
    name: adapter.name,
    kind: adapter.kind ?? 'agent',
    installed,
    signals,
    version,
    skillsDir: dir,
    strategy: adapter.materialize ?? 'symlink',
    verify: adapter.verify ?? 'unverified',
    verified: adapter.verified,
    note: adapter.note,
  };
}

export function detectAll(options?: DetectOptions): AgentDetectResult[] {
  const shouldBypass = Boolean(
    options?.refresh ||
    options?.noCache ||
    process.env.SKILLPOT_NO_DETECT_CACHE === '1'
  );
  const cacheFile = detectCachePath();

  if (!shouldBypass) {
    try {
      if (fs.existsSync(cacheFile)) {
        const raw = fs.readFileSync(cacheFile, 'utf8');
        const data = JSON.parse(raw) as DetectCacheData;
        if (
          data &&
          typeof data === 'object' &&
          Array.isArray(data.results) &&
          data.version === VERSION &&
          Date.now() - data.timestamp < (data.ttl || DEFAULT_DETECT_CACHE_TTL_MS)
        ) {
          return data.results;
        }
      }
    } catch {
      // 缓存文件损坏或不可读，退回实时扫描
    }
  }

  const results = AGENTS.map(detectAgent);

  if (!options?.noCache && process.env.SKILLPOT_NO_DETECT_CACHE !== '1') {
    try {
      const cacheData: DetectCacheData = {
        timestamp: Date.now(),
        ttl: DEFAULT_DETECT_CACHE_TTL_MS,
        version: VERSION,
        results,
      };
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), 'utf8');
    } catch {
      // 写入缓存失败忽略
    }
  }

  return results;
}
