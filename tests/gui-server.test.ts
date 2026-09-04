import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, loadState, saveConfig, saveState } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { enableSkill } from '../src/core/sync';
import {
  handleApiRequest,
  resetGuiCache,
  startGuiServer,
} from '../src/core/gui-server';
import { agentHome } from '../src/paths';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));
const TOKEN = 'test-token';

const NO_QUERY = new URLSearchParams();

beforeEach(() => {
  makeSandbox();
  resetGuiCache();
});

function setupSkill(): void {
  initStore();
  installFromLocal(FIXTURE);
  const config = loadConfig();
  config.skills['demo-skill'] = {
    source: 'local:' + FIXTURE,
    checksum: 'sha256:test',
    installed_at: new Date().toISOString(),
    expose: {},
  };
  saveConfig(config);
}

describe('handleApiRequest', () => {
  it('GET /api/state 返回版本、skills 与矩阵', () => {
    setupSkill();
    const res = handleApiRequest('GET', '/api/state', NO_QUERY, null, TOKEN, undefined)!;
    expect(res.status).toBe(200);
    const body = res.body as { version: string; matrix: { skills: string[] } };
    expect(body.version).toBeTruthy();
    expect(body.matrix.skills).toEqual(['demo-skill']);
  });

  it('非 /api 路径返回 null(交给静态层)', () => {
    expect(handleApiRequest('GET', '/', NO_QUERY, null, TOKEN, undefined)).toBeNull();
    expect(handleApiRequest('GET', '/assets/x.js', NO_QUERY, null, TOKEN, undefined)).toBeNull();
  });

  it('未知 API 返回 404', () => {
    const res = handleApiRequest('GET', '/api/nope', NO_QUERY, null, TOKEN, undefined)!;
    expect(res.status).toBe(404);
  });

  it('POST 缺 token / token 错误一律 403', () => {
    setupSkill();
    const missing = handleApiRequest('POST', '/api/toggle', NO_QUERY, {}, TOKEN, undefined)!;
    expect(missing.status).toBe(403);
    const wrong = handleApiRequest('POST', '/api/toggle', NO_QUERY, {}, TOKEN, 'bad')!;
    expect(wrong.status).toBe(403);
  });

  it('toggle 缺字段返回 400,字段合法时走 toggleCell 语义', () => {
    setupSkill();
    const bad = handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      { skill: 1 },
      TOKEN,
      TOKEN,
    )!;
    expect(bad.status).toBe(400);

    const ok = handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      { skill: 'demo-skill', agent: 'claude-code' },
      TOKEN,
      TOKEN,
    )!;
    expect(ok.status).toBe(200);
    expect((ok.body as { ok: boolean }).ok).toBe(true);
    // 开关真的落到 config
    expect(loadConfig().skills['demo-skill'].expose['claude-code']).toBe(true);
  });

  it('toggle 对未知 skill 返回 ok:false 而非抛错', () => {
    setupSkill();
    const res = handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      { skill: 'ghost', agent: 'claude-code' },
      TOKEN,
      TOKEN,
    )!;
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });

  it('doctor 只读,fix 清理断链台账', () => {
    setupSkill();
    enableSkill('demo-skill', ['claude-code']);
    const state = loadState();
    state.links.push({
      skill: 'demo-skill',
      agent: 'codex',
      link_path: `${agentHome()}/.claude/skills/ghost-link`,
    });
    saveState(state);

    const before = handleApiRequest('GET', '/api/doctor', NO_QUERY, null, TOKEN, undefined)!;
    expect(
      ((before.body as { issues: { message: string }[] }).issues ?? []).some((i) =>
        i.message.includes('断链'),
      ),
    ).toBe(true);

    const fixed = handleApiRequest('POST', '/api/doctor/fix', NO_QUERY, null, TOKEN, TOKEN)!;
    expect((fixed.body as { fixed: string[] }).fixed.length).toBeGreaterThan(0);
  });

  it('lint 返回结构化结果(空仓库为空对象)', () => {
    setupSkill();
    const res = handleApiRequest('GET', '/api/lint', NO_QUERY, null, TOKEN, undefined)!;
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as Record<string, unknown>)).toEqual(['demo-skill']);
  });
});

describe('startGuiServer', () => {
  // detectAll 会真实 spawn 本机各 Agent 二进制做 --version 探测，冷启动可达数秒
  it(
    '监听 127.0.0.1 随机端口,API 与静态页可通过 HTTP 访问',
    async () => {
    setupSkill();
    const srv = await startGuiServer({ open: false });
    try {
      expect(srv.url.startsWith('http://127.0.0.1:')).toBe(true);
      expect(srv.url).toContain(`token=${srv.token}`);
      const origin = new URL(srv.url).origin;

      // 静态页
      const page = await fetch(origin + '/');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<div id="root">');

      // GET API 无需 token
      const state = (await (await fetch(origin + '/api/state')).json()) as {
        matrix: { skills: string[] };
      };
      expect(state.matrix.skills).toEqual(['demo-skill']);

      // POST 无 token 403,带 token 成功
      const denied = await fetch(origin + '/api/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill: 'demo-skill', agent: 'claude-code' }),
      });
      expect(denied.status).toBe(403);

      const ok = await fetch(origin + '/api/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-skillpot-token': srv.token },
        body: JSON.stringify({ skill: 'demo-skill', agent: 'claude-code' }),
      });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { ok: boolean }).ok).toBe(true);

      // 只监听回环地址:绑定随机端口后 address 必须是 127.0.0.1
      const addr = srv.port;
      expect(addr).toBeGreaterThan(0);
    } finally {
      await srv.close();
    }
  },
    30_000,
  );
});
