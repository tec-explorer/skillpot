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
    <div className="panel">
      <div className="doctor-head">
        <h2>维护</h2>
        <button className="btn" onClick={checkAll} disabled={busy}>
          {busy ? '检查中…（需克隆远端，可能稍慢）' : '检查更新（git 来源）'}
        </button>
      </div>
      <p className="dim">
        git 来源的 skill 可原位更新（symlink 指向不变，无需重连）；本地来源跳过。点击 skill 名查看详情与卸载。
      </p>

      {skills.length > 0 && (
        <div className="toolbar">
          <input
            className="input grow"
            placeholder="搜索名称 / 来源…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="dim small">
            {filtered.length}/{skills.length}
          </span>
        </div>
      )}

      <table className="matrix update-table">
        <thead>
          <tr>
            <th className="skill-col">Skill</th>
            <th>来源</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => {
            const st = statusOf(s.name);
            const git = isGitSource(s.source);
            return (
              <tr key={s.name}>
                <td className="skill-name link" onClick={() => onOpenDetail(s.name)}>
                  {s.name}
                </td>
                <td className="dim small mono src" title={s.source}>
                  {s.source}
                </td>
                <td className={st?.status === 'outdated' ? 'warn-text' : ''}>
                  {st ? UPDATE_STATUS_LABEL[st.status] : '—'}
                  {st?.detail && <span className="dim small"> {st.detail}</span>}
                </td>
                <td>
                  {git ? (
                    <button
                      className="btn small-btn"
                      disabled={updating !== null || st?.status !== 'outdated'}
                      onClick={() => apply(s.name)}
                      title={st?.status === 'outdated' ? '应用更新' : '先检查更新'}
                    >
                      {updating === s.name ? '更新中…' : '更新'}
                    </button>
                  ) : (
                    <span className="dim small">—</span>
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
