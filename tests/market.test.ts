import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig } from '../src/core/config';
import {
  addSource,
  installFromMarket,
  listSources,
  OFFICIAL_URL,
  removeSource,
  scanSource,
} from '../src/core/market';
import { handleApiRequest, resetGuiCache } from '../src/core/gui-server';

const TOKEN = 'test-token';
const NO_QUERY = new URLSearchParams();

let repo = '';

function writeSkill(rel: string, name: string, description: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
  );
}

function commitRepo(): void {
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
}

beforeEach(() => {
  makeSandbox();
  resetGuiCache();
  initStore();
  repo = path.join(makeSandbox(), 'market-repo');
  fs.mkdirSync(repo, { recursive: true });
  writeSkill('skills/alpha', 'alpha', 'Alpha skill for market test.');
  writeSkill('skills/beta', 'beta', 'Beta skill for market test.');
  writeSkill('nested/gamma', 'gamma', 'Gamma skill nested deeper.');
  fs.writeFileSync(path.join(repo, 'README.md'), '# not a skill\n');
  commitRepo();
});

describe('source 管理', () => {
  it('内置官方源始终在列', () => {
    const sources = listSources();
    expect(sources.filter((s) => s.builtin)).toHaveLength(4);
    expect(sources[0].url).toBe(OFFICIAL_URL);
  });

  it('addSource 校验 git 地址、去重;removeSource 移除并保护内置源', () => {
    const s = addSource('file:///tmp/src.git', 'My Source');
    expect(s).toMatchObject({ name: 'My Source', url: 'file:///tmp/src.git', builtin: false });
    expect(listSources()).toHaveLength(5);
    expect(() => addSource('file:///tmp/src.git')).toThrow(/已存在/);
    expect(() => addSource('not-a-git')).toThrow(/不是合法的 git 地址/);
    expect(() => addSource(OFFICIAL_URL)).toThrow(/无需添加/);
    expect(() => removeSource(OFFICIAL_URL)).toThrow(/内置源不可移除/);
    removeSource('file:///tmp/src.git');
    expect(listSources()).toHaveLength(4);
    expect(() => removeSource('file:///tmp/src.git')).toThrow(/源不存在/);
  });
});

describe('scanSource / installFromMarket', () => {
  it('克隆并递归发现全部 SKILL.md 目录,标注已安装', async () => {
    const url = `file://${repo}`;
    const r1 = await scanSource(url);
    expect(r1.cloned).toBe(true);
    expect(r1.skills.map((s) => s.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(r1.skills.every((s) => !s.installed)).toBe(true);

    // 二次扫描命中缓存
    const r2 = await scanSource(url);
    expect(r2.cloned).toBe(false);

    // 安装一个后,扫描结果标注已安装
    await installFromMarket(url, 'skills/alpha');
    const r3 = await scanSource(url);
    expect(r3.skills.find((s) => s.name === 'alpha')?.installed).toBe(true);
    expect(loadConfig().skills['alpha'].source).toBe(`git:file://${repo}#skills/alpha`);
  });

  it('refresh 强制重新克隆', async () => {
    const url = `file://${repo}`;
    await scanSource(url);
    const r = await scanSource(url, { refresh: true });
    expect(r.cloned).toBe(true);
  });

  it('installFromMarket 拒绝非法子目录', async () => {
    const url = `file://${repo}`;
    await expect(installFromMarket(url, '../escape')).rejects.toThrow(/非法子目录/);
  });
});

describe('市场 API(handleApiRequest)', () => {
  it('源列表/扫描/安装全链路;POST 缺 token 403', async () => {
    const url = `file://${repo}`;

    const sources = (await handleApiRequest(
      'GET',
      '/api/market/sources',
      NO_QUERY,
      null,
      TOKEN,
      undefined,
    ))!;
    expect(sources.status).toBe(200);
    expect(
      (sources.body as { sources: { url: string }[] }).sources.some((s) => s.url === OFFICIAL_URL),
    ).toBe(true);

    const denied = (await handleApiRequest(
      'POST',
      '/api/market/install',
      NO_QUERY,
      { url, subdir: 'skills/beta' },
      TOKEN,
      undefined,
    ))!;
    expect(denied.status).toBe(403);

    const scan = (await handleApiRequest(
      'GET',
      '/api/market/scan',
      new URLSearchParams({ url }),
      null,
      TOKEN,
      undefined,
    ))!;
    expect(scan.status).toBe(200);
    expect((scan.body as { skills: unknown[] }).skills.length).toBe(3);

    const inst = (await handleApiRequest(
      'POST',
      '/api/market/install',
      NO_QUERY,
      { url, subdir: 'skills/beta' },
      TOKEN,
      TOKEN,
    ))!;
    expect(inst.status).toBe(200);
    expect(loadConfig().skills['beta']).toBeTruthy();
  });
});
