import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { skillDir } from '../paths';
import { initStore, loadConfig, saveConfig } from './config';
import { installFromLocal } from './store';
import { enableSkill } from './sync';
import { lintSkill, LintIssue } from './lint';
import { withLockSync } from '../util/fsx';

const execFileP = promisify(execFile);

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
  /** 跳过安全检查阻断，强制安装（默认遇到 error 级问题直接拒绝） */
  force?: boolean;
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

/**
 * 安装 skill 到中央仓库并登记（本地目录或 git URL），可选立即开放给部分 Agent。
 * Phase 2：安装前先执行 lint 安全与完整性检查，发现 error 级问题默认阻断，需显式开启 force 放行。
 */
export async function addSkill(source: string, opts: AddOptions = {}): Promise<AddResult> {
  if (!source || !source.trim()) throw new Error('缺少来源：本地目录或 git URL');
  initStore();
  const isGit = isGitSource(source);

  let srcDir: string;
  let tmpCloneDir: string | undefined;

  if (isGit) {
    const [url, sub] = source.split('#');
    tmpCloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpot-clone-'));
    try {
      await execFileP('git', ['clone', '--depth', '1', url, tmpCloneDir], {
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      srcDir = sub ? path.join(tmpCloneDir, sub) : tmpCloneDir;
    } catch (e) {
      if (tmpCloneDir) fs.rmSync(tmpCloneDir, { recursive: true, force: true });
      throw e;
    }
  } else {
    srcDir = path.resolve(source);
  }

  // —— 安装前安全检查（Pre-install Lint）——
  let issues: LintIssue[] = [];
  try {
    issues = lintSkill(srcDir);
  } catch (e) {
    if (tmpCloneDir) fs.rmSync(tmpCloneDir, { recursive: true, force: true });
    throw e;
  }

  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0 && !opts.force) {
    if (tmpCloneDir) fs.rmSync(tmpCloneDir, { recursive: true, force: true });
    const reasons = errors.map((e) => `  - ${e.message}`).join('\n');
    throw new Error(
      `安全检查未通过，安装已阻断：\n${reasons}\n提示：若确认来源安全，可使用 --force (-f) 强制安装`,
    );
  }

  // 检查通过或已 force，拷贝进中央仓库
  let res;
  try {
    res = installFromLocal(srcDir, opts.name);
  } finally {
    if (tmpCloneDir) fs.rmSync(tmpCloneDir, { recursive: true, force: true });
  }

  // 克隆/拷贝已完成，登记动作才进临界区（不在锁内做慢 IO）
  const config = withLockSync(() => {
    const c = loadConfig();
    c.skills[res.name] = {
      source: isGit ? `git:${source}` : `local:${path.resolve(source)}`,
      checksum: res.checksum,
      installed_at: new Date().toISOString(),
      expose: {},
    };
    saveConfig(c);
    return c;
  });

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
    lint: issues,
    enabled,
    skipped,
  };
}

