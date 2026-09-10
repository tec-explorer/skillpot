import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentAdapter, AgentDetectResult } from '../types';
import { AGENTS } from './registry';
import { agentHome } from '../paths';

function findBinary(bin: string): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, bin);
    try {
      if (fs.statSync(full).isFile()) {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      }
    } catch {
      /* 继续扫描下一个 PATH 目录 */
    }
  }
  return null;
}

function binaryVersion(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (out.trim().split(/\r?\n/)[0] || '').slice(0, 48) || null;
  } catch {
    return null;
  }
}

function shorten(home: string, p: string): string {
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

/** 单个 Agent 检测：PATH 二进制 + 配置目录指纹两类信号；channel 类目标始终可用 */
export function detectAgent(adapter: AgentAdapter): AgentDetectResult {
  const home = agentHome();
  const isChannelTarget = adapter.kind === 'channel';
  const dir = adapter.skillsDir(home);
  const signals: string[] = [];
  // 渠道（~/.agents/skills）不是"装没装某个 Agent"，而是始终可写的共享通道
  let installed = isChannelTarget;
  let version: string | null = null;

  if (isChannelTarget) {
    signals.push('channel:跨工具共享目录');
    if (fs.existsSync(dir)) signals.push(`dir:${shorten(home, dir)}`);
  } else {
    for (const bin of adapter.binaries) {
      if (findBinary(bin)) {
        installed = true;
        signals.push(`binary:${bin}`);
        version = binaryVersion(bin);
        break;
      }
    }
    for (const fp of adapter.fingerprints(home)) {
      if (fs.existsSync(fp)) {
        installed = true;
        signals.push(`dir:${shorten(home, fp)}`);
      }
    }
  }

  return {
    id: adapter.id,
    name: adapter.name,
    kind: adapter.kind ?? 'agent',
    installed,
    signals,
    version,
    skillsDir: dir,
    strategy: adapter.materialize ?? 'symlink',
    verify: adapter.verify ?? 'unverified',
    verified: adapter.verified,
    note: adapter.note,
  };
}

export function detectAll(): AgentDetectResult[] {
  return AGENTS.map(detectAgent);
}
