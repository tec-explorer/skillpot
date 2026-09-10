import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRegistryStatus,
  resolveRegistryConfig,
  searchDirectory,
} from '../src/core/market';
import { SkillPotPolicy } from '../src/types';

describe('私有 Registry 对接与认证 (Private Registry Integration)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SKILLPOT_REGISTRY_URL;
    delete process.env.SKILLPOT_REGISTRY_TOKEN;
    delete process.env.SKILLS_API_URL;
    delete process.env.SKILLS_TOKEN;
    delete process.env.CORP_SKILLS_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('resolveRegistryConfig 优先级与配置提取', () => {
    it('缺省状态使用公共 skills.sh 目录，无认证 token', () => {
      const cfg = resolveRegistryConfig();
      expect(cfg.url).toBe('https://skills.sh');
      expect(cfg.isPrivate).toBe(false);
      expect(cfg.token).toBeUndefined();
      expect(cfg.forcePrivate).toBe(false);
    });

    it('通过环境变量 SKILLPOT_REGISTRY_URL 与 SKILLPOT_REGISTRY_TOKEN 配置私有终端', () => {
      process.env.SKILLPOT_REGISTRY_URL = 'https://jfrog.corp.internal/artifactory/agent-skills';
      process.env.SKILLPOT_REGISTRY_TOKEN = 'secret-token-123';

      const cfg = resolveRegistryConfig();
      expect(cfg.url).toBe('https://jfrog.corp.internal/artifactory/agent-skills');
      expect(cfg.isPrivate).toBe(true);
      expect(cfg.token).toBe('secret-token-123');
      expect(cfg.tokenSource).toBe('env:SKILLPOT_REGISTRY_TOKEN');
    });

    it('兼容 Vercel SKILLS_API_URL 与 SKILLS_TOKEN 规范', () => {
      process.env.SKILLS_API_URL = 'https://custom-registry.vercel.app/api';
      process.env.SKILLS_TOKEN = 'vercel-token-456';

      const cfg = resolveRegistryConfig();
      expect(cfg.url).toBe('https://custom-registry.vercel.app/api');
      expect(cfg.isPrivate).toBe(true);
      expect(cfg.token).toBe('vercel-token-456');
      expect(cfg.tokenSource).toBe('env:SKILLS_TOKEN');
    });

    it('策略文件中的 registry 配置拥有最高优先级', () => {
      process.env.SKILLS_API_URL = 'https://lower-priority.com';
      process.env.CORP_SKILLS_TOKEN = 'corp-token-789';

      const policy: SkillPotPolicy = {
        version: 1,
        registry: {
          url: 'https://enterprise-skills.corp.internal/api',
          token_env: 'CORP_SKILLS_TOKEN',
          force_private: true,
        },
      };

      const cfg = resolveRegistryConfig(policy);
      expect(cfg.url).toBe('https://enterprise-skills.corp.internal/api');
      expect(cfg.isPrivate).toBe(true);
      expect(cfg.token).toBe('corp-token-789');
      expect(cfg.tokenSource).toBe('env:CORP_SKILLS_TOKEN');
      expect(cfg.forcePrivate).toBe(true);
    });
  });

  describe('getRegistryStatus 状态提取', () => {
    it('正确生成状态摘要', () => {
      const policy: SkillPotPolicy = {
        version: 1,
        registry: {
          url: 'https://skills.internal',
          token: 'inline-token',
          force_private: true,
        },
      };

      const status = getRegistryStatus(policy);
      expect(status.url).toBe('https://skills.internal');
      expect(status.isPrivate).toBe(true);
      expect(status.hasToken).toBe(true);
      expect(status.forcePrivate).toBe(true);
    });
  });

  describe('searchDirectory 认证头与 force_private 门禁', () => {
    it('当 force_private 为 true 且未配置私有源时，拒绝访问公共源并抛错', async () => {
      const policy: SkillPotPolicy = {
        version: 1,
        registry: {
          force_private: true,
        },
      };

      await expect(searchDirectory('test-query', 10, { policy })).rejects.toThrow(
        '策略已开启 force_private，禁止访问公共 skills.sh 目录',
      );
    });

    it('向私有 Registry 发起请求时注入 Authorization: Bearer 头', async () => {
      process.env.SKILLPOT_REGISTRY_URL = 'https://private-skills.corp.internal';
      process.env.SKILLPOT_REGISTRY_TOKEN = 'corp-auth-token';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            { id: 'corp/tools/deploy', name: 'deploy-tool', source: 'corp/tools', installs: 120 },
          ],
        }),
      });
      global.fetch = mockFetch as any;

      const results = await searchDirectory('deploy');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('deploy-tool');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain('https://private-skills.corp.internal/api/search?q=deploy');
      expect(calledOptions.headers).toEqual({
        Authorization: 'Bearer corp-auth-token',
      });
    });
  });
});
