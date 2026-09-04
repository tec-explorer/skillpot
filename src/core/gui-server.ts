import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../version';
import { MatrixAgent, deriveMatrix } from '../tui/matrix';
import { toggleCell } from '../tui/cells';
import { fixDoctor, runDoctor } from './doctor';
import { lintSkill } from './lint';
import { storeSkillNames } from './store';
import { loadConfig } from './config';
import { skillDir } from '../paths';
import { addSkill } from './add';
import { adoptSkills, scanAdoptable } from './adopt';
import { readSkillDetail } from './skill-detail';
import { uninstallSkill } from './uninstall';
import { updateSkills } from './update';
import { sanitizeSkillName } from '../util/frontmatter';

/**
 * 本地 Web 控制台：
 * - 仅监听 127.0.0.1；写操作要求 x-skillpot-token 头与启动时生成的随机 token 一致
 *   （防浏览器侧 CSRF / DNS rebinding 借道本机端口改文件系统）
 * - API 核心逻辑抽为纯函数 handleApiRequest（同 mcp-server 的可测模式），socket 层薄封装
 * - 前端静态资源位于 dist/gui/（vite build 产物），npm / git / 源码三种安装形态均随包携带
 */

export interface ApiResult {
  status: number;
  body: unknown;
}

export interface GuiServerHandle {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

// detectAll 会逐个 spawn `<binary> --version`（各 5s 超时），不能每次拉状态都执行；缓存 60s
let agentCache: { at: number; agents: MatrixAgent[] } | null = null;
const AGENT_CACHE_TTL_MS = 60_000;

function cachedAgents(): MatrixAgent[] {
  if (agentCache && Date.now() - agentCache.at < AGENT_CACHE_TTL_MS) return agentCache.agents;
  agentCache = { at: Date.now(), agents: deriveMatrix().agents };
  return agentCache.agents;
}

/** 测试钩子：清空进程内缓存 */
export function resetGuiCache(): void {
  agentCache = null;
}

function lintAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of storeSkillNames()) {
    out[name] = lintSkill(skillDir(name));
  }
  return out;
}

/**
 * 纯函数 API 路由：入参全部来自请求的解构，出参为 {status, body}（add/adopt 等涉及 git 的操作为 async）。
 * 返回 null 表示不是 API 路径（交给静态资源层）。
 */
export async function handleApiRequest(
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
  expectedToken: string,
  gotToken: string | undefined,
): Promise<ApiResult | null> {
  if (!pathname.startsWith('/api/')) return null;

  // 写操作必须携带启动 token
  if (method === 'POST' && gotToken !== expectedToken) {
    return { status: 403, body: { error: 'token 缺失或不匹配，请从终端输出的地址打开 GUI' } };
  }

  try {
    if (method === 'GET' && pathname === '/api/state') {
      return {
        status: 200,
        body: {
          version: VERSION,
          skills: loadConfig().skills,
          matrix: deriveMatrix(cachedAgents()),
        },
      };
    }
    if (method === 'POST' && pathname === '/api/toggle') {
      const b = (body ?? {}) as { skill?: unknown; agent?: unknown };
      if (typeof b.skill !== 'string' || typeof b.agent !== 'string') {
        return { status: 400, body: { error: '需要 skill 与 agent 字符串字段' } };
      }
      return { status: 200, body: toggleCell(b.skill, b.agent) };
    }
    if (method === 'GET' && pathname === '/api/adopt') {
      const config = loadConfig();
      const agents = cachedAgents()
        .filter((a) => a.installed)
        .map((a) => ({
          id: a.id,
          name: a.name,
          skills: scanAdoptable(a.id).map((s) => {
            let valid = true;
            let inStore = false;
            try {
              const n = sanitizeSkillName(s.name);
              inStore = !!config.skills[n] || fs.existsSync(skillDir(n));
            } catch {
              valid = false;
            }
            return { name: s.name, path: s.path, valid, inStore };
          }),
        }));
      return { status: 200, body: { agents } };
    }
    if (method === 'POST' && pathname === '/api/adopt') {
      const b = (body ?? {}) as {
        picks?: { agent?: unknown; name?: unknown }[];
        move?: unknown;
        enableFor?: unknown;
      };
      const picks = (b.picks ?? []).filter(
        (p): p is { agent: string; name: string } =>
          typeof p?.agent === 'string' && typeof p?.name === 'string',
      );
      if (!picks.length) return { status: 400, body: { error: '没有勾选任何可收编项' } };
      const report = adoptSkills({
        from: [...new Set(picks.map((p) => p.agent))],
        only: picks,
        move: b.move === true,
        enableFor: Array.isArray(b.enableFor)
          ? (b.enableFor.filter((x) => typeof x === 'string') as string[])
          : undefined,
      });
      return { status: 200, body: report };
    }
    if (method === 'POST' && pathname === '/api/add') {
      const b = (body ?? {}) as { source?: unknown; name?: unknown; for?: unknown };
      if (typeof b.source !== 'string') {
        return { status: 400, body: { error: '需要 source 字段（本地目录或 git URL）' } };
      }
      const result = await addSkill(b.source, {
        name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : undefined,
        for: Array.isArray(b.for)
          ? (b.for.filter((x) => typeof x === 'string') as string[])
          : undefined,
      });
      return { status: 200, body: result };
    }
    if (method === 'GET' && pathname.startsWith('/api/skill/')) {
      const name = decodeURIComponent(pathname.slice('/api/skill/'.length));
      const detail = readSkillDetail(name);
      if (!detail) return { status: 404, body: { error: `skill 不存在：${name}` } };
      return { status: 200, body: { ...detail, lint: lintSkill(skillDir(name)) } };
    }
    if (method === 'POST' && pathname === '/api/update') {
      const b = (body ?? {}) as { skill?: unknown; check?: unknown };
      const results = updateSkills(
        typeof b.skill === 'string' && b.skill ? b.skill : undefined,
        { check: b.check === true },
      );
      return { status: 200, body: { results } };
    }
    if (method === 'POST' && pathname === '/api/remove') {
      const b = (body ?? {}) as { skill?: unknown };
      if (typeof b.skill !== 'string' || !b.skill) {
        return { status: 400, body: { error: '需要 skill 字段' } };
      }
      uninstallSkill(b.skill);
      return { status: 200, body: { ok: true, message: `已卸载 ${b.skill}` } };
    }
    if (method === 'GET' && pathname === '/api/doctor') {
      return { status: 200, body: { issues: runDoctor() } };
    }
    if (method === 'POST' && pathname === '/api/doctor/fix') {
      return { status: 200, body: fixDoctor() };
    }
    if (method === 'GET' && pathname === '/api/lint') {
      const skill = query.get('skill');
      if (skill) {
        return { status: 200, body: { [skill]: lintSkill(skillDir(skill)) } };
      }
      return { status: 200, body: lintAll() };
    }
    return { status: 404, body: { error: `未知 API:${method} ${pathname}` } };
  } catch (e) {
    return {
      status: 500,
      body: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 打不开就让用户手动访问终端里打印的地址 */
  }
}

/** GUI 前端产物目录：打包形态 dist/cli.mjs 与 dist/gui/ 同级；源码形态(vitest)回退仓库根 dist/gui */
function guiDistDir(): string {
  const candidates = [
    path.resolve(fileURLToPath(new URL('./gui/', import.meta.url))),
    path.resolve(fileURLToPath(new URL('../../dist/gui/', import.meta.url))),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[0];
}

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const root = guiDistDir();
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('GUI 前端未构建：在项目根目录运行 npm run build:gui（npm 发布包内已自带）。');
    return;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': rel.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

export async function startGuiServer(
  opts: { port?: number; open?: boolean } = {},
): Promise<GuiServerHandle> {
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readBody(req) : null;
        const rawToken = req.headers['x-skillpot-token'];
        const out = await handleApiRequest(
          req.method ?? 'GET',
          url.pathname,
          url.searchParams,
          body,
          token,
          Array.isArray(rawToken) ? rawToken[0] : rawToken,
        );
        if (!out) {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        res.writeHead(out.status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(out.body));
        return;
      }
      serveStatic(url.pathname, res);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
  const url = `http://127.0.0.1:${port}/?token=${token}`;
  if (opts.open !== false) openBrowser(url);
  return {
    url,
    port,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
