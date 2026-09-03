import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 为每个用例创建隔离沙箱：
 * - SKILLPOT_HOME       -> 中央仓库位置
 * - SKILLPOT_AGENT_HOME -> 各 Agent 配置目录所在的 home
 * 模块内所有路径函数都在调用时读环境变量，因此无需重新 import。
 */
export function makeSandbox(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpot-test-'));
  process.env.SKILLPOT_HOME = path.join(root, '.skillpot');
  process.env.SKILLPOT_AGENT_HOME = path.join(root, 'agenthome');
  return root;
}

/** 建一个假的 Agent 二进制（可执行脚本），让二进制信号检测可测试 */
export function fakeBinary(dir: string, name: string, versionOut = '1.0.0-test'): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\necho ${versionOut}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}
