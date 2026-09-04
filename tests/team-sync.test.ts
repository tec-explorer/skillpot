import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import {
  exportManifest,
  loadManifest,
  syncManifest,
} from '../src/core/team-sync';
import { dirChecksum } from '../src/core/store';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

let repo = '';

let sandboxRoot = '';

beforeEach(() => {
  sandboxRoot = makeSandbox();
  initStore();
  repo = path.join(sandboxRoot, 'team-repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'SKILL.md'),
    '---\nname: team-skill\ndescription: Team alignment fixture skill for sync tests.\n---\n# team\n',
  );
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1']);
});

function writeManifest(skills: Record<string, unknown>): string {
  const file = path.join(sandboxRoot, 'skillpot.yaml');
  const lines = ['version: 1', 'skills:'];
  for (const [name, entry] of Object.entries(skills)) {
    const e = entry as { source: string; checksum?: string; expose?: Record<string, boolean> };
    lines.push(`  ${name}:`);
    lines.push(`    source: ${e.source}`);
    if (e.checksum) lines.push(`    checksum: ${e.checksum}`);
    if (e.expose) {
      lines.push('    expose:');
      for (const [a, v] of Object.entries(e.expose)) lines.push(`      ${a}: ${v}`);
    }
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('exportManifest', () => {
  it('从中央仓库导出清单,local 来源给出警告', () => {
    installFromLocal(FIXTURE);
    const config = loadConfig();
    config.skills['demo-skill'] = {
      source: 'local:' + FIXTURE,
      checksum: 'sha256:x',
      installed_at: new Date().toISOString(),
      expose: { 'claude-code': true },
    };
    saveConfig(config);

    const file = path.join(sandboxRoot, 'skillpot.yaml');
    const { manifest, warnings } = exportManifest(file);
    expect(Object.keys(manifest.skills)).toEqual(['demo-skill']);
    expect(manifest.skills['demo-skill'].expose).toEqual({ 'claude-code': true });
    expect(warnings.some((w) => w.includes('local 来源'))).toBe(true);
    // 落盘文件可被 loadManifest 读回
    expect(loadManifest(file).skills['demo-skill'].source).toBe('local:' + FIXTURE);
  });

  it('按 names 过滤导出;仓库为空报错', () => {
    installFromLocal(FIXTURE);
    const config = loadConfig();
    config.skills['demo-skill'] = {
      source: 'git:https://github.com/o/r.git#s',
      checksum: 'sha256:y',
      installed_at: new Date().toISOString(),
      expose: {},
    };
    saveConfig(config);

    const file = path.join(sandboxRoot, 'skillpot.yaml');
    const { manifest } = exportManifest(file, ['demo-skill']);
    expect(Object.keys(manifest.skills)).toEqual(['demo-skill']);
    expect(() => exportManifest(file, ['ghost'])).toThrow(/无可导出/);
  });
});

describe('syncManifest', () => {
  it('安装缺失 skill、应用 expose、二次运行幂等', async () => {
    const checksum = dirChecksum(repo);
    const file = writeManifest({
      'team-skill': {
        source: `git:file://${repo}`,
        checksum,
        expose: { 'claude-code': true, zcode: true },
      },
    });

    const items = await syncManifest(file);
    expect(items[0]).toMatchObject({ skill: 'team-skill', action: 'install' });
    expect(loadConfig().skills['team-skill']).toBeTruthy();
    expect(loadConfig().skills['team-skill'].expose['claude-code']).toBe(true);
    expect(fs.existsSync(path.join(agentHome(), '.claude/skills/team-skill'))).toBe(true);
    expect(fs.existsSync(path.join(agentHome(), '.zcode/skills/team-skill'))).toBe(true);

    // 二次运行：已一致（不重复安装/更新）
    const again = await syncManifest(file);
    expect(again[0]).toMatchObject({ skill: 'team-skill', action: 'ok' });
  });

  it('dry-run 只报告不落地', async () => {
    const file = writeManifest({
      'team-skill': { source: `git:file://${repo}` },
    });
    const items = await syncManifest(file, { dryRun: true });
    expect(items[0]).toMatchObject({ skill: 'team-skill', action: 'install', dryRun: true });
    expect(loadConfig().skills['team-skill']).toBeUndefined();
  });

  it('checksum 锁版本：本机漂移时重装对齐', async () => {
    const checksum = dirChecksum(repo);
    const file = writeManifest({
      'team-skill': { source: `git:file://${repo}`, checksum },
    });
    await syncManifest(file);

    // 本机内容漂移（模拟他人改动中央仓库）：实际内容校验和偏离清单锁
    fs.writeFileSync(path.join(skillDir('team-skill'), 'EXTRA.md'), 'drift\n');
    expect(dirChecksum(skillDir('team-skill'))).not.toBe(checksum);

    const items = await syncManifest(file);
    expect(items[0]).toMatchObject({ skill: 'team-skill', action: 'reinstall' });
    expect(loadConfig().skills['team-skill'].checksum).toBe(checksum);
    expect(fs.existsSync(path.join(skillDir('team-skill'), 'EXTRA.md'))).toBe(false);
  });

  it('清单无 checksum 时只保证已装,不主动更新', async () => {
    const file = writeManifest({
      'team-skill': { source: `git:file://${repo}` },
    });
    await syncManifest(file);
    const first = loadConfig().skills['team-skill'].checksum;

    commitRepoChange();
    const items = await syncManifest(file);
    expect(items[0]).toMatchObject({ skill: 'team-skill', action: 'ok' });
    expect(loadConfig().skills['team-skill'].checksum).toBe(first);
  });

  it('local 来源：未装跳过、已装提醒', async () => {
    const file = writeManifest({
      ghost: { source: 'local:/nonexistent/path' },
    });
    const items = await syncManifest(file);
    expect(items[0]).toMatchObject({ skill: 'ghost', action: 'skip' });

    installFromLocal(FIXTURE);
    const config = loadConfig();
    config.skills['local-skill'] = {
      source: 'local:' + FIXTURE,
      checksum: 'sha256:x',
      installed_at: new Date().toISOString(),
      expose: {},
    };
    saveConfig(config);
    const file2 = writeManifest({ 'local-skill': { source: 'local:' + FIXTURE } });
    const items2 = await syncManifest(file2);
    expect(items2[0]).toMatchObject({ skill: 'local-skill', action: 'ok' });
  });

  it('损坏清单报错', async () => {
    const file = path.join(sandboxRoot, 'bad.yaml');
    fs.writeFileSync(file, 'not: a: valid: manifest:');
    await expect(syncManifest(file)).rejects.toThrow(/清单/);
  });
});

function commitRepoChange(): void {
  fs.writeFileSync(
    path.join(repo, 'SKILL.md'),
    '---\nname: team-skill\ndescription: Updated upstream content for drift test.\n---\n# team v2\n',
  );
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v2']);
}
