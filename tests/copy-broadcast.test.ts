import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, loadState, saveConfig, saveState } from '../src/core/config';
import { installFromLocal, dirChecksum } from '../src/core/store';
import { broadcastSkill, disableSkill, enableSkill } from '../src/core/sync';
import { fixDoctor, runDoctor } from '../src/core/doctor';
import { uninstallSkill } from '../src/core/uninstall';
import { AGENTS } from '../src/agents/registry';
import { deriveMatrix } from '../src/tui/matrix';
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
  // 摘掉测试用 copy 适配器
  if (copyAgentId) {
    const idx = AGENTS.findIndex((a) => a.id === copyAgentId);
    if (idx >= 0) AGENTS.splice(idx, 1);
    copyAgentId = null;
  }
});

/** 注入一个 B 档（copy）测试适配器 */
function useCopyAgent(): string {
  const id = 'copy-agent';
  AGENTS.push({
    id,
    name: 'Copy Agent',
    binaries: [],
    fingerprints: () => [path.join(agentHome(), '.copyagent')],
    skillsDir: (home) => path.join(home, '.copyagent', 'skills'),
    materialize: 'copy',
    verified: 'test',
  });
  copyAgentId = id;
  return id;
}

describe('B 档 copy 落地策略', () => {
  it('enable 拷贝真实目录（非 symlink）并记台账 kind=copy', () => {
    const id = useCopyAgent();
    enableSkill('demo-skill', [id]);
    const target = path.join(agentHome(), '.copyagent/skills/demo-skill');
    const st = fs.lstatSync(target);
    expect(st.isDirectory()).toBe(true);
    expect(st.isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(target, 'SKILL.md'))).toBe(true);
    const state = loadState();
    expect(state.links.find((l) => l.agent === id)?.kind).toBe('copy');
  });

  it('重复 enable 刷新副本内容（enable 即同步）', () => {
    const id = useCopyAgent();
    enableSkill('demo-skill', [id]);
    const target = path.join(agentHome(), '.copyagent/skills/demo-skill');
    fs.writeFileSync(path.join(target, 'STALE.md'), '旧内容');
    enableSkill('demo-skill', [id]); // 重新拷贝
    expect(fs.existsSync(path.join(target, 'STALE.md'))).toBe(false);
  });

  it('disable 删除副本并清台账；doctor 对缺失副本给出可修复项', () => {
    const id = useCopyAgent();
    enableSkill('demo-skill', [id]);
    const target = path.join(agentHome(), '.copyagent/skills/demo-skill');

    expect(runDoctor().some((i) => i.message.includes('副本'))).toBe(false);
    fs.rmSync(target, { recursive: true, force: true }); // 副本被删
    expect(runDoctor().some((i) => i.message.includes('副本缺失'))).toBe(true);
    fixDoctor(); // 清台账

    disableSkill('demo-skill', [id]);
    expect(fs.existsSync(target)).toBe(false);
    expect(loadState().links.filter((l) => l.agent === id)).toHaveLength(0);
  });
});

describe('broadcast 广播模式', () => {
  it('广播创建 symlink 入 ~/.agents/skills 并记台账；--off 撤下', () => {
    const r1 = broadcastSkill('demo-skill');
    expect(r1.changed).toBe(true);
    const target = path.join(agentHome(), '.agents/skills/demo-skill');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(loadState().links.find((l) => l.agent === 'broadcast')).toBeTruthy();

    const r2 = broadcastSkill('demo-skill');
    expect(r2.changed).toBe(false); // 幂等

    const r3 = broadcastSkill('demo-skill', true);
    expect(r3.changed).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(loadState().links.filter((l) => l.agent === 'broadcast')).toHaveLength(0);
  });

  it('广播非本工具创建的同名条目会被拒绝', () => {
    const target = path.join(agentHome(), '.agents/skills/demo-skill');
    fs.mkdirSync(target, { recursive: true });
    expect(() => broadcastSkill('demo-skill')).toThrow(/拒绝覆盖/);
  });
});

describe('通用广播作为矩阵一等列', () => {
  it('矩阵里有 broadcast 渠道列，enable --for broadcast 即开放', () => {
    const m0 = deriveMatrix();
    const col = m0.agents.find((a) => a.id === 'broadcast');
    expect(col?.kind).toBe('channel');
    expect(col?.name).toBe('通用广播');
    expect(col?.installed).toBe(true);

    const res = enableSkill('demo-skill', ['broadcast']);
    expect(res.linked).toEqual(['broadcast']);
    const target = path.join(agentHome(), '.agents/skills/demo-skill');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    // 与 Agent 列同一套语义：写 expose、进台账
    expect(loadConfig().skills['demo-skill'].expose['broadcast']).toBe(true);

    expect(deriveMatrix().cells['demo-skill']['broadcast']).toEqual({
      enabled: true,
      actual: true,
      managed: true,
    });

    const off = disableSkill('demo-skill', ['broadcast']);
    expect(off.linked).toEqual(['broadcast']);
    expect(fs.existsSync(target)).toBe(false);
    expect(deriveMatrix().cells['demo-skill']['broadcast']).toEqual({
      enabled: false,
      actual: false,
      managed: false,
    });
  });

  it('0.11 的广播只落在台账（未登记 expose）：矩阵判定为已开放，doctor 不误报漂移', () => {
    const target = path.join(agentHome(), '.agents/skills/demo-skill');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(skillDir('demo-skill'), target, 'dir');
    const state = loadState();
    state.links.push({ skill: 'demo-skill', agent: 'broadcast', link_path: target });
    saveState(state);

    expect(loadConfig().skills['demo-skill'].expose['broadcast']).toBeUndefined();
    expect(deriveMatrix().cells['demo-skill']['broadcast'].enabled).toBe(true);
    // 关键：不能因为"声明里没有 broadcast"就提示用户把广播撤掉
    const drift = runDoctor().filter((i) => i.message.includes('broadcast'));
    expect(drift).toEqual([]);
    // 反向验收：doctor --fix 也不该把用户的广播撤下
    fixDoctor();
    expect(fs.existsSync(target)).toBe(true);
  });

  it('uninstall 一并撤下广播链接（渠道也在卸载清单里）', () => {
    broadcastSkill('demo-skill');
    const target = path.join(agentHome(), '.agents/skills/demo-skill');
    expect(fs.existsSync(target)).toBe(true);
    uninstallSkill('demo-skill');
    expect(fs.existsSync(target)).toBe(false);
    expect(loadState().links.filter((l) => l.agent === 'broadcast')).toHaveLength(0);
  });
});
