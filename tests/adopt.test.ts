import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, loadState, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { enableSkill } from '../src/core/sync';
import { adoptSkills, scanAgentSkills, scanAdoptable } from '../src/core/adopt';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

beforeEach(() => {
  makeSandbox();
  initStore();
});

function writeAgentSkill(agentDirName: string, skillName: string, description: string): string {
  const dir = path.join(agentHome(), agentDirName, 'skills', skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n# ${skillName}\n`,
  );
  return dir;
}

function registerFixtureInStore(): void {
  installFromLocal(FIXTURE);
  const config = loadConfig();
  config.skills['demo-skill'] = {
    source: 'local:' + FIXTURE,
    checksum: 'sha256:test',
    installed_at: new Date().toISOString(),
    expose: {},
  };
  saveConfig(config);
}

describe('scanAgentSkills', () => {
  it('扫描合法 skill，忽略点目录与非法目录', () => {
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    fs.mkdirSync(path.join(agentHome(), '.zcode', 'skills', '.hidden'), { recursive: true });
    fs.mkdirSync(path.join(agentHome(), '.zcode', 'skills', 'no-md'), { recursive: true });
    const found = scanAgentSkills('zcode');
    expect(found.map((f) => f.name)).toEqual(['alpha']);
  });
});

describe('adoptSkills', () => {
  it('dry-run 只报告不落地', () => {
    registerFixtureInStore();
    enableSkill('demo-skill', ['claude-code']);
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    const report = adoptSkills({ dryRun: true });
    expect(report.items.filter((i) => i.status === 'dry-run')).toHaveLength(1);
    expect(report.imported).toBe(1);
    expect(fs.existsSync(skillDir('alpha'))).toBe(false);
    expect(Object.keys(loadConfig().skills)).toEqual(['demo-skill']);
  });

  it('导入并登记来源；本工具管理的 symlink 被跳过', () => {
    registerFixtureInStore();
    enableSkill('demo-skill', ['claude-code']); // .claude/skills/demo-skill 现在是受管 symlink
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    writeAgentSkill('.claude', 'legacy', 'Legacy skill with a sufficiently long description.');

    const report = adoptSkills();
    expect(report.imported).toBe(2);
    expect(report.items.find((i) => i.name === 'demo-skill')?.status).toBe('skipped-managed');

    expect(fs.existsSync(skillDir('alpha'))).toBe(true);
    const config = loadConfig();
    expect(config.skills['alpha'].source.startsWith('adopt:zcode:')).toBe(true);
    expect(config.skills['legacy'].source.startsWith('adopt:claude-code:')).toBe(true);
    // 原目录保留不动
    expect(fs.existsSync(path.join(agentHome(), '.claude', 'skills', 'legacy'))).toBe(true);
  });

  it('同名冲突跳过；重复 adopt 幂等', () => {
    registerFixtureInStore();
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    writeAgentSkill('.claude', 'alpha', 'Another alpha from claude side.'); // 与 zcode 的同名
    adoptSkills();
    const report = adoptSkills();
    expect(report.imported).toBe(0);
    expect(report.items.every((i) => i.status === 'exists')).toBe(true);
    expect(loadState().links).toHaveLength(0);
  });

  it('enableFor 直接开放给目标 Agent', () => {
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    adoptSkills({ from: ['zcode'], enableFor: ['claude-code'] });
    const link = path.join(agentHome(), '.claude', 'skills', 'alpha');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(loadConfig().skills['alpha'].expose['claude-code']).toBe(true);
  });

  it('move 模式：导入后原目录替换为 symlink，来源 Agent 自动开放', () => {
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    const report = adoptSkills({ from: ['zcode'], move: true });
    expect(report.imported).toBe(1);
    const src = path.join(agentHome(), '.zcode', 'skills', 'alpha');
    expect(fs.lstatSync(src).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(src)).toBe(fs.realpathSync(skillDir('alpha')));
    expect(loadConfig().skills['alpha'].expose['zcode']).toBe(true);
    // 移动后不再是可收编对象
    expect(scanAdoptable('zcode')).toEqual([]);
  });

  it('move 模式：与仓库同名时把本 Agent 目录替换为 symlink（linked）', () => {
    writeAgentSkill('.zcode', 'alpha', 'Alpha skill with a sufficiently long description.');
    adoptSkills({ from: ['zcode'], move: true });
    writeAgentSkill('.claude', 'alpha', 'Alpha copy from claude with a sufficiently long description.');
    const report = adoptSkills({ from: ['claude-code'], move: true });
    expect(report.linked).toBe(1);
    const src = path.join(agentHome(), '.claude', 'skills', 'alpha');
    expect(fs.lstatSync(src).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(src)).toBe(fs.realpathSync(skillDir('alpha')));
    expect(loadConfig().skills['alpha'].expose['claude-code']).toBe(true);
  });
});
