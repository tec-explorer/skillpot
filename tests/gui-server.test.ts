import fs from 'node:fs';
import path from 'node:path';
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
import { agentHome, skillDir } from '../src/paths';

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

/** 造一个已检测安装的 claude-code（指纹目录）+ 一个可收编的真实 skill 目录 */
function setupAdoptable(name = 'my-adopt'): string {
  const agentSkills = path.join(agentHome(), '.claude', 'skills');
  const src = path.join(agentSkills, name);
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(src, 'SKILL.md'),
    `---\nname: ${name}\ndescription: adopt fixture\n---\n# ${name}\n`,
  );
  return src;
}

describe('handleApiRequest', () => {
  it('GET /api/state 返回版本、skills 与矩阵', async () => {
    setupSkill();
    const res = (await handleApiRequest(
      'GET',
      '/api/state',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    ))!;
    expect(res.status).toBe(200);
    const body = res.body as { version: string; matrix: { skills: string[] } };
    expect(body.version).toBeTruthy();
    expect(body.matrix.skills).toEqual(['demo-skill']);
  });

  it('非 /api 路径返回 null(交给静态层)', async () => {
    expect(await handleApiRequest('GET', '/', NO_QUERY, null, TOKEN, undefined)).toBeNull();
    expect(
      await handleApiRequest('GET', '/assets/x.js', NO_QUERY, null, TOKEN, undefined),
    ).toBeNull();
  });

  it('未知 API 返回 404', async () => {
    const res = (await handleApiRequest(
      'GET',
      '/api/nope',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    ))!;
    expect(res.status).toBe(404);
  });

  it('POST 缺 token / token 错误一律 403', async () => {
    setupSkill();
    const missing = (await handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      {},
      TOKEN,
      undefined,
    ))!;
    expect(missing.status).toBe(403);
    const wrong = (await handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      {},
      TOKEN,
      'bad',
    ))!;
    expect(wrong.status).toBe(403);
  });

  it('toggle 缺字段返回 400,字段合法时走 toggleCell 语义', async () => {
    setupSkill();
    const bad = (await handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      { skill: 1 },
      TOKEN,
      TOKEN,
    ))!;
    expect(bad.status).toBe(400);

    const ok = (await handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      { skill: 'demo-skill', agent: 'claude-code' },
      TOKEN,
      TOKEN,
    ))!;
    expect(ok.status).toBe(200);
    expect((ok.body as { ok: boolean }).ok).toBe(true);
    expect(loadConfig().skills['demo-skill'].expose['claude-code']).toBe(true);
  });

  it('toggle 对未知 skill 返回 ok:false 而非抛错', async () => {
    setupSkill();
    const res = (await handleApiRequest(
      'POST',
      '/api/toggle',
      NO_QUERY,
      { skill: 'ghost', agent: 'claude-code' },
      TOKEN,
      TOKEN,
    ))!;
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });

  it('GET /api/adopt 只列已安装 Agent 的可收编真实目录并标注 inStore', async () => {
    setupAdoptable();
    initStore();
    const res = (await handleApiRequest('GET', '/api/adopt', NO_QUERY, null, TOKEN, undefined))!;
    expect(res.status).toBe(200);
    const body = res.body as {
      agents: { id: string; skills: { name: string; valid: boolean; inStore: boolean }[] }[];
    };
    const claude = body.agents.find((a) => a.id === 'claude-code')!;
    expect(claude).toBeTruthy();
    expect(claude.skills).toHaveLength(1);
    expect(claude.skills[0]).toMatchObject({ name: 'my-adopt', valid: true, inStore: false });
  });

  it('POST /api/adopt 勾选式收编:move 模式导入并把原目录替换为 symlink', async () => {
    const src = setupAdoptable();
    initStore();
    const res = (await handleApiRequest(
      'POST',
      '/api/adopt',
      NO_QUERY,
      { picks: [{ agent: 'claude-code', name: 'my-adopt' }], move: true },
      TOKEN,
      TOKEN,
    ))!;
    expect(res.status).toBe(200);
    const report = res.body as { imported: number; items: { status: string }[] };
    expect(report.imported).toBe(1);
    // 内容已入中央仓库
    expect(fs.existsSync(path.join(skillDir('my-adopt'), 'SKILL.md'))).toBe(true);
    // 原目录已替换为指向仓库的 symlink
    expect(fs.lstatSync(src).isSymbolicLink()).toBe(true);
    // 收编即登记,且 move 模式来源 Agent 自动开放
    expect(loadConfig().skills['my-adopt'].expose['claude-code']).toBe(true);
  });

  it('POST /api/add 安装本地 fixture 并返回 lint 结果,重复安装报错', async () => {
    const res = (await handleApiRequest(
      'POST',
      '/api/add',
      NO_QUERY,
      { source: FIXTURE, for: ['claude-code'] },
      TOKEN,
      TOKEN,
    ))!;
    expect(res.status).toBe(200);
    const body = res.body as { name: string; lint: unknown[]; enabled: string[] };
    expect(body.name).toBe('demo-skill');
    expect(Array.isArray(body.lint)).toBe(true);
    expect(body.enabled).toEqual(['claude-code']);

    const dup = (await handleApiRequest(
      'POST',
      '/api/add',
      NO_QUERY,
      { source: FIXTURE },
      TOKEN,
      TOKEN,
    ))!;
    expect(dup.status).toBe(500);
    expect((dup.body as { error: string }).error).toContain('已存在');
  });

  it('doctor 只读,fix 清理断链台账', async () => {
    setupSkill();
    enableSkill('demo-skill', ['claude-code']);
    const state = loadState();
    state.links.push({
      skill: 'demo-skill',
      agent: 'codex',
      link_path: `${agentHome()}/.claude/skills/ghost-link`,
    });
    saveState(state);

    const before = (await handleApiRequest(
      'GET',
      '/api/doctor',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    ))!;
    expect(
      ((before.body as { issues: { message: string }[] }).issues ?? []).some((i) =>
        i.message.includes('断链'),
      ),
    ).toBe(true);

    const fixed = (await handleApiRequest(
      'POST',
      '/api/doctor/fix',
      NO_QUERY,
      null,
      TOKEN,
      TOKEN,
    ))!;
    expect((fixed.body as { fixed: string[] }).fixed.length).toBeGreaterThan(0);
  });

  it('lint 返回结构化结果(空仓库为空对象)', async () => {
    setupSkill();
    const res = (await handleApiRequest(
      'GET',
      '/api/lint',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    ))!;
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

        expect(srv.port).toBeGreaterThan(0);
      } finally {
        await srv.close();
      }
    },
    30_000,
  );
});
