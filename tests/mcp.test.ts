import { beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig } from '../src/core/config';
import { installFromLocal } from '../src/core/store';
import { enableSkill } from '../src/core/sync';
import { handleMcpMessage } from '../src/core/mcp-server';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo-skill', import.meta.url));

beforeEach(() => {
  makeSandbox();
  initStore();
  installFromLocal(FIXTURE);
  const config = loadConfig();
  config.skills['demo-skill'] = {
    source: 'local:' + FIXTURE,
    checksum: 'sha256:test',
    installed_at: new Date().toISOString(),
    expose: { 'claude-code': true },
  };
  saveConfig(config);
});

function call(method: string, params?: object): any {
  const raw = handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  return raw ? JSON.parse(raw) : null;
}

describe('mcp-server handler', () => {
  it('initialize 返回 serverInfo 与协议版本', () => {
    const res = call('initialize', { protocolVersion: '2024-11-05' });
    expect(res.result.serverInfo.name).toBe('skillpot');
    expect(res.result.protocolVersion).toBe('2024-11-05');
    expect(res.result.capabilities.tools).toEqual({});
  });

  it('notifications 返回 null', () => {
    expect(handleMcpMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull();
  });

  it('tools/list 暴露三个工具', () => {
    const res = call('tools/list');
    expect(res.result.tools.map((t: any) => t.name)).toEqual([
      'skillpot_list',
      'skillpot_read',
      'skillpot_search',
    ]);
  });

  it('skillpot_list 按开关矩阵过滤', () => {
    const all = call('tools/call', { name: 'skillpot_list', arguments: {} });
    expect(all.result.content[0].text).toContain('demo-skill');

    const enabled = call('tools/call', { name: 'skillpot_list', arguments: { agent: 'claude-code' } });
    expect(enabled.result.content[0].text).toContain('demo-skill');

    const filtered = call('tools/call', { name: 'skillpot_list', arguments: { agent: 'gemini-cli' } });
    expect(filtered.result.content[0].text).toBe('(no skills)');
  });

  it('skillpot_read 返回 SKILL.md 全文', () => {
    const res = call('tools/call', { name: 'skillpot_read', arguments: { skill: 'demo-skill' } });
    expect(res.result.content[0].text).toContain('# Demo Skill');
    expect(res.result.isError).toBe(false);
  });

  it('skillpot_search 命中描述关键词', () => {
    const res = call('tools/call', { name: 'skillpot_search', arguments: { query: 'fixture' } });
    expect(res.result.content[0].text).toContain('demo-skill');
  });

  it('未知方法与坏 JSON 返回 JSON-RPC 错误', () => {
    expect(call('nope').error.code).toBe(-32601);
    expect(JSON.parse(handleMcpMessage('not-json')!).error.code).toBe(-32700);
  });
});
