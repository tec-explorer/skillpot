import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { adoptSkills } from '../src/core/adopt';
import { loadConfig } from '../src/core/config';
import { agentHome, skillDir } from '../src/paths';

beforeEach(() => {
  makeSandbox();
});

function setupAgentSkill(agentDirName: string, skillName: string, content: string): string {
  const p = path.join(agentHome(), agentDirName, 'skills', skillName);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, 'SKILL.md'),
    `---
name: ${skillName}
description: Skill installed in ${agentDirName} for testing conflict handling.
---
# ${content}
`,
  );
  return p;
}

describe('Adopt 同名冲突处理策略 (Adopt Conflict Handling)', () => {
  it('默认策略（skip）：遇到同名技能直接跳过并标记 exists', () => {
    // 模拟 claude-code 和 cursor 都有同名技能 'git-helper'
    setupAgentSkill('.claude', 'git-helper', 'Claude version');
    setupAgentSkill('.cursor', 'git-helper', 'Cursor version');

    const report = adoptSkills({
      from: ['claude-code', 'cursor'],
      onConflict: 'skip',
    });

    expect(report.imported).toBe(1);
    expect(report.exists).toBe(1);

    const importedItem = report.items.find((i) => i.status === 'imported');
    expect(importedItem).toBeDefined();

    const existsItem = report.items.find((i) => i.status === 'exists');
    expect(existsItem).toBeDefined();
    expect(existsItem?.detail).toBe('中央仓库已有同名 skill');
  });

  it('重命名策略（rename）：自动将同名冲突更名为 <name>-<agent>', () => {
    setupAgentSkill('.claude', 'git-helper', 'Claude version');
    setupAgentSkill('.cursor', 'git-helper', 'Cursor version');

    const report = adoptSkills({
      from: ['claude-code', 'cursor'],
      onConflict: 'rename',
    });

    expect(report.imported).toBe(2);
    expect(report.exists).toBe(0);

    const config = loadConfig();
    expect(config.skills['git-helper']).toBeDefined();
    expect(config.skills['git-helper-cursor']).toBeDefined();

    expect(fs.existsSync(skillDir('git-helper'))).toBe(true);
    expect(fs.existsSync(skillDir('git-helper-cursor'))).toBe(true);

    const cursorMd = fs.readFileSync(path.join(skillDir('git-helper-cursor'), 'SKILL.md'), 'utf8');
    expect(cursorMd).toContain('Cursor version');
  });

  it('重命名策略（rename）在 dry-run 模式下准确展示将导入的候选名称', () => {
    setupAgentSkill('.claude', 'git-helper', 'Claude version');
    setupAgentSkill('.cursor', 'git-helper', 'Cursor version');

    // 先导入第一个
    adoptSkills({ from: ['claude-code'] });

    // 对第二个做 dry-run
    const report = adoptSkills({
      from: ['cursor'],
      onConflict: 'rename',
      dryRun: true,
    });

    expect(report.imported).toBe(1);
    expect(report.items[0].status).toBe('dry-run');
    expect(report.items[0].name).toBe('git-helper-cursor');
    expect(report.items[0].detail).toContain('冲突重命名：将收编为 git-helper-cursor');
  });
});
