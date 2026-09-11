import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { makeSandbox } from './util';
import { policyCacheDir } from '../src/paths';
import { isUrl, loadPolicy, policyCacheFileFor, resolvePolicy } from '../src/core/policy';
import { SkillPotPolicy } from '../src/types';

describe('企业 Remote Policy URL 与离线容灾缓存 (Remote Policy & Offline Fallback)', () => {
  let sandboxRoot = '';
  let server: http.Server | null = null;
  let serverPort = 0;
  let serverHits = 0;
  let policyContent = '';
  let serverOnline = true;

  beforeEach(async () => {
    sandboxRoot = makeSandbox();
    serverHits = 0;
    serverOnline = true;

    const testPolicy: SkillPotPolicy = {
      version: 1,
      name: 'Corp Remote Policy',
      mode: 'strict',
      enforce: [{ skill: 'security-guard', targets: ['claude-code'] }],
      deny: [{ skill: 'risky-*', reason: '企业禁止安装任何 risky 开头技能' }],
    };
    policyContent = stringify(testPolicy);

    server = http.createServer((req, res) => {
      serverHits++;
      if (!serverOnline) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      if (req.url === '/policy.yaml') {
        res.writeHead(200, { 'Content-Type': 'text/yaml' });
        res.end(policyContent);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const addr = server!.address() as { port: number };
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    delete process.env.SKILLPOT_POLICY_URL;
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('isUrl 正确识别 HTTP 与 HTTPS URL', () => {
    expect(isUrl('https://corp.internal/policy.yaml')).toBe(true);
    expect(isUrl('http://127.0.0.1:8080/policy.yaml')).toBe(true);
    expect(isUrl('./skillpot.policy.yaml')).toBe(false);
    expect(isUrl('/etc/skillpot/policy.yaml')).toBe(false);
  });

  it('resolvePolicy 成功从远程 URL 拉取策略并自动在本地建立缓存', async () => {
    const url = `http://127.0.0.1:${serverPort}/policy.yaml`;
    const res = await resolvePolicy({ url });

    expect(res).not.toBeNull();
    expect(res!.file).toBe(url);
    expect(res!.fromCache).toBe(false);
    expect(res!.policy.name).toBe('Corp Remote Policy');
    expect(res!.policy.enforce).toHaveLength(1);
    expect(serverHits).toBe(1);

    // 验证本地磁盘缓存存在
    const cacheFile = policyCacheFileFor(url);
    expect(fs.existsSync(cacheFile)).toBe(true);
    expect(fs.readFileSync(cacheFile, 'utf8')).toContain('Corp Remote Policy');
  });

  it('网络服务离线时，resolvePolicy 自动平滑降级使用本地磁盘缓存 (fromCache=true)', async () => {
    const url = `http://127.0.0.1:${serverPort}/policy.yaml`;

    // 1. 首次成功拉取以写入本地缓存
    const first = await resolvePolicy({ url });
    expect(first!.fromCache).toBe(false);

    // 2. 模拟内网中断/服务宕机
    serverOnline = false;

    // 3. 再次请求：自动降级使用缓存
    const fallback = await resolvePolicy({ url });
    expect(fallback).not.toBeNull();
    expect(fallback!.file).toBe(url);
    expect(fallback!.fromCache).toBe(true);
    expect(fallback!.policy.name).toBe('Corp Remote Policy');
  });

  it('--refresh 强制刷新：在服务器离线时不会静默使用旧缓存，而是抛出刷新失败错误', async () => {
    const url = `http://127.0.0.1:${serverPort}/policy.yaml`;

    // 1. 首次成功写入缓存
    await resolvePolicy({ url });

    // 2. 模拟服务器宕机
    serverOnline = false;

    // 3. 传入 refresh: true，应当明确抛错而不是降级
    await expect(resolvePolicy({ url, refresh: true })).rejects.toThrow(/刷新远程策略失败/);
  });

  it('支持环境变量 SKILLPOT_POLICY_URL 指定远程策略', async () => {
    const url = `http://127.0.0.1:${serverPort}/policy.yaml`;
    process.env.SKILLPOT_POLICY_URL = url;

    const res = await resolvePolicy();
    expect(res).not.toBeNull();
    expect(res!.policy.name).toBe('Corp Remote Policy');
    expect(res!.file).toBe(url);
  });

  it('loadPolicy 能够同步读取已缓存的远程策略 URL', async () => {
    const url = `http://127.0.0.1:${serverPort}/policy.yaml`;

    // 尚未缓存时调用同步 loadPolicy 抛出友好提示
    expect(() => loadPolicy(url)).toThrow(/尚未缓存/);

    // 异步拉取并缓存
    await resolvePolicy({ url });

    // 之后同步 loadPolicy 可立即命中缓存
    const loaded = loadPolicy(url);
    expect(loaded).not.toBeNull();
    expect(loaded!.policy.name).toBe('Corp Remote Policy');
    expect(loaded!.fromCache).toBe(true);
  });
});
