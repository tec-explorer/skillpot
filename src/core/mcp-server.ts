import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { skillDir } from '../paths';
import { loadConfig } from './config';
import { readSkillMeta } from '../util/frontmatter';
import { storeSkillNames } from './store';
import { VERSION } from '../version';

/**
 * 最小 MCP server（stdio，newline-delimited JSON-RPC 2.0）：
 * 任何支持 MCP 的 Agent 都能以 C 档策略消费中央仓库。
 * 通过 SKILLPOT_AGENT=<agentId> 或 tools/call 参数 agent 过滤，遵循开关矩阵。
 */

const SERVER_INFO = { name: 'skillpot', version: VERSION };

const TOOLS = [
  {
    name: 'skillpot_list',
    description:
      'List skills managed by SkillPot. Pass "agent" to only list skills enabled for that agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent id, e.g. claude-code. Omit for all installed skills.' },
      },
    },
  },
  {
    name: 'skillpot_read',
    description: 'Read the full SKILL.md of a skill plus its file tree.',
    inputSchema: {
      type: 'object',
      required: ['skill'],
      properties: { skill: { type: 'string' } },
    },
  },
  {
    name: 'skillpot_search',
    description: 'Search skills by keyword in name/description.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
  },
];

function visibleSkills(agent?: string): { name: string; description: string; source: string }[] {
  const config = loadConfig();
  const names = storeSkillNames().filter((n) => {
    const entry = config.skills[n];
    if (!entry) return false;
    if (agent && entry.expose[agent] !== true) return false;
    return true;
  });
  return names.map((n) => ({
    name: n,
    description: String(readSkillMeta(skillDir(n))?.description ?? ''),
    source: config.skills[n].source,
  }));
}

function fmtList(list: { name: string; description: string }[]): string {
  return list.length ? list.map((s) => `- ${s.name}: ${s.description}`).join('\n') : '(no skills)';
}

/** 处理一条 JSON-RPC 消息，返回响应行；通知返回 null。独立导出以便测试。 */
export function handleMcpMessage(raw: string): string | null {
  const line = raw.trim();
  if (!line) return null;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const { id, method, params } = msg ?? {};
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;

  const respond = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    switch (method) {
      case 'initialize':
        return respond({
          protocolVersion:
            params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case 'ping':
        return respond({});
      case 'tools/list':
        return respond({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments ?? {};
        let text: string;
        let isError = false;
        if (name === 'skillpot_list') {
          text = fmtList(visibleSkills(args.agent ? String(args.agent) : undefined));
        } else if (name === 'skillpot_read') {
          const dir = skillDir(String(args.skill));
          if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
            return respond({
              content: [{ type: 'text', text: `skill not found: ${args.skill}` }],
              isError: true,
            });
          }
          const files: string[] = [];
          const walk = (d: string) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, e.name);
              if (e.isDirectory()) {
                files.push(path.relative(dir, p) + '/');
                walk(p);
              } else {
                files.push(path.relative(dir, p));
              }
            }
          };
          walk(dir);
          text =
            fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8') +
            '\n\n--- files ---\n' +
            files.sort().map((f) => '- ' + f).join('\n');
        } else if (name === 'skillpot_search') {
          const q = String(args.query ?? '').toLowerCase();
          const list = visibleSkills().filter(
            (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
          );
          text = list.length ? fmtList(list) : '(no match)';
        } else {
          return fail(-32602, `unknown tool: ${name}`);
        }
        return respond({ content: [{ type: 'text', text }], isError });
      }
      default:
        return fail(-32601, `method not found: ${method}`);
    }
  } catch (e) {
    return fail(-32603, e instanceof Error ? e.message : String(e));
  }
}

/** 以 stdio 方式运行 MCP server（每行一个 JSON-RPC 消息） */
export function startMcpServer(): void {
  console.error(`skillpot MCP server (stdio) ready — set SKILLPOT_AGENT=<agentId> to filter by expose matrix`);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const out = handleMcpMessage(line);
    if (out) process.stdout.write(out + '\n');
  });
  rl.on('close', () => process.exit(0));
}
