import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import {
  clearDetectCache,
  detectAll,
  detectCachePath,
  DetectCacheData,
  DEFAULT_DETECT_CACHE_TTL_MS,
} from '../src/agents/detect';
import { VERSION } from '../src/version';

let sandbox = '';

beforeEach(() => {
  sandbox = makeSandbox();
  delete process.env.SKILLPOT_NO_DETECT_CACHE;
});

afterEach(() => {
  clearDetectCache();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('Agent 检测本地文件缓存 (Agent Detection Cache)', () => {
  it('首次调用 detectAll 自动生成 .agents-cache.json', () => {
    const cacheFile = detectCachePath();
    expect(fs.existsSync(cacheFile)).toBe(false);

    const res = detectAll();
    expect(res.length).toBeGreaterThan(0);
    expect(fs.existsSync(cacheFile)).toBe(true);

    const data: DetectCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    expect(data.version).toBe(VERSION);
    expect(data.results.length).toBe(res.length);
    expect(data.ttl).toBe(DEFAULT_DETECT_CACHE_TTL_MS);
  });

  it('有效缓存期内直接命中缓存结果', () => {
    detectAll();
    const cacheFile = detectCachePath();

    // 篡改缓存中的结果，证明后续调用直接取自缓存
    const data: DetectCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    data.results[0].name = 'Cached-Mock-Agent';
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');

    const res2 = detectAll();
    expect(res2[0].name).toBe('Cached-Mock-Agent');
  });

  it('缓存过期后自动失效并重新扫描', () => {
    detectAll();
    const cacheFile = detectCachePath();

    // 将时间戳倒拨 10 分钟前
    const data: DetectCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    data.timestamp = Date.now() - (DEFAULT_DETECT_CACHE_TTL_MS + 60_000);
    data.results[0].name = 'Expired-Mock-Agent';
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');

    const res = detectAll();
    expect(res[0].name).not.toBe('Expired-Mock-Agent');
  });

  it('refresh: true 强制忽略缓存并更新', () => {
    detectAll();
    const cacheFile = detectCachePath();

    const data: DetectCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    data.results[0].name = 'Pre-Refresh-Agent';
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');

    const res = detectAll({ refresh: true });
    expect(res[0].name).not.toBe('Pre-Refresh-Agent');

    // 缓存文件内容也被刷新
    const dataRefreshed: DetectCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    expect(dataRefreshed.results[0].name).not.toBe('Pre-Refresh-Agent');
  });

  it('noCache: true 完全不读写缓存', () => {
    const cacheFile = detectCachePath();
    const res = detectAll({ noCache: true });
    expect(res.length).toBeGreaterThan(0);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it('缓存损坏（非法 JSON）时容错回退重新扫描', () => {
    const cacheFile = detectCachePath();
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, 'INVALID_JSON{{{', 'utf8');

    const res = detectAll();
    expect(res.length).toBeGreaterThan(0);

    // 损坏文件被合法的缓存覆盖修复
    const repaired: DetectCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    expect(repaired.version).toBe(VERSION);
  });

  it('clearDetectCache 成功删除缓存', () => {
    detectAll();
    const cacheFile = detectCachePath();
    expect(fs.existsSync(cacheFile)).toBe(true);

    clearDetectCache();
    expect(fs.existsSync(cacheFile)).toBe(false);
  });
});
