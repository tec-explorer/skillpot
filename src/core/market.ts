import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { marketCacheDir, skillDir } from '../paths';
import { loadConfig, saveConfig } from './config';
import { readSkillMeta, SkillMeta } from '../util/frontmatter';
import { addSkill, isGitSource, AddResult } from './add';
import { ConfigSource, RegistryStatus, SkillPotPolicy } from '../types';
import { withLockSync } from '../util/fsx';
import { lintSkill } from './lint';

const execFileP = promisify(execFile);

/** 内置官方源：Anthropic 官方技能库（skills/<name> 嵌套布局） */
export const OFFICIAL_URL = 'https://github.com/anthropics/skills.git';

/** 内置源（不落盘、不可移除）：官方 + 社区权威技能集 */
export const BUILTIN_SOURCES: SourceInfo[] = [
  { name: 'Anthropic 官方技能库', url: OFFICIAL_URL, builtin: true },
  { name: 'Vercel 官方技能集', url: 'https://github.com/vercel-labs/agent-skills.git', builtin: true },
  { name: 'Superpowers 社区技能集', url: 'https://github.com/obra/superpowers.git', builtin: true },
  { name: 'Matt Pocock 技能集', url: 'https://github.com/mattpocock/skills.git', builtin: true },
];

export interface SourceInfo {
  name: string;
  url: string;
  builtin: boolean;
}

/** 源列表 = 内置源 + config.yaml sources 段 */
export function listSources(): SourceInfo[] {
  const config = loadConfig();
  const custom: SourceInfo[] = (config.sources ?? []).map((s) => ({
    name: s.name ?? urlLabel(s.url),
    url: s.url,
    builtin: false,
  }));
  return [...BUILTIN_SOURCES, ...custom];
}

function urlLabel(url: string): string {
  const tail = url.replace(/\.git$/, '').replace(/\/+$/, '');
  return tail.split('/').pop() ?? tail;
}

export function addSource(url: string, name?: string): SourceInfo {
  if (!isGitSource(url)) throw new Error(`不是合法的 git 地址：${url}`);
  if (BUILTIN_SOURCES.some((s) => s.url === url)) throw new Error('内置源已存在，无需添加');
  return withLockSync(() => {
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
  });
}

export function removeSource(url: string): void {
  if (BUILTIN_SOURCES.some((s) => s.url === url)) throw new Error('内置源不可移除');
  withLockSync(() => {
    const config = loadConfig();
    const before = (config.sources ?? []).length;
    config.sources = (config.sources ?? []).filter((s) => s.url !== url);
    if (config.sources.length === before) throw new Error(`源不存在：${url}`);
    saveConfig(config);
  });
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
  opts: { name?: string; for?: string[]; force?: boolean } = {},
): Promise<AddResult> {
  if (!subdir || subdir.includes('..') || subdir.startsWith('/')) {
    throw new Error(`非法子目录：${subdir}`);
  }
  return addSkill(`${url}#${subdir}`, { name: opts.name, for: opts.for, force: opts.force });
}

export interface MarketSkillPreview {
  name: string;
  subdir: string;
  url: string;
  description: string;
  meta: SkillMeta | null;
  files: string[];
  skillMd: string | null;
  lint: ReturnType<typeof lintSkill>;
  installed: boolean;
}

/**
 * 预览市场源中指定子目录的 skill（SKILL.md 全文、提示词、文件树、静态安全扫描结果）
 */
export function previewMarketSkill(url: string, subdir: string): MarketSkillPreview | null {
  if (!subdir || subdir.includes('..') || subdir.startsWith('/')) {
    throw new Error(`非法子目录：${subdir}`);
  }
  const dir = cacheDirFor(url);
  const targetDir = path.join(dir, subdir);
  const mdPath = path.join(targetDir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return null;

  const meta = readSkillMeta(targetDir);
  let skillMd: string;
  try {
    skillMd = fs.readFileSync(mdPath, 'utf8');
  } catch {
    return null;
  }

  const files: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || IGNORED.has(ent.name)) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        files.push(path.relative(targetDir, full) + '/');
        walk(full);
      } else {
        files.push(path.relative(targetDir, full));
      }
    }
  };
  walk(targetDir);

  const name = String(meta?.name ?? path.basename(subdir));
  const config = loadConfig();
  const installed = !!config.skills[name] || fs.existsSync(skillDir(name));

  return {
    name,
    subdir,
    url,
    description: meta?.description ?? '',
    meta,
    files: files.sort(),
    skillMd,
    lint: lintSkill(targetDir),
    installed,
  };
}


// —— Registry 目录（默认公共 skills.sh，支持企业/私有 Registry 如 JFrog 与 Vercel SKILLS_API_URL）——

export interface DirectorySkill {
  /** 形如 owner/repo/slug */
  id: string;
  name: string;
  /** owner/repo */
  source: string;
  installs: number;
}

export interface ResolvedRegistryConfig {
  url: string;
  token?: string;
  tokenSource?: string;
  isPrivate: boolean;
  forcePrivate: boolean;
}

/**
 * 解析当前生效的 Registry 终端与认证 Token
 * 优先级：策略文件配置 > 环境变量 SKILLPOT_REGISTRY_URL > 环境变量 SKILLS_API_URL > 默认 https://skills.sh
 */
export function resolveRegistryConfig(policy?: SkillPotPolicy | null): ResolvedRegistryConfig {
  let url = 'https://skills.sh';
  let isPrivate = false;
  let forcePrivate = Boolean(policy?.registry?.force_private);

  if (policy?.registry?.url) {
    url = policy.registry.url.replace(/\/+$/, '');
    isPrivate = true;
  } else if (process.env.SKILLPOT_REGISTRY_URL) {
    url = process.env.SKILLPOT_REGISTRY_URL.replace(/\/+$/, '');
    isPrivate = true;
  } else if (process.env.SKILLS_API_URL) {
    url = process.env.SKILLS_API_URL.replace(/\/+$/, '');
    isPrivate = true;
  }

  let token: string | undefined;
  let tokenSource: string | undefined;

  if (policy?.registry?.token_env && process.env[policy.registry.token_env]) {
    token = process.env[policy.registry.token_env];
    tokenSource = `env:${policy.registry.token_env}`;
  } else if (policy?.registry?.token) {
    token = policy.registry.token;
    tokenSource = 'policy:token';
  } else if (process.env.SKILLPOT_REGISTRY_TOKEN) {
    token = process.env.SKILLPOT_REGISTRY_TOKEN;
    tokenSource = 'env:SKILLPOT_REGISTRY_TOKEN';
  } else if (process.env.SKILLS_TOKEN) {
    token = process.env.SKILLS_TOKEN;
    tokenSource = 'env:SKILLS_TOKEN';
  }

  return { url, token, tokenSource, isPrivate, forcePrivate };
}

/** 获取 Registry 当前状态信息 */
export function getRegistryStatus(policy?: SkillPotPolicy | null): RegistryStatus {
  const cfg = resolveRegistryConfig(policy);
  return {
    url: cfg.url,
    isPrivate: cfg.isPrivate,
    hasToken: Boolean(cfg.token),
    tokenSource: cfg.tokenSource,
    forcePrivate: cfg.forcePrivate,
  };
}

/** 在 Registry 目录中搜索 skill（支持私有 Registry 认证） */
export async function searchDirectory(
  query: string,
  limit = 20,
  opts: { policy?: SkillPotPolicy | null } = {},
): Promise<DirectorySkill[]> {
  const q = query.trim();
  if (!q) throw new Error('搜索词不能为空');

  const cfg = resolveRegistryConfig(opts.policy);
  if (cfg.forcePrivate && !cfg.isPrivate) {
    throw new Error('策略已开启 force_private，禁止访问公共 skills.sh 目录；请配置企业私有 Registry');
  }

  const endpoint = `${cfg.url}/api/search?q=${encodeURIComponent(q)}&limit=${Math.min(Math.max(limit, 1), 200)}`;
  const headers: Record<string, string> = {};
  if (cfg.token) {
    headers['Authorization'] = `Bearer ${cfg.token}`;
  }

  const res = await fetch(endpoint, { headers });
  if (!res.ok) throw new Error(`Registry 搜索失败 (${cfg.url})：HTTP ${res.status}`);
  const data = (await res.json()) as {
    skills?: { id?: string; name?: string; installs?: number; source?: string }[];
  };
  return (data.skills ?? [])
    .filter((s) => s.id && s.source)
    .map((s) => ({
      id: s.id!,
      name: s.name ?? s.id!,
      source: s.source!,
      installs: s.installs ?? 0,
    }));
}

/** 从目录 id（owner/repo/slug）解析仓库内子目录：克隆缓存后按 frontmatter name 或目录名匹配 */
export async function resolveDirectorySkill(
  id: string,
): Promise<{ repoUrl: string; subdir: string }> {
  const parts = id.split('/').filter(Boolean);
  if (parts.length < 3) throw new Error(`id 形如 owner/repo/slug：${id}`);
  const source = parts.slice(0, 2).join('/');
  const slug = parts.slice(2).join('/').toLowerCase();
  const repoUrl = `https://github.com/${source}.git`;
  const { skills } = await scanSource(repoUrl);
  const hit = matchDirectorySkill(skills, slug);
  if (!hit) {
    throw new Error(`在 ${source} 中找不到 skill '${slug}'（可运行 skillpot market ${repoUrl} 查看）`);
  }
  return { repoUrl, subdir: hit.subdir };
}

/** 目录候选匹配：frontmatter name 优先，目录名兜底（不区分大小写） */
export function matchDirectorySkill(
  skills: MarketSkill[],
  slug: string,
): MarketSkill | undefined {
  const q = slug.toLowerCase();
  return (
    skills.find((s) => s.name.toLowerCase() === q) ??
    skills.find((s) => (s.subdir.split('/').pop() ?? '').toLowerCase() === q)
  );
}

export async function installFromDirectory(
  id: string,
  opts: { name?: string; for?: string[] } = {},
): Promise<AddResult> {
  const { repoUrl, subdir } = await resolveDirectorySkill(id);
  return installFromMarket(repoUrl, subdir, opts);
}

export function formatInstalls(n: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}
