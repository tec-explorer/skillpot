import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { withLockSync, writeFileAtomic } from '../src/util/fsx';
import { skillpotHome } from '../src/paths';
import { emptyConfig, emptyState, loadConfig, loadState, saveConfig, saveState } from '../src/core/config';

function mutexPath(): string {
  return path.join(skillpotHome(), '.skillpot.mutex');
}

beforeEach(() => {
  makeSandbox();
});

describe('writeFileAtomic', () => {
  it('写入内容且不留临时文件', () => {
    const dir = path.join(skillpotHome(), 'nested');
    const file = path.join(dir, 'x.json');
    writeFileAtomic(file, '{"a":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(dir)).toEqual(['x.json']);
  });

  it('覆盖已有文件（不留残影）', () => {
    const file = path.join(skillpotHome(), 'y.txt');
    writeFileAtomic(file, 'first');
    writeFileAtomic(file, 'second');
    expect(fs.readFileSync(file, 'utf8')).toBe('second');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['y.txt']);
  });
});

describe('withLockSync', () => {
  it('嵌套调用计数式重入，不自我死锁', () => {
    const out = withLockSync(() => withLockSync(() => withLockSync(() => 42)));
    expect(out).toBe(42);
    expect(fs.existsSync(mutexPath())).toBe(false);
  });

  it('正常返回与抛异常都释放锁', () => {
    expect(withLockSync(() => 'ok')).toBe('ok');
    expect(fs.existsSync(mutexPath())).toBe(false);

    expect(() =>
      withLockSync(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(fs.existsSync(mutexPath())).toBe(false);
  });

  it('被他人持有且超时 → 明确报错（不静默并发写）', () => {
    fs.mkdirSync(path.dirname(mutexPath()), { recursive: true });
    fs.writeFileSync(mutexPath(), 'other-process');
    expect(() => withLockSync(() => 'x', { timeoutMs: 150 })).toThrow(/另一个 skillpot 进程/);
  });

  it('陈旧锁（持有者已崩溃）可被抢占', () => {
    fs.mkdirSync(path.dirname(mutexPath()), { recursive: true });
    fs.writeFileSync(mutexPath(), 'dead-process');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(mutexPath(), old, old);
    expect(withLockSync(() => 'ok')).toBe('ok');
    expect(fs.existsSync(mutexPath())).toBe(false);
  });
});

describe('配置持久化的健壮性', () => {
  it('lockfile 用 skillpot.lock.json，并清掉旧名 skillspot.lock.json', () => {
    const home = skillpotHome();
    saveConfig(emptyConfig());
    expect(fs.existsSync(path.join(home, 'skillpot.lock.json'))).toBe(true);

    fs.writeFileSync(path.join(home, 'skillspot.lock.json'), '{}');
    saveConfig(emptyConfig());
    expect(fs.existsSync(path.join(home, 'skillspot.lock.json'))).toBe(false);
  });

  it('config.yaml 损坏 → 明确报错，不静默降级为空配置', () => {
    fs.mkdirSync(skillpotHome(), { recursive: true });
    fs.writeFileSync(path.join(skillpotHome(), 'config.yaml'), 'skills: [unclosed\n');
    expect(() => loadConfig()).toThrow(/config\.yaml 解析失败/);
  });

  it('state.json 损坏 → 移出留证并按空台账继续（不悄悄丢证据）', () => {
    const home = skillpotHome();
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'state.json'), '{ this is not json');

    expect(loadState().links).toEqual([]);
    const quarantined = fs.readdirSync(home).filter((n) => n.startsWith('state.json.corrupt-'));
    expect(quarantined).toHaveLength(1);
    expect(fs.readFileSync(path.join(home, quarantined[0]), 'utf8')).toContain('not json');
  });

  it('saveConfig 与 saveState 默认挂接互斥锁，在锁被他人独占时拒绝冲突写入', () => {
    process.env.SKILLPOT_MUTEX_TIMEOUT_MS = '100';
    try {
      fs.mkdirSync(path.dirname(mutexPath()), { recursive: true });
      fs.writeFileSync(mutexPath(), 'another-process-holding-lock');

      // saveConfig 尝试写入时遇到锁被独占 -> 抛错保护，不静默并发覆写
      expect(() => saveConfig(emptyConfig())).toThrow(/另一个 skillpot 进程正在写入/);

      // saveState 尝试写入时遇到锁被独占 -> 抛错保护
      expect(() => saveState(emptyState())).toThrow(/另一个 skillpot 进程正在写入/);

      // 清理模拟的外部进程锁
      fs.rmSync(mutexPath(), { force: true });

      // 释放后可正常落盘
      saveConfig(emptyConfig());
      saveState(emptyState());
      expect(fs.existsSync(path.join(skillpotHome(), 'config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(skillpotHome(), 'state.json'))).toBe(true);
    } finally {
      delete process.env.SKILLPOT_MUTEX_TIMEOUT_MS;
    }
  });
});

