import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AdoptAgent, AdoptReport, ADOPT_STATUS_LABEL } from '../types';
import { Toast } from '../App';

interface Props {
  /** SSE 变更序号:变化时重新扫描(保留勾选等本地状态,不重挂载) */
  rev: number;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

const STATUS_SUMMARY: { key: keyof AdoptReport; label: string }[] = [
  { key: 'imported', label: '导入' },
  { key: 'linked', label: '链接' },
  { key: 'exists', label: '同名跳过' },
  { key: 'skipped', label: '其他跳过' },
];

export function AdoptView({ rev, reload, toast }: Props) {
  const [agents, setAgents] = useState<AdoptAgent[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [move, setMove] = useState(true);
  const [enableAll, setEnableAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<AdoptReport | null>(null);

  const keyOf = (agent: string, name: string) => `${agent}\u0000${name}`;

  const scan = useCallback(() => {
    api<{ agents: AdoptAgent[] }>('/api/adopt')
      .then((r) => {
        setAgents(r.agents);
        // 默认勾选全部合法项（含仓库已有同名——move 模式下将替换为 symlink）
        setChecked(
          new Set(
            r.agents.flatMap((a) =>
              a.skills.filter((s) => s.valid).map((s) => keyOf(a.id, s.name)),
            ),
          ),
        );
      })
      .catch((e: Error) => toast(e.message, true));
  }, [toast]);

  useEffect(() => {
    scan();
  }, [scan, rev]);

  const toggle = (k: string) => {
    setChecked((p) => {
      const next = new Set(p);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const submit = async () => {
    if (busy || !agents) return;
    const picks = agents.flatMap((a) =>
      a.skills
        .filter((s) => checked.has(keyOf(a.id, s.name)))
        .map((s) => ({ agent: a.id, name: s.name })),
    );
    if (!picks.length) {
      toast('没有勾选任何可收编项', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api<AdoptReport>('/api/adopt', {
        method: 'POST',
        body: {
          picks,
          move,
          enableFor: enableAll ? [...new Set(picks.map((p) => p.agent))] : [],
        },
      });
      setReport(r);
      toast(`收编完成:导入 ${r.imported}、链接 ${r.linked}`);
      await reload();
      scan();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!agents) return <div className="loading">扫描各 Agent 目录中…</div>;

  const total = agents.reduce((n, a) => n + a.skills.length, 0);

  return (
    <div className="panel">
      <div className="doctor-head">
        <h2>收编已有 skill{total > 0 ? `（发现 ${total} 个）` : ''}</h2>
        <button
          className="btn"
          onClick={submit}
          disabled={busy || total === 0 || checked.size === 0}
        >
          {busy ? '收编中…' : `收编勾选项（${checked.size}）`}
        </button>
      </div>
      <div className="form-row options">
        <label className="pick">
          <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
          移动模式（内容拷入后，原目录替换为 symlink，来源 Agent 继续可用）
        </label>
        <label className="pick">
          <input
            type="checkbox"
            checked={enableAll}
            onChange={(e) => setEnableAll(e.target.checked)}
          />
          收编后开放给其来源 Agent
        </label>
      </div>

      {total === 0 ? (
        <p className="dim">
          各已安装 Agent 的 skills 目录下没有可收编的真实目录（受管 symlink 与外部链接会自动跳过）。
        </p>
      ) : (
        agents
          .filter((a) => a.skills.length > 0)
          .map((a) => (
            <div key={a.id} className="adopt-group">
              <div className="adopt-agent">{a.name}</div>
              {a.skills.map((s) => {
                const k = keyOf(a.id, s.name);
                return (
                  <label key={k} className={s.valid ? 'adopt-item' : 'adopt-item off'}>
                    <input
                      type="checkbox"
                      disabled={!s.valid}
                      checked={checked.has(k)}
                      onChange={() => toggle(k)}
                    />
                    <span className="mono">{s.name}</span>
                    <span className="dim small path">{s.path}</span>
                    {s.inStore && (
                      <span className="badge badge-warn">仓库已有同名,move 时替换为 symlink</span>
                    )}
                    {!s.valid && <span className="badge badge-error">目录名不合法</span>}
                  </label>
                );
              })}
            </div>
          ))
      )}

      {report && (
        <div className="result-box">
          <div className="result-title">
            收编完成:{STATUS_SUMMARY.map((s) => `${s.label} ${report[s.key]}`).join(' · ')}
          </div>
          {report.items
            .filter((i) => i.detail && i.status !== 'imported' && i.status !== 'linked')
            .map((i, idx) => (
              <div key={idx} className="dim small">
                {i.agent}/{i.name}:{ADOPT_STATUS_LABEL[i.status]}
                {i.detail ? ` — ${i.detail}` : ''}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
