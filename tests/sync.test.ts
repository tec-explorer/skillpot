import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, loadState, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { disableSkill, enableSkill, resolveAgentIds } from '../src/core/sync';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

beforeEach(() => {
  makeSandbox();
});

function installFixture(): void {
  initStore();
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

describe('resolveAgentIds', () => {
  it('all 展开为全部注册 agent', () => {
    expect(resolveAgentIds('all')).toHaveLength(5);
  });
  it('未知 id 报错', () => {
    expect(() => resolveAgentIds('nope')).toThrow(/未知 agent/);
  });
});

describe('enable/disable lifecycle', () => {
  it('enable 建立 symlink、登记台账并更新 expose', () => {
    installFixture();
    const res = enableSkill('demo-skill', ['claude-code', 'codex']);
    expect(res.linked).toEqual(['claude-code', 'codex']);

    const link = path.join(agentHome(), '.claude', 'skills', 'demo-skill');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(skillDir('demo-skill')));
    expect(fs.existsSync(path.join(link, 'SKILL.md'))).toBe(true);

    expect(loadConfig().skills['demo-skill'].expose['claude-code']).toBe(true);
    expect(loadState().links).toHaveLength(2);
  });

  it('重复 enable 幂等', () => {
    installFixture();
    enableSkill('demo-skill', ['claude-code']);
    const res = enableSkill('demo-skill', ['claude-code']);
    expect(res.linked).toEqual(['claude-code']);
    expect(loadState().links).toHaveLength(1);
  });

  it('disable 移除 symlink、清台账并记 expose=false', () => {
    installFixture();
    enableSkill('demo-skill', ['claude-code', 'codex']);
    const res = disableSkill('demo-skill', ['claude-code']);
    expect(res.linked).toEqual(['claude-code']);
    expect(fs.existsSync(path.join(agentHome(), '.claude', 'skills', 'demo-skill'))).toBe(false);
    expect(fs.existsSync(path.join(agentHome(), '.codex', 'skills', 'demo-skill'))).toBe(true);
    const links = loadState().links;
    expect(links).toHaveLength(1);
    expect(links[0].agent).toBe('codex');
    expect(loadConfig().skills['demo-skill'].expose['claude-code']).toBe(false);
  });

  it('真实同名目录冲突时跳过且不改 expose', () => {
    installFixture();
    fs.mkdirSync(path.join(agentHome(), '.claude', 'skills', 'demo-skill'), { recursive: true });
    const res = enableSkill('demo-skill', ['claude-code']);
    expect(res.linked).toEqual([]);
    expect(res.skipped[0].agent).toBe('claude-code');
    expect(loadConfig().skills['demo-skill'].expose['claude-code']).toBeUndefined();
  });

  it('用户自建的无关 symlink 不被接管', () => {
    installFixture();
    const dir = path.join(agentHome(), '.claude', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'demo-skill'), 'dir');
    const res = enableSkill('demo-skill', ['claude-code']);
    expect(res.linked).toEqual([]);
    expect(res.skipped[0].reason).toContain('已被其他链接占用');
  });
});

describe('store', () => {
  it('installFromLocal 校验 SKILL.md、拒绝重名', () => {
    initStore();
    installFromLocal(FIXTURE);
    expect(() => installFromLocal(FIXTURE)).toThrow(/已存在/);
    expect(fs.existsSync(skillDir('demo-skill'))).toBe(true);
  });

  it('内部 symlink 解引用拷贝：仓库自包含且 checksum 非空哈希', () => {
    // 源 skill 的 SKILL.md 是指向外部真实文件的 symlink（模拟用户 ~/.claude/skills 的真实形态）
    const outside = path.join(makeSandbox(), 'outside.md');
    fs.writeFileSync(
      outside,
      '---\nname: linked\ndescription: A linked skill fixture for dereference copy verification testing.\n---\n# Real content\n',
    );
    const src = path.join(agentHome(), '.zcode', 'skills', 'linked');
    fs.mkdirSync(src, { recursive: true });
    fs.symlinkSync(outside, path.join(src, 'SKILL.md'));
    const res = installFromLocal(src, 'linked');
    expect(fs.readFileSync(path.join(skillDir('linked'), 'SKILL.md'), 'utf8')).toContain('Real content');
    expect(res.checksum).not.toBe('sha256:e3b0c44298fc1c149afbf4c8996fb924');
  });
});
