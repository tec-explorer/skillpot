import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBinary, makeSandbox } from './util';
import { detectAgent } from '../src/agents/detect';
import { AGENTS, allAgentIds, getAgent } from '../src/agents/registry';

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
  it('注册表覆盖八家 Agent，另有通用广播渠道', () => {
    expect(AGENTS.filter((a) => a.kind !== 'channel').map((a) => a.id)).toEqual([
      'claude-code',
      'zcode',
      'codex',
      'opencode',
      'gemini-cli',
      'dsh',
      'cursor',
      'amp',
    ]);
    expect(AGENTS.filter((a) => a.kind === 'channel').map((a) => a.id)).toEqual(['broadcast']);
    // all 只展开具体 Agent：广播渠道路径粗粒度，不能混进"对全部 Agent 开放"
    expect(allAgentIds()).toHaveLength(8);
    expect(allAgentIds()).not.toContain('broadcast');
  });

  it('验证等级如实标注：只有实测过的才标 live', () => {
    expect(getAgent('claude-code')!.verify).toBe('live');
    expect(detectAgent(getAgent('claude-code')!).verify).toBe('live');
    // 路径有官方依据但未实机确认链接发现 → 不许标 live
    expect(detectAgent(getAgent('opencode')!).verify).toBe('unverified');
    expect(detectAgent(getAgent('amp')!).verify).toBe('unverified');
    const liveIds = AGENTS.filter((a) => a.verify === 'live').map((a) => a.id);
    expect(liveIds).toEqual(['claude-code']);
  });

  it('落地方式取自适配器（不再一律声称 symlink）', () => {
    expect(detectAgent(getAgent('zcode')!).strategy).toBe('symlink');
  });

  it('通用广播渠道始终可用，不与"装了哪个 Agent"混淆', () => {
    const res = detectAgent(getAgent('broadcast')!);
    expect(res.kind).toBe('channel');
    expect(res.installed).toBe(true);
    expect(res.skillsDir).toBe(path.join(sandbox, 'agenthome', '.agents', 'skills'));
    expect(res.signals).toContain('channel:跨工具共享目录');
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
