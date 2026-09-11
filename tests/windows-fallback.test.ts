import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, loadState, saveConfig } from '../src/core/config';
import { installFromLocal, dirChecksum } from '../src/core/store';
import { disableSkill, enableSkill } from '../src/core/sync';
import { runDoctor } from '../src/core/doctor';
import { AGENTS } from '../src/agents/registry';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

let testAgentId: string | null = null;
let sandbox = '';

beforeEach(() => {
  sandbox = makeSandbox();
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
  vi.restoreAllMocks();
  if (testAgentId) {
    const idx = AGENTS.findIndex((a) => a.id === testAgentId);
    if (idx >= 0) AGENTS.splice(idx, 1);
    testAgentId = null;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function registerMockAgent(id = 'win-mock-agent'): string {
  AGENTS.push({
    id,
    name: 'Windows Mock Agent',
    binaries: [],
    fingerprints: () => [path.join(agentHome(), '.' + id)],
    skillsDir: (home) => path.join(home, '.' + id, 'skills'),
    materialize: 'symlink', // 适配器本身声明走 symlink
    verify: 'docs',
    verified: 'test',
  });
  testAgentId = id;
  return id;
}

describe('Windows 符号链接 EPERM 权限受限时自动降级为 Copy (Windows Fallback)', () => {
  it('当 symlink 抛出 EPERM 时，自动平滑降级为 B 档 copy 落地并记账', () => {
    const agentId = registerMockAgent('win-agent-1');

    // 拦截 symlinkSync 抛出 EPERM 模拟 Windows 无开发者模式/管理员权限
    const symlinkSpy = vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      const err: any = new Error('operation not permitted, symlink');
      err.code = 'EPERM';
      throw err;
    });

    const res = enableSkill('demo-skill', [agentId]);
    expect(res.linked).toContain(agentId);
    expect(res.skipped).toHaveLength(0);

    // 检查台账记录为 kind: copy
    const state = loadState();
    const link = state.links.find((l) => l.agent === agentId && l.skill === 'demo-skill');
    expect(link).toBeDefined();
    expect(link?.kind).toBe('copy');

    // 检查落地为真实目录且存在 SKILL.md，而不是 symlink
    const targetDir = link!.link_path;
    const stat = fs.lstatSync(targetDir);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);

    // 运行 doctor 验证状态健全无报错
    const doc = runDoctor();
    expect(doc.filter((i) => i.level === 'error')).toHaveLength(0);

    // disable 能正确清理 copy 副本
    const disRes = disableSkill('demo-skill', [agentId]);
    expect(disRes.linked).toContain(agentId);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it('断链重建时遇到 EPERM 同样平滑降级为 copy', () => {
    const agentId = registerMockAgent('win-agent-2');

    // 先正常建立链接并记账
    enableSkill('demo-skill', [agentId]);

    // 模拟目标链接损坏（删掉）
    const state = loadState();
    const link = state.links.find((l) => l.agent === agentId);
    fs.rmSync(link!.link_path, { recursive: true, force: true });

    // 重新 enable 时，symlink 抛出 EPERM
    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      const err: any = new Error('operation not permitted, symlink');
      err.code = 'EPERM';
      throw err;
    });

    const res = enableSkill('demo-skill', [agentId]);
    expect(res.linked).toContain(agentId);

    const state2 = loadState();
    const link2 = state2.links.find((l) => l.agent === agentId);
    expect(link2?.kind).toBe('copy');
    expect(fs.existsSync(path.join(link2!.link_path, 'SKILL.md'))).toBe(true);
  });
});
