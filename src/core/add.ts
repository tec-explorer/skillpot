import path from 'node:path';
import { skillDir } from '../paths';
import { initStore, loadConfig, saveConfig } from './config';
import { installFromGit, installFromLocal } from './store';
import { enableSkill } from './sync';
import { lintSkill, LintIssue } from './lint';

/** CLI add 与 GUI 安装表单共用的来源判别：URL / git@ / file:// / .git 后缀视为 git 来源 */
export function isGitSource(source: string): boolean {
  return (
    /^https?:\/\//.test(source) ||
    /^git@/.test(source) ||
    /^file:\/\//.test(source) ||
    /\.git$/.test(source)
  );
}

export interface AddOptions {
  /** 指定 skill 名（默认取 frontmatter name 或目录名） */
  name?: string;
  /** 安装后开放给哪些 agent id */
  for?: string[];
}

export interface AddResult {
  name: string;
  description: string;
  checksum: string;
  source: string;
  /** 安装即体检：frontmatter 完整性 + 脚本高危模式 */
  lint: LintIssue[];
  enabled: string[];
  skipped: { agent: string; reason: string }[];
}

/** 安装 skill 到中央仓库并登记（本地目录或 git URL），可选立即开放给部分 Agent */
export async function addSkill(source: string, opts: AddOptions = {}): Promise<AddResult> {
  if (!source || !source.trim()) throw new Error('缺少来源：本地目录或 git URL');
  initStore();
  const isGit = isGitSource(source);
  const res = isGit
    ? await installFromGit(source, opts.name)
    : installFromLocal(source, opts.name);

  const config = loadConfig();
  config.skills[res.name] = {
    source: isGit ? `git:${source}` : `local:${path.resolve(source)}`,
    checksum: res.checksum,
    installed_at: new Date().toISOString(),
    expose: {},
  };
  saveConfig(config);

  let enabled: string[] = [];
  let skipped: { agent: string; reason: string }[] = [];
  if (opts.for?.length) {
    const r = enableSkill(res.name, opts.for);
    enabled = r.linked;
    skipped = r.skipped;
  }

  return {
    name: res.name,
    description: res.description,
    checksum: res.checksum,
    source: config.skills[res.name].source,
    lint: lintSkill(skillDir(res.name)),
    enabled,
    skipped,
  };
}
