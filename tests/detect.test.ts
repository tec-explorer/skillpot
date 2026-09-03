import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBinary, makeSandbox } from './util';
import { detectAgent } from '../src/agents/detect';
import { AGENTS, getAgent } from '../src/agents/registry';

let sandbox = '';
let origPath = '';

beforeEach(() => {
  sandbox = makeSandbox();
  origPath = process.env.PATH ?? '';
  process.env.PATH = path.join(sandbox, 'bin');
});

afterEach(() => {
  process.env.PATH = origPath;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('agent detect', () => {
  it('注册表覆盖 M1 目标五家', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'claude-code',
      'zcode',
      'codex',
      'opencode',
      'gemini-cli',
    ]);
  });

  it('配置目录指纹可判定安装', () => {
    fs.mkdirSync(path.join(sandbox, 'agenthome', '.codex'), { recursive: true });
    const res = detectAgent(getAgent('codex')!);
    expect(res.installed).toBe(true);
    expect(res.signals.some((s) => s.startsWith('dir:'))).toBe(true);
    expect(res.skillsDir).toBe(path.join(sandbox, 'agenthome', '.codex', 'skills'));
  });

  it('PATH 上的二进制可判定安装并取版本', () => {
    fakeBinary(path.join(sandbox, 'bin'), 'zcode', 'zcode 9.9.9');
    const res = detectAgent(getAgent('zcode')!);
    expect(res.installed).toBe(true);
    expect(res.signals).toContain('binary:zcode');
    expect(res.version).toBe('zcode 9.9.9');
  });

  it('无信号时 installed=false', () => {
    const res = detectAgent(getAgent('gemini-cli')!);
    expect(res.installed).toBe(false);
    expect(res.signals).toEqual([]);
  });
});
