import fs from 'node:fs';
import path from 'node:path';
import { skillpotHome } from '../paths';
import { VERSION } from '../version';

export interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@tec-explorer/skillpot/latest';

/**
 * 比较两 SemVer 版本号，判断 latest 是否高于 current
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((x) => parseInt(x, 10) || 0);
  const [cMaj, cMin, cPatch] = parse(current);
  const [lMaj, lMin, lPatch] = parse(latest);
  if (lMaj > cMaj) return true;
  if (lMaj < cMaj) return false;
  if (lMin > cMin) return true;
  if (lMin < cMin) return false;
  return lPatch > cPatch;
}

export function getUpdateCachePath(): string {
  return path.join(skillpotHome(), '.update-check.json');
}

/**
 * 从 npm registry 请求最新发布版本（带 800ms 严格超时，绝不阻塞网络）
 */
export async function fetchLatestNpmVersion(timeoutMs = 800): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检查是否有更新
 */
export async function checkUpdate(
  currentVersion = VERSION,
  opts: {
    cacheTtlMs?: number;
    fetcher?: () => Promise<string | null>;
  } = {},
): Promise<{ hasUpdate: boolean; latestVersion?: string }> {
  // CI 环境或显式禁用时跳过
  if (
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.NO_UPDATE_NOTIFIER ||
    process.env.SKILLPOT_NO_UPDATE_NOTIFIER
  ) {
    return { hasUpdate: false };
  }

  const cachePath = getUpdateCachePath();
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  let cached: UpdateCache | null = null;
  if (fs.existsSync(cachePath)) {
    try {
      cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch {
      // 忽略损坏缓存
    }
  }

  if (cached && now - cached.lastChecked < ttl && cached.latestVersion) {
    const hasUpdate = isNewerVersion(currentVersion, cached.latestVersion);
    return { hasUpdate, latestVersion: cached.latestVersion };
  }

  // 缓存过期或不存在，异步请求
  const fetcher = opts.fetcher ?? fetchLatestNpmVersion;
  const latest = await fetcher();

  if (latest) {
    try {
      const parent = path.dirname(cachePath);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ lastChecked: now, latestVersion: latest }), 'utf8');
    } catch {
      // 忽略写缓存失败
    }
    const hasUpdate = isNewerVersion(currentVersion, latest);
    return { hasUpdate, latestVersion: latest };
  }

  return { hasUpdate: false };
}

/**
 * 格式化更新提醒 Banner
 */
export function formatUpdateBanner(current: string, latest: string): string {
  const line1 = `Update available: ${current} → ${latest}`;
  const line2 = `Run npm i -g @tec-explorer/skillpot to update`;
  const contentWidth = Math.max(line1.length, line2.length);
  const pad = (s: string) => s + ' '.repeat(contentWidth - s.length);
  const border = '─'.repeat(contentWidth + 2);

  return [
    '',
    `╭${border}╮`,
    `│ ${pad(line1)} │`,
    `│ ${pad(line2)} │`,
    `╰${border}╯`,
    '',
  ].join('\n');
}

let pendingNotice: string | null = null;

/**
 * 初始化后台非阻塞更新检查
 */
export function initUpdateNotifier(currentVersion = VERSION): void {
  // 如果是 JSON 输出模式或非交互，不显示通知
  if (process.argv.includes('--json') || !process.stdout.isTTY) {
    return;
  }

  checkUpdate(currentVersion)
    .then((res) => {
      if (res.hasUpdate && res.latestVersion) {
        pendingNotice = formatUpdateBanner(currentVersion, res.latestVersion);
      }
    })
    .catch(() => {
      // 保持安静
    });

  process.on('beforeExit', () => {
    if (pendingNotice) {
      console.error(pendingNotice);
      pendingNotice = null;
    }
  });
}
