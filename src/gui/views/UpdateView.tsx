import { useState } from 'react';
import { api } from '../api';
import { SkillDetail, UpdateResult, UPDATE_STATUS_LABEL } from '../types';
import { Toast } from '../App';

interface Props {
  skills: { name: string; source: string }[];
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
  onOpenDetail: (name: string) => void;
}

const isGitSource = (source: string) => source.startsWith('git:');

export function UpdateView({ skills, reload, toast, onOpenDetail }: Props) {
  const [results, setResults] = useState<UpdateResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [checkingSkill, setCheckingSkill] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = skills.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.source.toLowerCase().includes(q),
  );

  const checkAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ results: UpdateResult[] }>('/api/update', {
        method: 'POST',
        body: { check: true },
      });
      setResults(r.results);
      await reload();
      toast(`已检查 ${r.results.length} 个 Git 技能`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const checkOne = async (skill: string) => {
    if (checkingSkill || busy) return;
    setCheckingSkill(skill);
    try {
      const r = await api<{ results: UpdateResult[] }>('/api/update', {
        method: 'POST',
        body: { skill, check: true },
      });
      const updated = r.results.find((x) => x.skill === skill);
      if (updated) {
        setResults((prev) => {
          if (!prev) return [updated];
          const exists = prev.some((p) => p.skill === skill);
          return exists ? prev.map((p) => (p.skill === skill ? updated : p)) : [...prev, updated];
        });
      }
      toast(`${skill} 检查完成：${updated ? UPDATE_STATUS_LABEL[updated.status] : '无变更'}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setCheckingSkill(null);
    }
  };

  const apply = async (skill: string) => {
    if (updating) return;
    setUpdating(skill);
    try {
      const r = await api<{ results: UpdateResult[] }>('/api/update', {
        method: 'POST',
        body: { skill, check: false },
      });
      setResults((prev) =>
        prev ? prev.map((p) => r.results.find((x) => x.skill === skill) ?? p) : r.results,
      );
      toast(`${skill} 更新操作完成`);
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setUpdating(null);
    }
  };

  const applyAllOutdated = async () => {
    if (updating || busy) return;
    const targets = (results ?? []).filter((r) => r.status === 'outdated');
    if (!targets.length) return;
    setUpdating('ALL');
    let successCount = 0;
    try {
      for (const t of targets) {
        const r = await api<{ results: UpdateResult[] }>('/api/update', {
          method: 'POST',
          body: { skill: t.skill, check: false },
        });
        setResults((prev) =>
          prev ? prev.map((p) => r.results.find((x) => x.skill === t.skill) ?? p) : r.results,
        );
        successCount++;
      }
      toast(`成功批量更新 ${successCount} 个技能`);
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setUpdating(null);
    }
  };

  const statusOf = (name: string): UpdateResult | undefined =>
    results?.find((r) => r.skill === name);

  const outdatedCount = (results ?? []).filter((r) => r.status === 'outdated').length;

  if (!skills.length) {
    return (
      <div className="panel">
        <h2>维护</h2>
        <p className="dim">中央仓库为空。先安装或收编 skill。</p>
      </div>
    );
  }

  return (
    <div className="panel update-panel">
      <div className="doctor-head">
        <div>
          <h2>技能维护与更新</h2>
          <div className="dim small">
            检查 Git 来源的技能远端提交，原位拉取更新（软链接指向保持不变，无需重新关联）
          </div>
        </div>
        <div className="doctor-actions">
          {outdatedCount > 0 && (
            <button
              className="btn small-btn primary"
              onClick={applyAllOutdated}
              disabled={updating !== null || busy}
            >
              {updating === 'ALL' ? '全部更新中…' : `全部更新 (${outdatedCount} 项可更新)`}
            </button>
          )}
          <button className="btn small-btn subtle" onClick={checkAll} disabled={busy || updating !== null}>
            {busy ? '检查中…（拉取远端）' : '检查全部（Git 来源）'}
          </button>
        </div>
      </div>

      {skills.length > 0 && (
        <div className="toolbar" style={{ marginTop: 14 }}>
          <input
            className="input grow"
            placeholder="搜索名称 / 来源…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="dim small">
            {filtered.length}/{skills.length} 项
            {outdatedCount > 0 && ` · ${outdatedCount} 项可更新`}
          </span>
        </div>
      )}

      <div className="table-responsive">
        <table className="matrix update-table">
          <thead>
            <tr>
              <th className="skill-col">Skill 技能</th>
              <th>来源与类型</th>
              <th>更新状态</th>
              <th style={{ width: 140, textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const st = statusOf(s.name);
              const git = isGitSource(s.source);
              const isDiffExpanded = expandedDiff === s.name;
              return (
                <tr key={s.name}>
                  <td className="skill-name link" onClick={() => onOpenDetail(s.name)}>
                    <span className="bold">{s.name}</span>
                    <span className="dim small" style={{ marginLeft: 6 }}>↗</span>
                  </td>
                  <td className="src-cell">
                    <span className={`src-badge ${git ? 'git' : 'local'}`}>
                      {git ? 'Git' : '本地'}
                    </span>
                    <span className="dim small mono src-text" title={s.source}>
                      {s.source}
                    </span>
                  </td>
                  <td>
                    <div className="update-status-wrap">
                      {st ? (
                        <span className={`status-pill ${st.status}`}>
                          {UPDATE_STATUS_LABEL[st.status]}
                        </span>
                      ) : (
                        <span className="dim small">未检查</span>
                      )}
                      {st?.diff && (
                        <span
                          className="diff-badges clickable"
                          onClick={() => setExpandedDiff((v) => (v === s.name ? null : s.name))}
                          title="点击查看变动文件明细"
                        >
                          {st.diff.added.length > 0 && (
                            <span className="diff-pill add">+{st.diff.added.length}</span>
                          )}
                          {st.diff.modified.length > 0 && (
                            <span className="diff-pill mod">~{st.diff.modified.length}</span>
                          )}
                          {st.diff.removed.length > 0 && (
                            <span className="diff-pill del">-{st.diff.removed.length}</span>
                          )}
                          <span className="diff-expand-arrow">{isDiffExpanded ? '▲' : '▼'}</span>
                        </span>
                      )}
                      {st?.detail && <span className="dim small"> ({st.detail})</span>}
                    </div>
                    {isDiffExpanded && st?.diff && (
                      <div className="update-diff-drawer">
                        {st.diff.added.map((f) => (
                          <div key={f} className="diff-file-item add">+ {f}</div>
                        ))}
                        {st.diff.modified.map((f) => (
                          <div key={f} className="diff-file-item mod">~ {f}</div>
                        ))}
                        {st.diff.removed.map((f) => (
                          <div key={f} className="diff-file-item del">- {f}</div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {git ? (
                      <div className="row-action-group">
                        <button
                          className="btn small-btn subtle"
                          disabled={checkingSkill === s.name || updating !== null}
                          onClick={() => checkOne(s.name)}
                          title="单独检查此技能的远端更新"
                        >
                          {checkingSkill === s.name ? '…' : '检查'}
                        </button>
                        {st?.status === 'outdated' && (
                          <button
                            className="btn small-btn primary"
                            disabled={updating !== null}
                            onClick={() => apply(s.name)}
                            title="原位拉取并更新"
                          >
                            {updating === s.name ? '…' : '更新'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="dim small">本地跳过</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
