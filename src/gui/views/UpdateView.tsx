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
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
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

  const statusOf = (name: string): UpdateResult | undefined =>
    results?.find((r) => r.skill === name);

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
        <button className="btn small-btn primary" onClick={checkAll} disabled={busy}>
          {busy ? '检查中…（拉取远端）' : '检查更新（Git 来源）'}
        </button>
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
          </span>
        </div>
      )}

      <table className="matrix update-table">
        <thead>
          <tr>
            <th className="skill-col">Skill 技能</th>
            <th>来源与类型</th>
            <th>更新状态</th>
            <th style={{ width: 100, textAlign: 'center' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => {
            const st = statusOf(s.name);
            const git = isGitSource(s.source);
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
                      <span className="diff-badges">
                        {st.diff.added.length > 0 && (
                          <span className="diff-pill add">+{st.diff.added.length}</span>
                        )}
                        {st.diff.modified.length > 0 && (
                          <span className="diff-pill mod">~{st.diff.modified.length}</span>
                        )}
                        {st.diff.removed.length > 0 && (
                          <span className="diff-pill del">-{st.diff.removed.length}</span>
                        )}
                      </span>
                    )}
                    {st?.detail && <span className="dim small"> ({st.detail})</span>}
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {git ? (
                    <button
                      className={`btn small-btn ${st?.status === 'outdated' ? 'primary' : 'subtle'}`}
                      disabled={updating !== null || st?.status !== 'outdated'}
                      onClick={() => apply(s.name)}
                      title={st?.status === 'outdated' ? '原位拉取并更新' : '当前无待更新内容'}
                    >
                      {updating === s.name ? '更新中…' : '更新'}
                    </button>
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
  );
}
