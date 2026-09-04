import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { marketCacheDir } from '../paths';
import { loadConfig, saveConfig } from './config';
import { readSkillMeta } from '../util/frontmatter';
import { addSkill, isGitSource, AddResult } from './add';
import { ConfigSource } from '../types';

const execFileP = promisify(execFile);

/** 内置官方源：Anthropic 官方技能库（skills/<name> 嵌套布局） */
export const OFFICIAL_URL = 'https://github.com/anthropics/skills.git';
const OFFICIAL: SourceInfo = {
  name: 'Anthropic 官方技能库',
  url: OFFICIAL_URL,
  builtin: true,
};

export interface SourceInfo {
  name: string;
  url: string;
  builtin: boolean;
}

/** 源列表 = 内置官方源 + config.yaml sources 段 */
export function listSources(): SourceInfo[] {
  const config = loadConfig();
  return [OFFICIAL, ...(config.sources ?? []).map((s) => ({ name: s.name ?? urlLabel(s.url), url: s.url, builtin: false }))];
}

function urlLabel(url: string): string {
  const tail = url.replace(/\.git$/, '').replace(/\/+$/, '');
  return tail.split('/').pop() ?? tail;
}

export function addSource(url: string, name?: string): SourceInfo {
  if (!isGitSource(url)) throw new Error(`不是合法的 git 地址：${url}`);
  if (url === OFFICIAL_URL) throw new Error('官方源已内置，无需添加');
  const config = loadConfig();
  config.sources = config.sources ?? [];
  if (config.sources.some((s) => s.url === url)) throw new Error(`源已存在：${url}`);
  const entry: ConfigSource = {
    url,
    name: name?.trim() || undefined,
    added_at: new Date().toISOString(),
  };
  config.sources.push(entry);
  saveConfig(config);
  return { name: entry.name ?? urlLabel(url), url, builtin: false };
}

export function removeSource(url: string): void {
  if (url === OFFICIAL_URL) throw new Error('内置源不可移除');
  const config = loadConfig();
  const before = (config.sources ?? []).length;
  config.sources = (config.sources ?? []).filter((s) => s.url !== url);
  if (config.sources.length === before) throw new Error(`源不存在：${url}`);
  saveConfig(config);
  // 缓存一并清理
  fs.rmSync(cacheDirFor(url), { recursive: true, force: true });
}

export interface MarketSkill {
  /** frontmatter name（缺省用目录名） */
  name: string;
  /** 仓库内相对路径（posix 分隔符），安装时作为 #subdir */
  subdir: string;
  description: string;
  installed: boolean;
}

export interface ScanResult {
  url: string;
  skills: MarketSkill[];
  /** 本次是否重新克隆（false = 命中磁盘缓存） */
  cloned: boolean;
}

const IGNORED = new Set(['.git', '.github', 'node_modules']);

function cacheDirFor(url: string): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  return path.join(marketCacheDir(), hash);
}

/**
 * 扫描一个 git 源里的全部 skill：
 * 浅克隆到 ~/.skillpot/cache/market/<hash>（有缓存则复用，refresh 强制重克隆），
 * 递归找出所有含 SKILL.md 的目录并读取 frontmatter。
 */
export async function scanSource(url: string, opts: { refresh?: boolean } = {}): Promise<ScanResult> {
  if (!isGitSource(url)) throw new Error(`不是合法的 git 地址：${url}`);
  const dir = cacheDirFor(url);
  let cloned = false;
  if (opts.refresh || !fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    // 先克隆到临时目录、成功后原子改名：中途失败/被杀不会留下"半截缓存"被误当有效
    const tmp = `${dir}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    try {
      await execFileP('git', ['clone', '--depth', '1', url, tmp], {
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      await fs.promises.rename(tmp, dir);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new Error(`克隆失败：${e instanceof Error ? e.message : String(e)}`);
    }
    cloned = true;
  }

  const config = loadConfig();
  const skills: MarketSkill[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || IGNORED.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (fs.existsSync(path.join(p, 'SKILL.md'))) {
        const meta = readSkillMeta(p);
        const name = String(meta?.name ?? e.name);
        skills.push({
          name,
          subdir: path.relative(dir, p).split(path.sep).join('/'),
          description: String(meta?.description ?? ''),
          installed: !!config.skills[name],
        });
      }
      walk(p);
    }
  };
  walk(dir);
  return { url, skills, cloned };
}

/** 从源安装指定子目录的 skill（等价 skillpot add <url>#<subdir>） */
export async function installFromMarket(
  url: string,
  subdir: string,
  opts: { name?: string; for?: string[] } = {},
): Promise<AddResult> {
  if (!subdir || subdir.includes('..') || subdir.startsWith('/')) {
    throw new Error(`非法子目录：${subdir}`);
  }
  return addSkill(`${url}#${subdir}`, { name: opts.name, for: opts.for });
}
