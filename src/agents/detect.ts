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

/** 单个 Agent 检测：PATH 二进制 + 配置目录指纹两类信号 */
export function detectAgent(adapter: AgentAdapter): AgentDetectResult {
  const home = agentHome();
  const signals: string[] = [];
  let installed = false;
  let version: string | null = null;

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

  return {
    id: adapter.id,
    name: adapter.name,
    installed,
    signals,
    version,
    skillsDir: adapter.skillsDir(home),
    strategy: 'symlink',
    verified: adapter.verified,
    note: adapter.note,
  };
}

export function detectAll(): AgentDetectResult[] {
  return AGENTS.map(detectAgent);
}
