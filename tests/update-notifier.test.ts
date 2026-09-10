import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import {
  checkUpdate,
  formatUpdateBanner,
  getUpdateCachePath,
  isNewerVersion,
} from '../src/util/update-notifier';

let sandboxDir: string;
const origEnv = { ...process.env };

beforeEach(() => {
  sandboxDir = makeSandbox();
  delete process.env.CI;
  delete process.env.CONTINUOUS_INTEGRATION;
  delete process.env.NO_UPDATE_NOTIFIER;
  delete process.env.SKILLPOT_NO_UPDATE_NOTIFIER;
});

afterEach(() => {
  process.env = { ...origEnv };
});

describe('update-notifier', () => {
  describe('isNewerVersion', () => {
    it('正确比对 patch/minor/major 版本升级', () => {
      expect(isNewerVersion('0.16.0', '0.16.1')).toBe(true);
      expect(isNewerVersion('0.16.0', '0.17.0')).toBe(true);
      expect(isNewerVersion('0.16.0', '1.0.0')).toBe(true);
      expect(isNewerVersion('v0.16.0', 'v0.16.1')).toBe(true);
    });

    it('同版本或降级返回 false', () => {
      expect(isNewerVersion('0.16.0', '0.16.0')).toBe(false);
      expect(isNewerVersion('0.16.1', '0.16.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '0.16.0')).toBe(false);
    });
  });

  describe('formatUpdateBanner', () => {
    it('格式化包含版本与升级指引的字符边框', () => {
      const banner = formatUpdateBanner('0.16.0', '0.17.0');
      expect(banner).toContain('Update available: 0.16.0 → 0.17.0');
      expect(banner).toContain('npm i -g @tec-explorer/skillpot');
      expect(banner).toContain('╭');
      expect(banner).toContain('╰');
    });
  });

  describe('checkUpdate', () => {
    it('在 CI 环境变量开启时静默跳过', async () => {
      process.env.CI = 'true';
      const res = await checkUpdate('0.16.0', {
        fetcher: async () => '0.17.0',
      });
      expect(res.hasUpdate).toBe(false);
    });

    it('无缓存时调用 fetcher 获取新版本并写入缓存', async () => {
      let fetchCalled = false;
      const res = await checkUpdate('0.16.0', {
        fetcher: async () => {
          fetchCalled = true;
          return '0.17.0';
        },
      });
      expect(fetchCalled).toBe(true);
      expect(res.hasUpdate).toBe(true);
      expect(res.latestVersion).toBe('0.17.0');

      const cachePath = getUpdateCachePath();
      expect(fs.existsSync(cachePath)).toBe(true);
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      expect(cache.latestVersion).toBe('0.17.0');
    });

    it('缓存有效时直接命中缓存，不触发网络请求', async () => {
      const cachePath = getUpdateCachePath();
      fs.mkdirSync(sandboxDir + '/.skillpot', { recursive: true });
      fs.writeFileSync(
        cachePath,
        JSON.stringify({ lastChecked: Date.now(), latestVersion: '0.18.0' }),
        'utf8',
      );

      let fetchCalled = false;
      const res = await checkUpdate('0.16.0', {
        cacheTtlMs: 60_000,
        fetcher: async () => {
          fetchCalled = true;
          return '0.19.0';
        },
      });
      expect(fetchCalled).toBe(false);
      expect(res.hasUpdate).toBe(true);
      expect(res.latestVersion).toBe('0.18.0');
    });
  });
});
