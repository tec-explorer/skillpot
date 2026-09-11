import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig } from '../src/core/config';
import { installFromLocal, dirChecksum } from '../src/core/store';
import { disableSkill, enableSkill, refreshCopies } from '../src/core/sync';
import { AGENTS } from '../src/agents/registry';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

let copyAgentId: string | null = null;

beforeEach(() => {
  makeSandbox();
  initStore();
  installFromLocal(FIXTURE);
  const config = loadConfig();
  config.skills['demo-skill'] = {
    source: 'local:' + FIXTURE,
    checksum: dirChecksum(skillDir('demo-skill')),
    installed_at: new Date().toISOString(),
    expose: {},
  };
  saveConfig(config);
});

afterEach(() => {
  if (copyAgentId) {
    const idx = AGENTS.findIndex((a) => a.id === copyAgentId);
    if (idx >= 0) AGENTS.splice(idx, 1);
    copyAgentId = null;
  }
});

function useCopyAgent(): string {
  const id = 'copy-safety-agent';
  AGENTS.push({
    id,
    name: 'Copy Safety Agent',
    binaries: [],
    fingerprints: () => [path.join(agentHome(), '.copysafety')],
    skillsDir: (home) => path.join(home, '.copysafety', 'skills'),
    materialize: 'copy',
    verified: 'test',
  });
  copyAgentId = id;
  return id;
}

describe('B 档 Copy 模式数据安全防护与刷新 (Copy Safety & Refresh)', () => {
  it('disable 时，若副本被用户修改，先自动备份再删除', () => {
    const id = useCopyAgent();
    enableSkill('demo-skill', [id]);

    const targetDir = path.join(agentHome(), '.copysafety', 'skills', 'demo-skill');
    expect(fs.existsSync(targetDir)).toBe(true);

    // 模拟开发者在 IDE 中修改了该副本
    fs.writeFileSync(path.join(targetDir, 'custom-script.sh'), '#!/bin/bash\necho "user edit"');

    // 执行 disable
    disableSkill('demo-skill', [id]);

    // 目标原目录已被删除
    expect(fs.existsSync(targetDir)).toBe(false);

    // 但同级目录中存在自动生成的 .backup.* 目录，且包含开发者写的代码
    const parentDir = path.dirname(targetDir);
    const backupDirs = fs
      .readdirSync(parentDir)
      .filter((n) => n.startsWith('demo-skill.backup.'));
    expect(backupDirs.length).toBeGreaterThanOrEqual(1);

    const backupFile = path.join(parentDir, backupDirs[0], 'custom-script.sh');
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.readFileSync(backupFile, 'utf8')).toContain('user edit');
  });

  it('enable 重新覆盖时，若副本被用户修改，先自动备份再覆盖', () => {
    const id = useCopyAgent();
    enableSkill('demo-skill', [id]);

    const targetDir = path.join(agentHome(), '.copysafety', 'skills', 'demo-skill');
    // 用户修改
    fs.writeFileSync(path.join(targetDir, 'my-hack.txt'), 'important edits');

    // 再次调用 enable 刷新
    enableSkill('demo-skill', [id]);

    // 目标目录恢复为 store 最新内容（没有 my-hack.txt）
    expect(fs.existsSync(path.join(targetDir, 'my-hack.txt'))).toBe(false);

    // 备份目录中保留了 my-hack.txt
    const parentDir = path.dirname(targetDir);
    const backupDirs = fs
      .readdirSync(parentDir)
      .filter((n) => n.startsWith('demo-skill.backup.'));
    expect(backupDirs.length).toBeGreaterThanOrEqual(1);

    const backupFile = path.join(parentDir, backupDirs[0], 'my-hack.txt');
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.readFileSync(backupFile, 'utf8')).toBe('important edits');
  });

  it('refreshCopies 能够批量发现修改并自动备份刷新', () => {
    const id = useCopyAgent();
    enableSkill('demo-skill', [id]);

    const targetDir = path.join(agentHome(), '.copysafety', 'skills', 'demo-skill');
    // 用户修改
    fs.writeFileSync(path.join(targetDir, 'local-change.txt'), 'do not lose me');

    // 调用 refreshCopies
    const res = refreshCopies();
    expect(res.total).toBe(1);
    expect(res.refreshed).toBe(1);
    expect(res.backedUp).toBe(1);
    expect(res.details[0].action).toBe('backed-up-and-refreshed');

    // 检查备份
    const parentDir = path.dirname(targetDir);
    const backupDirs = fs
      .readdirSync(parentDir)
      .filter((n) => n.startsWith('demo-skill.backup.'));
    expect(backupDirs.length).toBeGreaterThanOrEqual(1);

    // 再次调用 refreshCopies，此时已无差异，报告 up-to-date
    const res2 = refreshCopies();
    expect(res2.refreshed).toBe(0);
    expect(res2.details[0].action).toBe('up-to-date');
  });
});
