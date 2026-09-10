import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  applyPolicy,
  checkAddAllowed,
  checkEnableAllowed,
  checkPolicy,
  findPolicyFile,
  generatePolicyTemplate,
  isSourceAllowed,
  loadPolicy,
  matchesPattern,
} from '../src/core/policy';
import { addSkill } from '../src/core/add';
import { enableSkill } from '../src/core/sync';
import { loadConfig, loadState, saveConfig } from '../src/core/config';
import { SkillPotPolicy } from '../src/types';

describe('企业/组织级策略引擎 (Enterprise Policy Engine)', () => {
  let sandbox: string;
  let homeDir: string;
  let agentHomeDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpot-policy-test-'));
    homeDir = path.join(sandbox, 'skillpot');
    agentHomeDir = path.join(sandbox, 'agenthome');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(agentHomeDir, { recursive: true });
    process.env.SKILLPOT_HOME = homeDir;
    process.env.SKILLPOT_AGENT_HOME = agentHomeDir;
    delete process.env.SKILLPOT_POLICY_FILE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  function createTestSkillFixture(name: string, content = 'Test skill content'): string {
    const dir = path.join(sandbox, 'fixtures', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}\n${content}\n`,
      'utf8',
    );
    return dir;
  }

  describe('模式匹配与来源校验', () => {
    it('matchesPattern 支持精确匹配、通配符 * 与 ? 且忽略大小写', () => {
      expect(matchesPattern('jailbreak-v1', '*jailbreak*')).toBe(true);
      expect(matchesPattern('JAILBREAK-v1', '*jailbreak*')).toBe(true);
      expect(matchesPattern('prompt-override', 'prompt-*')).toBe(true);
      expect(matchesPattern('safe-skill', '*jailbreak*')).toBe(false);
      expect(matchesPattern('test1', 'test?')).toBe(true);
      expect(matchesPattern('test12', 'test?')).toBe(false);
      expect(matchesPattern('anything', '*')).toBe(true);
    });

    it('isSourceAllowed 检查来源白名单前缀与通配符', () => {
      const allowed = [
        'git:https://github.com/my-corp/*',
        'git:https://github.com/anthropics/*',
      ];
      expect(isSourceAllowed('git:https://github.com/my-corp/sec-tool.git', allowed)).toBe(true);
      expect(isSourceAllowed('git:https://github.com/anthropics/skills.git', allowed)).toBe(true);
      expect(isSourceAllowed('git:https://github.com/hacker/bad-skill.git', allowed)).toBe(false);
      expect(isSourceAllowed('local:/tmp/random', allowed)).toBe(false);

      // 空白名单表示不设限制
      expect(isSourceAllowed('local:/tmp/random', undefined)).toBe(true);
      expect(isSourceAllowed('local:/tmp/random', [])).toBe(true);
    });
  });

  describe('策略文件发现与加载', () => {
    it('findPolicyFile 优先级：显式 > 环境变量 > 工作区 > ~/.skillpot/policy.yaml', () => {
      const explicit = path.join(sandbox, 'custom-policy.yaml');
      fs.writeFileSync(explicit, 'version: 1\nname: explicit\n');
      expect(findPolicyFile(explicit)).toBe(explicit);

      const envPolicy = path.join(sandbox, 'env-policy.yaml');
      fs.writeFileSync(envPolicy, 'version: 1\nname: env\n');
      process.env.SKILLPOT_POLICY_FILE = envPolicy;
      expect(findPolicyFile()).toBe(envPolicy);

      delete process.env.SKILLPOT_POLICY_FILE;
      const userPolicy = path.join(homeDir, 'policy.yaml');
      fs.writeFileSync(userPolicy, 'version: 1\nname: user\n');
      expect(findPolicyFile()).toBe(userPolicy);
    });

    it('loadPolicy 校验版本为 1 并解析完整结构', () => {
      const p = path.join(sandbox, 'test.policy.yaml');
      const policyData: SkillPotPolicy = {
        version: 1,
        name: 'test-policy',
        mode: 'strict',
        registry: {
          url: 'https://skills.corp.internal/api',
          token_env: 'CORP_TOKEN',
          force_private: true,
        },
        enforce: [{ name: 'corp-guard', source: 'git:https://github.com/corp/guard.git', for: 'all' }],
        deny: [{ name: '*jailbreak*', reason: '禁止越狱' }],
        allowed_sources: ['git:https://github.com/corp/*'],
        targets: { broadcast: { allow: false } },
      };
      fs.writeFileSync(p, stringify(policyData));

      const loaded = loadPolicy(p);
      expect(loaded).not.toBeNull();
      expect(loaded!.policy.name).toBe('test-policy');
      expect(loaded!.policy.mode).toBe('strict');
      expect(loaded!.policy.registry?.force_private).toBe(true);
      expect(loaded!.policy.enforce).toHaveLength(1);
      expect(loaded!.policy.deny).toHaveLength(1);
      expect(loaded!.policy.targets?.broadcast?.allow).toBe(false);
    });

    it('loadPolicy 遇到非法版本抛出明确错误', () => {
      const p = path.join(sandbox, 'bad-version.yaml');
      fs.writeFileSync(p, 'version: 2\n');
      expect(() => loadPolicy(p)).toThrow('不支持的策略文件版本');
    });
  });

  describe('checkPolicy 合规检查', () => {
    it('检测缺失的强制技能（enforce_missing）与开放不足（enforce_not_exposed）', async () => {
      const policy: SkillPotPolicy = {
        version: 1,
        mode: 'strict',
        enforce: [
          { name: 'mandatory-skill', source: 'local:/dummy/path', for: 'claude-code,gemini-cli' },
        ],
      };

      // 1. 尚未安装时检测出 enforce_missing
      const res1 = checkPolicy(policy, 'dummy-file.yaml');
      expect(res1.compliant).toBe(false);
      expect(res1.violations.some((v) => v.type === 'enforce_missing')).toBe(true);

      // 2. 安装后但未开放时检测出 enforce_not_exposed
      const fixtureDir = createTestSkillFixture('mandatory-skill');
      await addSkill(fixtureDir, { name: 'mandatory-skill' });
      const res2 = checkPolicy(policy, 'dummy-file.yaml');
      expect(res2.compliant).toBe(false);
      expect(res2.violations.some((v) => v.type === 'enforce_not_exposed' && v.target === 'claude-code')).toBe(true);
      expect(res2.violations.some((v) => v.type === 'enforce_not_exposed' && v.target === 'gemini-cli')).toBe(true);

      // 3. 开放后符合基线
      enableSkill('mandatory-skill', ['claude-code', 'gemini-cli']);
      const res3 = checkPolicy(policy, 'dummy-file.yaml');
      expect(res3.compliant).toBe(true);
      expect(res3.violations).toHaveLength(0);
    });

    it('检测黑名单禁用技能（denied_installed 与 denied_exposed）', async () => {
      const fixtureDir = createTestSkillFixture('bad-jailbreak-tool');
      await addSkill(fixtureDir, { name: 'bad-jailbreak-tool' });
      enableSkill('bad-jailbreak-tool', ['claude-code']);

      const policy: SkillPotPolicy = {
        version: 1,
        deny: [{ name: '*jailbreak*', reason: '越狱危险' }],
      };

      const res = checkPolicy(policy, 'policy.yaml');
      expect(res.compliant).toBe(false);
      expect(res.violations.some((v) => v.type === 'denied_installed')).toBe(true);
      expect(res.violations.some((v) => v.type === 'denied_exposed')).toBe(true);
    });

    it('检测来源白名单违规（disallowed_source）', async () => {
      const fixtureDir = createTestSkillFixture('untrusted-source-skill');
      await addSkill(fixtureDir, { name: 'untrusted-source-skill' });

      const policy: SkillPotPolicy = {
        version: 1,
        allowed_sources: ['git:https://github.com/corp/*'],
      };

      const res = checkPolicy(policy, 'policy.yaml');
      expect(res.compliant).toBe(false);
      expect(res.violations.some((v) => v.type === 'disallowed_source')).toBe(true);
    });

    it('检测受限目标渠道违规（target_disallowed，如禁止 broadcast）', async () => {
      const fixtureDir = createTestSkillFixture('leak-test-skill');
      await addSkill(fixtureDir, { name: 'leak-test-skill' });
      enableSkill('leak-test-skill', ['broadcast']);

      const policy: SkillPotPolicy = {
        version: 1,
        targets: {
          broadcast: { allow: false },
        },
      };

      const res = checkPolicy(policy, 'policy.yaml');
      expect(res.compliant).toBe(false);
      expect(res.violations.some((v) => v.type === 'target_disallowed' && v.target === 'broadcast')).toBe(true);
    });
  });

  describe('运行时拦截（checkAddAllowed 与 checkEnableAllowed）', () => {
    it('添加技能命中 deny 黑名单时被拦截抛错', () => {
      const policy: SkillPotPolicy = {
        version: 1,
        mode: 'strict',
        deny: [{ name: '*jailbreak*', reason: '高危越狱' }],
      };

      expect(() => checkAddAllowed('my-jailbreak-skill', 'git:https://example.com/repo.git', undefined, policy)).toThrow(
        '策略阻断：技能 \'my-jailbreak-skill\'（来源 git:https://example.com/repo.git）命中组织禁用黑名单（高危越狱）',
      );
    });

    it('添加技能来源不在 allowed_sources 白名单时被拦截抛错', () => {
      const policy: SkillPotPolicy = {
        version: 1,
        mode: 'strict',
        allowed_sources: ['git:https://github.com/my-corp/*'],
      };

      expect(() => checkAddAllowed('any-skill', 'git:https://github.com/evil/repo.git', undefined, policy)).toThrow(
        '策略阻断：来源 \'git:https://github.com/evil/repo.git\' 不在组织允许的白名单（allowed_sources）中',
      );
    });

    it('开放技能至被禁用的渠道（如 broadcast）时被拦截抛错', () => {
      const policy: SkillPotPolicy = {
        version: 1,
        targets: { broadcast: { allow: false } },
      };

      expect(() => checkEnableAllowed('demo-skill', ['claude-code', 'broadcast'], policy)).toThrow(
        '策略阻断：组织策略严禁向目标 \'broadcast\' 开放技能',
      );
    });
  });

  describe('applyPolicy 自动化策略修复', () => {
    it('自动卸载禁用技能，补齐强制技能并开启至目标', async () => {
      // 准备一个被禁用的技能
      const badDir = createTestSkillFixture('hacker-jailbreak');
      await addSkill(badDir, { name: 'hacker-jailbreak' });
      enableSkill('hacker-jailbreak', ['claude-code']);

      // 准备一个合规强制技能
      const goodDir = createTestSkillFixture('corp-audit-guard');

      const policy: SkillPotPolicy = {
        version: 1,
        mode: 'strict',
        enforce: [
          { name: 'corp-audit-guard', source: goodDir, for: 'claude-code' },
        ],
        deny: [
          { name: '*jailbreak*' },
        ],
      };

      const pFile = path.join(sandbox, 'policy.yaml');
      fs.writeFileSync(pFile, stringify(policy));

      // 执行策略修复
      const applyRes = await applyPolicy(policy, pFile);
      expect(applyRes.actions.some((a) => a.skill === 'hacker-jailbreak' && a.action === 'uninstalled')).toBe(true);
      expect(applyRes.actions.some((a) => a.skill === 'corp-audit-guard' && a.action === 'installed')).toBe(true);
      expect(applyRes.actions.some((a) => a.skill === 'corp-audit-guard' && a.action === 'exposed')).toBe(true);

      // 验证最终状态已完全合规
      const finalCheck = checkPolicy(policy, pFile);
      expect(finalCheck.compliant).toBe(true);
      expect(finalCheck.violations).toHaveLength(0);
    });

    it('dryRun 模式只返回动作计划，不实际修改磁盘与配置', async () => {
      const goodDir = createTestSkillFixture('enforced-skill');
      const policy: SkillPotPolicy = {
        version: 1,
        enforce: [{ name: 'enforced-skill', source: goodDir, for: 'claude-code' }],
      };
      const pFile = path.join(sandbox, 'policy.yaml');
      fs.writeFileSync(pFile, stringify(policy));

      const res = await applyPolicy(policy, pFile, { dryRun: true });
      expect(res.actions.some((a) => a.action === 'installed' && a.detail.includes('[dry-run]'))).toBe(true);

      // 配置中实际未安装
      const config = loadConfig();
      expect(config.skills['enforced-skill']).toBeUndefined();
    });
  });

  describe('generatePolicyTemplate', () => {
    it('生成合法的策略文件模板', () => {
      const template = generatePolicyTemplate();
      expect(template).toContain('version: 1');
      expect(template).toContain('mode: strict');
      expect(template).toContain('registry:');
      expect(template).toContain('enforce:');
      expect(template).toContain('deny:');
    });
  });
});
