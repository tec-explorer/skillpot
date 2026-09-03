import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { skillDir } from '../paths';
import { loadConfig, saveConfig } from './config';
import { dirChecksum } from './store';

export type UpdateStatus = 'up-to-date' | 'outdated' | 'updated' | 'local' | 'error';

export interface UpdateResult {
  skill: string;
  status: UpdateStatus;
  detail?: string;
}

function parseGitSource(source: string): string | null {
  return source.startsWith('git:') ? source.slice(4) : null;
}

/** 浅克隆远端并计算（可选子目录的）内容摘要；调用方负责清理 tmp */
function fetchRemote(repoSpec: string): { checksum: string; cloneDir: string; sub?: string } {
  const [url, sub] = repoSpec.split('#');
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpot-update-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', url, cloneDir], { stdio: 'pipe' });
    const contentDir = sub ? path.join(cloneDir, sub) : cloneDir;
    if (!fs.existsSync(path.join(contentDir, 'SKILL.md'))) {
      throw new Error(`远端 ${sub ? `#${sub} ` : ''}中没有 SKILL.md`);
    }
    return { checksum: dirChecksum(contentDir), cloneDir, sub };
  } catch (e) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * 更新 git 来源的 skill：--check 只比对报告（outdated），否则拉取并原位替换
 * 中央仓库内容（symlink 指向路径不变，无需重连）。local 来源报告为 local。
 */
export function updateSkills(
  name: string | undefined,
  opts: { check?: boolean } = {},
): UpdateResult[] {
  const config = loadConfig();
  const names = name ? [name] : Object.keys(config.skills).sort();
  const results: UpdateResult[] = [];

  for (const n of names) {
    const entry = config.skills[n];
    if (!entry) {
      results.push({ skill: n, status: 'error', detail: 'config 中不存在' });
      continue;
    }
    const repoSpec = parseGitSource(entry.source);
    if (!repoSpec) {
      results.push({ skill: n, status: 'local', detail: entry.source });
      continue;
    }
    if (!fs.existsSync(skillDir(n))) {
      results.push({ skill: n, status: 'error', detail: '中央仓库缺失' });
      continue;
    }
    try {
      const fetched = fetchRemote(repoSpec);
      try {
        if (fetched.checksum === entry.checksum) {
          results.push({ skill: n, status: 'up-to-date' });
          continue;
        }
        if (opts.check) {
          results.push({ skill: n, status: 'outdated', detail: `远端 ${fetched.checksum.slice(0, 15)}` });
          continue;
        }
        // 原位替换：先落到临时目录，再换掉仓库内容
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpot-new-'));
        try {
          const srcDir = fetched.sub ? path.join(fetched.cloneDir, fetched.sub) : fetched.cloneDir;
          fs.cpSync(srcDir, staging, { recursive: true });
          fs.rmSync(skillDir(n), { recursive: true, force: true });
          fs.cpSync(staging, skillDir(n), { recursive: true });
        } finally {
          fs.rmSync(staging, { recursive: true, force: true });
        }
        entry.checksum = dirChecksum(skillDir(n));
        entry.installed_at = new Date().toISOString();
        results.push({ skill: n, status: 'updated', detail: entry.checksum.slice(0, 15) });
      } finally {
        fs.rmSync(fetched.cloneDir, { recursive: true, force: true });
      }
    } catch (e) {
      results.push({ skill: n, status: 'error', detail: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!opts.check && results.some((r) => r.status === 'updated')) saveConfig(config);
  return results;
}
