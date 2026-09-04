// token 启动引导:终端打印的地址带 ?token=,首次进入时收进 sessionStorage,
// 之后所有请求带 x-skillpot-token 头;地址栏随即清理,避免 token 留在历史记录里。
const qs = new URLSearchParams(location.search);
const t = qs.get('token');
if (t) {
  sessionStorage.setItem('skillpot-token', t);
  history.replaceState(null, '', location.pathname);
}

export function getToken(): string {
  return sessionStorage.getItem('skillpot-token') ?? '';
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(getToken() ? { 'x-skillpot-token': getToken() } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}
