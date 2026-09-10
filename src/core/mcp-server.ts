import readline from 'node:readline';
import { skillDir } from '../paths';
import { loadConfig, loadState } from './config';
import { isExposed } from './expose';
import { readSkillDetail } from './skill-detail';
import { readSkillMeta } from '../util/frontmatter';
import { storeSkillNames } from './store';
import { VERSION } from '../version';

/**
 * 最小 MCP server（stdio，newline-delimited JSON-RPC 2.0）：
 * 任何支持 MCP 的 Agent 都能以 C 档策略消费中央仓库。
 *
 * 身份与过滤（矩阵约束在服务端强制）：
 * - 首选在 Agent 的 MCP 配置里声明 `SKILLPOT_AGENT=<agentId>`；
 * - 一旦声明，tools/call 的 agent 参数被**忽略**——否则消费方可以自称任意 Agent 绕过矩阵；
 * - 未声明身份时才退回 agent 参数（兼容人工调试场景），两者都没有则视为"全部已装 skill"。
 * - 通道语义：这里按 `skill × agent` 单元格判定，通用广播列不会自动让某 Agent 可见。
 */
const SERVER_INFO = { name: 'skillpot', version: VERSION };

const TOOLS = [
  {
    name: 'skillpot_list',
    description:
      'List skills enabled for this agent by the SkillPot exposure matrix. ' +
      'Agent identity comes from the SKILLPOT_AGENT env var when set (the "agent" argument is then ignored).',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description:
            'Agent id, e.g. claude-code. Ignored when SKILLPOT_AGENT is set. Omit for all installed skills.',
        },
      },
    },
  },
  {
    name: 'skillpot_read',
    description: 'Read the full SKILL.md of a skill plus its file tree (must be enabled for this agent).',
    inputSchema: {
      type: 'object',
      required: ['skill'],
      properties: { skill: { type: 'string' } },
    },
  },
  {
    name: 'skillpot_search',
    description: 'Search skills by keyword in name/description (limited to skills enabled for this agent).',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
  },
];

/**
 * 解析本次调用代表哪个 Agent：环境变量优先，且不可被 tool 参数放宽/改写。
 * 导出以便测试。
 */
export function effectiveAgentId(param?: unknown): string | undefined {
  const fromEnv = (process.env.SKILLPOT_AGENT ?? '').trim();
  if (fromEnv) return fromEnv;
  const p = typeof param === 'string' ? param.trim() : '';
  return p || undefined;
}

/** agent 缺省时代表"全部已装 skill"（人工调试场景）；给了 agent 就必须落在矩阵内 */
function visibleSkills(agent?: string): { name: string; description: string; source: string }[] {
  const config = loadConfig();
  const state = loadState();
  const names = storeSkillNames().filter((n) => {
    const entry = config.skills[n];
    if (!entry) return false;
    if (!agent) return true;
    return isExposed(entry, state, n, agent);
  });
  return names.map((n) => ({
    name: n,
    description: String(readSkillMeta(skillDir(n))?.description ?? ''),
    source: config.skills[n].source,
  }));
}

function isVisible(skill: string, agent?: string): boolean {
  if (!agent) return true;
  const config = loadConfig();
  const entry = config.skills[skill];
  if (!entry) return false;
  return isExposed(entry, loadState(), skill, agent);
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
        // 环境变量里的身份不可被本次调用覆盖
        const agent = effectiveAgentId(args.agent);
        let text: string;
        const isError = false;
        if (name === 'skillpot_list') {
          text = fmtList(visibleSkills(agent));
        } else if (name === 'skillpot_read') {
          const skill = String(args.skill);
          if (agent && !isVisible(skill, agent)) {
            return respond({
              content: [
                {
                  type: 'text',
                  text: `skill '${skill}' 未对 ${agent} 开放（SkillPot 开关矩阵），拒绝读取`,
                },
              ],
              isError: true,
            });
          }
          const detail = readSkillDetail(skill);
          if (!detail || detail.skillMd === null) {
            return respond({
              content: [{ type: 'text', text: `skill not found: ${args.skill}` }],
              isError: true,
            });
          }
          text =
            detail.skillMd +
            '\n\n--- files ---\n' +
            detail.files.map((f) => '- ' + f).join('\n');
        } else if (name === 'skillpot_search') {
          const q = String(args.query ?? '').toLowerCase();
          const list = visibleSkills(agent).filter(
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
  const declared = (process.env.SKILLPOT_AGENT ?? '').trim();
  console.error(
    declared
      ? `skillpot MCP server (stdio) ready — agent 身份已固定为 ${declared}（由 SKILLPOT_AGENT 声明，tools/call 的 agent 参数被忽略）`
      : 'skillpot MCP server (stdio) ready — 建议在 Agent 的 MCP 配置里设 SKILLPOT_AGENT=<agentId>，否则开关矩阵无法按 Agent 过滤',
  );
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const out = handleMcpMessage(line);
    if (out) process.stdout.write(out + '\n');
  });
  rl.on('close', () => process.exit(0));
}
