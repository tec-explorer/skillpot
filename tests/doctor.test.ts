import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, loadState, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { enableSkill } from '../src/core/sync';
import { fixDoctor, runDoctor } from '../src/core/doctor';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

beforeEach(() => {
  makeSandbox();
});

function setup(): void {
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

describe('doctor', () => {
  it('一致状态下体检通过', () => {
    setup();
    enableSkill('demo-skill', ['claude-code', 'codex']);
    expect(runDoctor()).toEqual([]);
  });

  it('检出 config 有但仓库无的 skill', () => {
    setup();
    fs.rmSync(skillDir('demo-skill'), { recursive: true, force: true });
    const issues = runDoctor();
    expect(issues.some((i) => i.level === 'error' && i.message.includes('中央仓库缺失'))).toBe(
      true,
    );
  });

  it('检出并清理断链台账', () => {
    setup();
    enableSkill('demo-skill', ['claude-code']);
    fs.rmSync(skillDir('demo-skill'), { recursive: true, force: true });
    const { fixed } = fixDoctor();
    expect(fixed.some((f) => f.includes('断链台账'))).toBe(true);
    expect(loadState().links).toHaveLength(0);
  });

  it('检出 expose 漂移并可通过 --fix 重同步', () => {
    setup();
    enableSkill('demo-skill', ['claude-code']);
    const config = loadConfig();
    config.skills['demo-skill'].expose['claude-code'] = false;
    saveConfig(config);
    const issues = runDoctor();
    expect(issues.some((i) => i.message.includes('漂移'))).toBe(true);
    fixDoctor();
    expect(
      fs.existsSync(path.join(agentHome(), '.claude', 'skills', 'demo-skill')),
    ).toBe(false);
  });

  it('检出未登记的手动拷入 skill', () => {
    setup();
    fs.cpSync(skillDir('demo-skill'), skillDir('rogue'), { recursive: true });
    const issues = runDoctor();
    expect(issues.some((i) => i.message.includes("'rogue' 未登记"))).toBe(true);
  });
});
