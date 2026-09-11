import fs from 'node:fs';
import path from 'node:path';
import { skillpotHome } from '../paths';

/** 原子写文件：先写同目录临时文件并 fsync，再 rename 覆盖（避免中途崩溃留下截断的文件） */
export function writeFileAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 关闭失败无所谓，临时文件下面会被清理 */
      }
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 清理失败不掩盖原始错误 */
    }
    throw e;
  }
}

/** 互斥文件：~/.skillpot/.skillpot.mutex */
function mutexPath(): string {
  return path.join(skillpotHome(), '.skillpot.mutex');
}

/** 持有者进程崩溃留下的陈旧锁超过此时长即可抢占 */
const STALE_MS = 30_000;

/** 进程内已持有的锁深度（同一进程内嵌套调用直接放行，避免自锁死） */
const held = new Map<string, number>();

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(lockPath: string, timeoutMs: number): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}@${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // 锁刚被释放，立刻重试
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `另一个 skillpot 进程正在写入（锁 ${lockPath}）——请等待其完成或删除该文件后重试`,
        );
      }
      sleepSync(50);
    }
  }
}

function release(lockPath: string): void {
  const depth = held.get(lockPath) ?? 0;
  if (depth > 1) {
    held.set(lockPath, depth - 1);
    return;
  }
  held.delete(lockPath);
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* 释放失败：陈旧锁会在超时后被下一个进程抢占 */
  }
}

/**
 * 串行化"读 config/state → 改 → 写回"这段临界区，避免两个进程同时 enable 时
 * last-writer-wins 互相覆盖台账与开关矩阵。
 *
 * 只包裹纯本地文件操作，**不要**把 git 克隆这类慢操作放进来（否则会长时间独占锁）；
 * 同一进程内嵌套调用是安全的（计数式重入）。
 */
export function withLockSync<T>(fn: () => T, opts: { timeoutMs?: number } = {}): T {
  const lockPath = mutexPath();
  const depth = held.get(lockPath) ?? 0;
  held.set(lockPath, depth + 1);
  if (depth === 0) {
    try {
      const defaultTimeout = process.env.SKILLPOT_MUTEX_TIMEOUT_MS
        ? parseInt(process.env.SKILLPOT_MUTEX_TIMEOUT_MS, 10)
        : 5000;
      acquire(lockPath, opts.timeoutMs ?? defaultTimeout);
    } catch (e) {
      held.delete(lockPath);
      throw e;
    }
  }
  try {
    return fn();
  } finally {
    release(lockPath);
  }
}
