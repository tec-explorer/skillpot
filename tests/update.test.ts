import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig, lockPath } from '../src/core/config';
import { installFromGit } from '../src/core/store';
import { updateSkills } from '../src/core/update';
import { skillDir } from '../src/paths';

beforeEach(() => {
  makeSandbox();
  initStore();
});

function commitFile(repo: string, rel: string, content: string, message: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function makeRepo(): string {
  const repo = path.join(makeSandbox(), 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q']);
  commitFile(
    repo,
    'SKILL.md',
    '---\nname: git-skill\ndescription: Git-sourced skill for update tests. Version one.\n---\n# v1\n',
    'v1',
  );
  return repo;
}

async function installFromRepo(repo: string): Promise<void> {
  const res = await installFromGit(repo, 'git-skill');
  const config = loadConfig();
  config.skills['git-skill'] = {
    source: `git:${repo}`,
    checksum: res.checksum,
    installed_at: new Date().toISOString(),
    expose: {},
  };
  saveConfig(config);
}

describe('update', () => {
  it('无变化时 up-to-date', async () => {
    const repo = makeRepo();
    await installFromRepo(repo);
    const results = await updateSkills('git-skill');
    expect(results).toEqual([{ skill: 'git-skill', status: 'up-to-date' }]);
  });

  it('远端变化后 updated 并替换内容、刷新 checksum 与 lockfile', async () => {
    const repo = makeRepo();
    await installFromRepo(repo);
    commitFile(repo, 'SKILL.md', '---\nname: git-skill\ndescription: Git-sourced skill for update tests. Version two here.\n---\n# v2\n', 'v2');

    const results = await updateSkills('git-skill');
    expect(results[0].status).toBe('updated');
    expect(fs.readFileSync(path.join(skillDir('git-skill'), 'SKILL.md'), 'utf8')).toContain('# v2');
    expect(loadConfig().skills['git-skill'].checksum).toMatch(/^sha256:/);
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it('--check 只报告 outdated 不改动', async () => {
    const repo = makeRepo();
    await installFromRepo(repo);
    commitFile(repo, 'SKILL.md', '---\nname: git-skill\ndescription: Git-sourced skill for update tests. Version two here.\n---\n# v2\n', 'v2');
    const before = fs.readFileSync(path.join(skillDir('git-skill'), 'SKILL.md'), 'utf8');
    const results = await updateSkills('git-skill', { check: true });
    expect(results[0].status).toBe('outdated');
    expect(fs.readFileSync(path.join(skillDir('git-skill'), 'SKILL.md'), 'utf8')).toBe(before);
  });

  it('local 来源报告为 local', async () => {
    const config = loadConfig();
    config.skills['loc'] = {
      source: 'local:/somewhere',
      checksum: 'x',
      installed_at: new Date().toISOString(),
      expose: {},
    };
    saveConfig(config);
    expect(await updateSkills('loc')).toEqual([
      { skill: 'loc', status: 'local', detail: 'local:/somewhere' },
    ]);
  });
});

describe('update diff', () => {
  it('更新结果携带文件级差异（新增/修改/删除）', async () => {
    const repo = makeRepo();
    commitFile(repo, 'notes.md', 'old notes\n', 'add notes');
    await installFromRepo(repo);
    commitFile(repo, 'SKILL.md', '---\nname: git-skill\ndescription: Version two with changes.\n---\n# v2\n', 'v2');
    commitFile(repo, 'extra.md', 'brand new file\n', 'add extra');
    execFileSync('git', ['-C', repo, 'rm', '-q', 'notes.md']);
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'remove notes']);

    const results = await updateSkills('git-skill');
    expect(results[0].status).toBe('updated');
    expect(results[0].diff).toEqual({
      added: ['extra.md'],
      removed: ['notes.md'],
      modified: ['SKILL.md'],
    });
  });

  it('--check 同样携带将产生的 diff', async () => {
    const repo = makeRepo();
    await installFromRepo(repo);
    commitFile(repo, 'extra.md', 'new\n', 'add extra');
    const results = await updateSkills('git-skill', { check: true });
    expect(results[0].status).toBe('outdated');
    expect(results[0].diff?.added).toEqual(['extra.md']);
  });
});
