import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { skillDir, storeDir } from '../paths';
import { SkillMeta, readSkillMeta, sanitizeSkillName } from '../util/frontmatter';

const execFileP = promisify(execFile);

export function ensureStore(): string {
  fs.mkdirSync(storeDir(), { recursive: true });
  return storeDir();
}

/** 计入 checksum / 拷贝时忽略的杂项（保证来自不同 clone 的同一内容摘要一致） */
const IGNORED_ENTRIES = new Set(['.git', '.DS_Store']);

/** 目录内容摘要（排序后对相对路径+内容做 sha256，截断展示用）；symlink 按解引用后的目标计入 */
export function dirChecksum(dir: string): string {
  const hash = crypto.createHash('sha256');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (IGNORED_ENTRIES.has(e.name)) continue;
      const p = path.join(d, e.name);
      let st: fs.Stats | null = null;
      if (e.isSymbolicLink()) {
        try {
          st = fs.statSync(p); // 跟随 symlink；断链/循环则跳过
        } catch {
          continue;
        }
      }
      if (e.isDirectory() || st?.isDirectory()) walk(p);
      else if (e.isFile() || st?.isFile()) files.push(p);
    }
  };
  walk(dir);
  files.sort();
  for (const f of files) {
    hash.update(path.relative(dir, f));
    hash.update('\0');
    hash.update(fs.readFileSync(f));
    hash.update('\0');
  }
  return 'sha256:' + hash.digest('hex').slice(0, 32);
}

/** 中央仓库中已登记形态完整的 skill 名列表 */
export function storeSkillNames(): string[] {
  const root = storeDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md')),
    )
    .map((e) => e.name)
    .sort();
}

export interface InstallResult {
  name: string;
  description: string;
  checksum: string;
}

/** 从本地 skill 目录安装（拷贝进中央仓库；仓库内只保留真身） */
export function installFromLocal(srcDir: string, nameOverride?: string): InstallResult {
  const abs = path.resolve(srcDir);
  const meta = readSkillMeta(abs);
  if (!meta) throw new Error(`${abs} 中没有 SKILL.md，不是合法的 skill 目录`);
  const name = sanitizeSkillName(nameOverride || meta.name || path.basename(abs));
  const dest = skillDir(name);
  if (fs.existsSync(dest)) throw new Error(`skill '${name}' 已存在于中央仓库`);
  fs.cpSync(abs, dest, {
    recursive: true,
    dereference: true, // 拷贝符号链接的真实内容：仓库必须自包含，不能依赖来源机器上的链接目标
    filter: (src) => !IGNORED_ENTRIES.has(path.basename(src)),
  });
  return {
    name,
    description: String(meta.description ?? ''),
    checksum: dirChecksum(dest),
  };
}

/**
 * 从 git 仓库安装：`<url>` 取仓库根，`<url>#<subdir>` 定位仓库内的 skill 子目录。
 * 浅克隆到临时目录，安装后即删。异步执行（GUI 服务端调用时不会阻塞事件循环）。
 */
export async function installFromGit(
  repoSpec: string,
  nameOverride?: string,
): Promise<InstallResult> {
  const [url, sub] = repoSpec.split('#');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpot-clone-'));
  try {
    await execFileP('git', ['clone', '--depth', '1', url, tmp]);
    const srcDir = sub ? path.join(tmp, sub) : tmp;
    return installFromLocal(srcDir, nameOverride);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function removeSkillDir(name: string): void {
  fs.rmSync(skillDir(name), { recursive: true, force: true });
}
