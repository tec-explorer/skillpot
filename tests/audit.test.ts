import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { disableSkill, enableSkill } from '../src/core/sync';
import { runAudit } from '../src/core/audit';
import { agentHome, skillDir } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

beforeEach(() => {
  makeSandbox();
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
});

describe('audit', () => {
  it('正常开放：列入 active 且无发现', () => {
    enableSkill('demo-skill', ['claude-code']);
    const report = runAudit();
    const claude = report.agents.find((a) => a.agent === 'claude-code')!;
    expect(claude.active).toHaveLength(1);
    expect(claude.active[0]).toMatchObject({
      skill: 'demo-skill',
      source: 'local:' + FIXTURE,
      enabled: true,
    });
    expect(claude.findings).toHaveLength(0);
    expect(claude.external).toHaveLength(0);
  });

  it('受管链接残留（声明关闭）给出 warn', () => {
    enableSkill('demo-skill', ['claude-code']);
    disableSkill('demo-skill', ['claude-code']); // disable 会撤链，这里改为手工重建残留
    fs.mkdirSync(path.dirname(path.join(agentHome(), '.claude/skills/demo-skill')), {
      recursive: true,
    });
    fs.symlinkSync(skillDir('demo-skill'), path.join(agentHome(), '.claude/skills/demo-skill'));
    const report = runAudit();
    const claude = report.agents.find((a) => a.agent === 'claude-code')!;
    expect(claude.active[0]?.enabled).toBe(false);
    expect(claude.findings.some((f) => f.level === 'warn' && f.message.includes('矩阵已声明关闭'))).toBe(
      true,
    );
  });

  it('外部同名占用且声明开放：error 级发现（被绕过/遮蔽）', () => {
    enableSkill('demo-skill', ['claude-code']);
    const target = path.join(agentHome(), '.claude/skills/demo-skill');
    fs.rmSync(target); // 撤掉受管 symlink
    fs.mkdirSync(target, { recursive: true }); // 换成外部真实目录
    const report = runAudit();
    const claude = report.agents.find((a) => a.agent === 'claude-code')!;
    expect(claude.external).toHaveLength(1);
    expect(claude.findings.some((f) => f.level === 'error' && f.message.includes('绕过'))).toBe(true);
  });

  it('声明开放但链接缺失：warn（漂移）', () => {
    enableSkill('demo-skill', ['claude-code']);
    fs.rmSync(path.join(agentHome(), '.claude/skills/demo-skill'));
    const report = runAudit();
    const claude = report.agents.find((a) => a.agent === 'claude-code')!;
    expect(claude.active).toHaveLength(0);
    expect(claude.findings.some((f) => f.message.includes('链接缺失'))).toBe(true);
  });
});
