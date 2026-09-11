import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { handleApiRequest, resetGuiCache } from '../src/core/gui-server';
import { initStore, loadConfig, saveConfig } from '../src/core/config';

const TOKEN = 'test-gui-token';
const NO_QUERY = new URLSearchParams();

let sandboxDir: string;

beforeEach(() => {
  sandboxDir = makeSandbox();
  resetGuiCache();
  delete process.env.SKILLPOT_POLICY_FILE;
});

afterEach(() => {
  delete process.env.SKILLPOT_POLICY_FILE;
  const inCwd = path.join(process.cwd(), 'skillpot.policy.yaml');
  if (fs.existsSync(inCwd)) {
    try {
      fs.unlinkSync(inCwd);
    } catch {
      // ignore
    }
  }
});

describe('GUI Policy & Registry API', () => {
  it('GET /api/policy/status 未配置策略时返回 hasPolicy: false', async () => {
    const res = await handleApiRequest(
      'GET',
      '/api/policy/status',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = res!.body as any;
    expect(body.hasPolicy).toBe(false);
    expect(body.file).toBeNull();
    expect(body.policy).toBeNull();
    expect(body.registryStatus).toBeDefined();
    expect(body.registryStatus.url).toBe('https://skills.sh');
  });

  it('POST /api/policy/init 写操作缺少 token 时返回 403', async () => {
    const res = await handleApiRequest(
      'POST',
      '/api/policy/init',
      NO_QUERY,
      {},
      TOKEN,
      undefined,
    );
    expect(res!.status).toBe(403);
  });

  it('POST /api/policy/init 成功创建策略模板并返回状态', async () => {
    const customPolicyPath = path.join(sandboxDir, 'skillpot.policy.yaml');
    const res = await handleApiRequest(
      'POST',
      '/api/policy/init',
      NO_QUERY,
      { file: customPolicyPath },
      TOKEN,
      TOKEN,
    );
    expect(res!.status).toBe(200);
    const body = res!.body as any;
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(fs.existsSync(customPolicyPath)).toBe(true);
    expect(body.policy).toBeDefined();
    expect(body.policy.version).toBe(1);
    expect(body.policy.mode).toBe('strict');

    // 再次调用 init，created 应为 false
    const res2 = await handleApiRequest(
      'POST',
      '/api/policy/init',
      NO_QUERY,
      { file: customPolicyPath },
      TOKEN,
      TOKEN,
    );
    expect(res2!.status).toBe(200);
    expect((res2!.body as any).created).toBe(false);
  });

  it('GET /api/policy/status 在存在策略时返回完整策略与合规状态', async () => {
    const pPath = path.join(sandboxDir, 'skillpot.policy.yaml');
    fs.writeFileSync(
      pPath,
      `version: 1
name: test-corp-policy
mode: strict
deny:
  - name: "*bad*"
    reason: "高危禁止"
targets:
  broadcast:
    allow: false
registry:
  url: "https://skills.corp.internal/api"
  token_env: "TEST_TOKEN"
  force_private: true
`,
      'utf8',
    );
    process.env.SKILLPOT_POLICY_FILE = pPath;

    const res = await handleApiRequest(
      'GET',
      '/api/policy/status',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    );
    expect(res!.status).toBe(200);
    const body = res!.body as any;
    expect(body.hasPolicy).toBe(true);
    expect(body.file).toBe(pPath);
    expect(body.policy.name).toBe('test-corp-policy');
    expect(body.policy.mode).toBe('strict');
    expect(body.checkResult).toBeDefined();
    expect(body.checkResult.compliant).toBe(true); // 无已安装违规
    expect(body.registryStatus.url).toBe('https://skills.corp.internal/api');
    expect(body.registryStatus.isPrivate).toBe(true);
    expect(body.registryStatus.forcePrivate).toBe(true);
  });

  it('POST /api/policy/save 保存并即时重新审查', async () => {
    const pPath = path.join(sandboxDir, 'skillpot.policy.yaml');
    process.env.SKILLPOT_POLICY_FILE = pPath;
    const validYaml = `version: 1
name: saved-policy
mode: audit
deny:
  - name: "*crypto*"
`;
    const res = await handleApiRequest(
      'POST',
      '/api/policy/save',
      NO_QUERY,
      { content: validYaml, file: pPath },
      TOKEN,
      TOKEN,
    );
    expect(res!.status).toBe(200);
    const body = res!.body as any;
    expect(body.ok).toBe(true);
    expect(body.policy.name).toBe('saved-policy');
    expect(body.policy.mode).toBe('audit');
    expect(fs.readFileSync(pPath, 'utf8')).toBe(validYaml);

    // 非法 YAML 或缺少 version 报错
    const badRes = await handleApiRequest(
      'POST',
      '/api/policy/save',
      NO_QUERY,
      { content: 'bad_yaml: [unclosed' },
      TOKEN,
      TOKEN,
    );
    expect(badRes!.status).toBe(500);
    expect((badRes!.body as any).error).toContain('YAML 语法错误');
  });

  it('POST /api/policy/apply 执行 dry-run 与真实修复', async () => {
    initStore();
    const config = loadConfig();
    config.skills['bad-crypto-tool'] = {
      source: 'local:/tmp/bad',
      checksum: 'sha256:1111',
      installed_at: new Date().toISOString(),
      expose: {},
    };
    saveConfig(config);

    const pPath = path.join(sandboxDir, 'skillpot.policy.yaml');
    fs.writeFileSync(
      pPath,
      `version: 1
mode: strict
deny:
  - name: "*bad*"
    reason: "黑名单"
`,
      'utf8',
    );
    process.env.SKILLPOT_POLICY_FILE = pPath;

    // 1. dry-run
    const dryRes = await handleApiRequest(
      'POST',
      '/api/policy/apply',
      NO_QUERY,
      { dryRun: true },
      TOKEN,
      TOKEN,
    );
    expect(dryRes!.status).toBe(200);
    const dryBody = dryRes!.body as any;
    expect(dryBody.applyResult.actions.length).toBeGreaterThan(0);
    expect(dryBody.applyResult.actions[0].detail).toContain('[dry-run]');

    // 2. 实际应用
    const realRes = await handleApiRequest(
      'POST',
      '/api/policy/apply',
      NO_QUERY,
      { dryRun: false },
      TOKEN,
      TOKEN,
    );
    expect(realRes!.status).toBe(200);
    const realBody = realRes!.body as any;
    expect(realBody.applyResult.actions.length).toBeGreaterThan(0);
    expect(realBody.checkResult.compliant).toBe(true);
  });

  it('GET /api/registry/status 独立查询当前 registry 状态', async () => {
    const res = await handleApiRequest(
      'GET',
      '/api/registry/status',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    );
    expect(res!.status).toBe(200);
    const body = res!.body as any;
    expect(body.registryStatus.url).toBe('https://skills.sh');
    expect(body.registryStatus.isPrivate).toBe(false);
  });

  it('GET /api/policy/status 与 POST /api/policy/check 支持远程 url 参数', async () => {
    const crypto = await import('node:crypto');
    const url = 'https://enterprise.internal/policy.yaml';
    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
    const cacheFile = path.join(sandboxDir, '.skillpot', 'cache', 'policy', `${hash}.yaml`);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(
      cacheFile,
      'version: 1\nname: Remote Enterprise\nmode: strict\n',
      'utf8',
    );

    const statusRes = await handleApiRequest(
      'GET',
      '/api/policy/status',
      new URLSearchParams({ url }),
      null,
      TOKEN,
      undefined,
    );
    expect(statusRes!.status).toBe(200);
    const body = statusRes!.body as any;
    expect(body.hasPolicy).toBe(true);
    expect(body.file).toBe(url);
    expect(body.policy.name).toBe('Remote Enterprise');
    expect(body.fromCache).toBe(true);

    const checkRes = await handleApiRequest(
      'POST',
      '/api/policy/check',
      NO_QUERY,
      { url },
      TOKEN,
      TOKEN,
    );
    expect(checkRes!.status).toBe(200);
    const checkBody = checkRes!.body as any;
    expect(checkBody.checkResult.compliant).toBe(true);
  });
});
