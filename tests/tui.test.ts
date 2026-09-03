import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { enableSkill } from '../src/core/sync';
import { deriveMatrix } from '../src/tui/matrix';
import { cellGlyph, toggleCell, renderStatic } from '../src/tui/cells';
import { renderTable } from '../src/util/table';
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

describe('deriveMatrix', () => {
  it('开放后单元格为 enabled+actual+managed', () => {
    enableSkill('demo-skill', ['claude-code']);
    const m = deriveMatrix();
    expect(m.skills).toEqual(['demo-skill']);
    expect(m.cells['demo-skill']['claude-code']).toEqual({
      enabled: true,
      actual: true,
      managed: true,
    });
    expect(m.cells['demo-skill']['gemini-cli']).toEqual({
      enabled: false,
      actual: false,
      managed: false,
    });
  });

  it('未开放但存在受管链接 → 漂移态（managed 实际存在）', () => {
    enableSkill('demo-skill', ['claude-code']);
    const config = loadConfig();
    config.skills['demo-skill'].expose['claude-code'] = false;
    saveConfig(config);
    const m = deriveMatrix();
    expect(m.cells['demo-skill']['claude-code']).toEqual({
      enabled: false,
      actual: true,
      managed: true,
    });
    expect(cellGlyph(m.cells['demo-skill']['claude-code']).tone).toBe('warn');
  });

  it('外部同名占用 → conflict 态', () => {
    const foreign = path.join(agentHome(), '.claude', 'skills', 'demo-skill');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'SKILL.md'), '---\nname: demo-skill\ndescription: x\n---\n');
    const m = deriveMatrix();
    expect(m.cells['demo-skill']['claude-code']).toEqual({
      enabled: false,
      actual: true,
      managed: false,
    });
    expect(cellGlyph(m.cells['demo-skill']['claude-code'])).toEqual({ ch: '×', tone: 'conflict' });
  });
});

describe('toggleCell', () => {
  it('切换开启/关闭并落盘', () => {
    expect(toggleCell('demo-skill', 'claude-code')).toEqual({
      ok: true,
      message: 'demo-skill 已开放给 claude-code（重启示例会话后生效）',
    });
    expect(fs.lstatSync(path.join(agentHome(), '.claude', 'skills', 'demo-skill')).isSymbolicLink()).toBe(true);
    expect(toggleCell('demo-skill', 'claude-code').ok).toBe(true);
    expect(fs.existsSync(path.join(agentHome(), '.claude', 'skills', 'demo-skill'))).toBe(false);
  });

  it('同名真实目录冲突时返回失败消息（不抛出）', () => {
    fs.mkdirSync(path.join(agentHome(), '.claude', 'skills', 'demo-skill'), { recursive: true });
    const res = toggleCell('demo-skill', 'claude-code');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('拒绝覆盖');
  });

  it('未知 skill 返回失败消息', () => {
    expect(toggleCell('nope', 'claude-code').ok).toBe(false);
  });
});

describe('renderTable', () => {
  it('按可见宽度对齐（ANSI 色码不计入列宽）', () => {
    const colored = '\x1b[32myes\x1b[0m';
    const out = renderTable(['h1', 'h2'], [[colored, 'x'], ['b', 'cc']]);
    const strip = (s: string) => s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const lines = out.split('\n');
    expect(new Set(lines.map((l) => strip(l).length))).toEqual(
      new Set([strip(lines[0]).length]),
    );
  });
});

describe('renderStatic', () => {
  it('包含表头、skill、图例与图符', () => {
    enableSkill('demo-skill', ['claude-code']);
    const out = renderStatic(deriveMatrix());
    expect(out).toContain('Skill');
    expect(out).toContain('demo-skill');
    expect(out).toContain('Claude Code');
    expect(out).toContain('✓');
    expect(out).toContain('已开放');
  });

  it('空仓库时提示', () => {
    expect(renderStatic({ skills: [], agents: [], cells: {} })).toContain('中央仓库为空');
  });
});
