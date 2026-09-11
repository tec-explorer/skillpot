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
  const [query, setQuery] = useState('');

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

  const q = query.trim().toLowerCase();
  const visibleAgents =
    agents === null
      ? null
      : agents.map((a) => ({
          ...a,
          skills: a.skills.filter(
            (s) => !q || s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q),
          ),
        }));
  const visibleTotal = (visibleAgents ?? []).reduce((n, a) => n + a.skills.length, 0);

  const toggle = (k: string) => {
    setChecked((p) => {
      const next = new Set(p);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectAgentAll = (agentId: string, skills: { name: string; valid: boolean }[]) => {
    setChecked((p) => {
      const next = new Set(p);
      for (const s of skills) {
        if (s.valid) next.add(keyOf(agentId, s.name));
      }
      return next;
    });
  };

  const unselectAgentAll = (agentId: string, skills: { name: string }[]) => {
    setChecked((p) => {
      const next = new Set(p);
      for (const s of skills) {
        next.delete(keyOf(agentId, s.name));
      }
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
        <div>
          <h2>收编已有 skill{total > 0 ? `（发现 ${total} 个）` : ''}</h2>
          <div className="dim small">将各 Agent 目录中的真实 skill 移入或链接至中央仓库</div>
        </div>
        <button
          className="btn small-btn primary"
          onClick={submit}
          disabled={busy || total === 0 || checked.size === 0}
        >
          {busy ? '收编中…' : `收编勾选项（${checked.size}）`}
        </button>
      </div>

      {total === 0 ? (
        <div className="health-card healthy" style={{ marginTop: 14 }}>
          <div className="health-icon">🛡️</div>
          <div className="health-info">
            <div className="health-title">所有已安装 Agent 目录干净健全，未发现孤立外部技能</div>
            <div className="health-desc">
              各 Agent 的 skills 目录下均为本工具受管软链接或没有外部真实目录。如需新增技能，可通过顶部「安装」或「市场」模块引入。
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="adopt-options-card">
            <label className="adopt-option-item">
              <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
              <div className="adopt-opt-text">
                <span className="opt-title">移动模式（推荐）</span>
                <span className="opt-desc">内容拷入中央仓库后，原目录替换为指向仓库的软链接，来源 Agent 继续无感可用</span>
              </div>
            </label>
            <label className="adopt-option-item">
              <input
                type="checkbox"
                checked={enableAll}
                onChange={(e) => setEnableAll(e.target.checked)}
              />
              <div className="adopt-opt-text">
                <span className="opt-title">收编后自动开放</span>
                <span className="opt-desc">在 SkillPot 开关矩阵中立即将收编成功的 skill 标记为对来源 Agent 开放</span>
              </div>
            </label>
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <input
              className="input grow"
              placeholder="搜索名称 / 路径…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="dim small">
              {visibleTotal}/{total} 项
            </span>
          </div>

          {visibleTotal === 0 ? (
            <div className="matrix-empty-search" style={{ margin: '24px 0' }}>
              <div className="empty-search-icon">🔍</div>
              <div className="empty-search-title">未找到匹配的待收编技能</div>
              <div className="dim small">换个搜索词或点击下方清空搜索</div>
              <button
                className="btn small-btn subtle"
                onClick={() => setQuery('')}
                style={{ marginTop: 10 }}
              >
                清空搜索
              </button>
            </div>
          ) : (
            visibleAgents!
              .filter((a) => a.skills.length > 0)
              .map((a) => (
                <div key={a.id} className="adopt-group">
                  <div className="adopt-agent-header">
                    <div className="adopt-agent-title">
                      <span className="adopt-agent-name">{a.name}</span>
                      <span className="dim small">({a.skills.length} 项)</span>
                    </div>
                    <div className="adopt-agent-actions">
                      <button
                        type="button"
                        className="bulk-pill-btn"
                        onClick={() => selectAgentAll(a.id, a.skills)}
                      >
                        全选
                      </button>
                      <span className="bulk-divider" />
                      <button
                        type="button"
                        className="bulk-pill-btn"
                        onClick={() => unselectAgentAll(a.id, a.skills)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                  <div className="adopt-skills-list">
                    {a.skills.map((s) => {
                      const k = keyOf(a.id, s.name);
                      const isChecked = checked.has(k);
                      return (
                        <label
                          key={s.name}
                          className={`adopt-skill-item ${!s.valid ? 'disabled' : ''} ${isChecked ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            disabled={!s.valid}
                            checked={isChecked}
                            onChange={() => toggle(k)}
                          />
                          <div className="adopt-skill-info">
                            <span className="adopt-skill-name bold">{s.name}</span>
                            <span className="adopt-skill-path dim small mono" title={s.path}>
                              {s.path}
                            </span>
                          </div>
                          <div className="adopt-skill-status">
                            {s.inStore && <span className="badge-warn">仓库已存同名</span>}
                            {!s.valid && <span className="badge-error">名称非法</span>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))
          )}
        </>
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
