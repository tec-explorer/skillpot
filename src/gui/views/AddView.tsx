import { useState } from 'react';
import { api } from '../api';
import { AddResult } from '../types';
import { Toast } from '../App';

interface Props {
  agents: { id: string; name: string; installed: boolean }[];
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

export function AddView({ agents, reload, toast }: Props) {
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);

  const toggleAgent = (id: string) => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<AddResult>('/api/add', {
        method: 'POST',
        body: { source: source.trim(), name: name.trim() || undefined, for: [...picked] },
      });
      setResult(r);
      toast(`已安装 ${r.name}`);
      setSource('');
      setName('');
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>安装 skill</h2>
      <p className="dim">
        本地目录或 git URL（支持 <code>repo#subdir</code> 定位子目录）。安装后内容拷入中央仓库，
        默认不对任何 Agent 开放。
      </p>
      <div className="form-row">
        <input
          className="input grow"
          placeholder="~/path/to/my-skill 或 https://github.com/owner/skills.git#subdir"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </div>
      <div className="form-row">
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="skill 名（可选）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="agent-picker">
          {agents.map((a) => (
            <label key={a.id} className={a.installed ? 'pick' : 'pick off'}>
              <input
                type="checkbox"
                disabled={!a.installed}
                checked={picked.has(a.id)}
                onChange={() => toggleAgent(a.id)}
              />
              {a.name}
            </label>
          ))}
        </div>
      </div>
      <button className="btn" onClick={submit} disabled={busy || !source.trim()}>
        {busy ? '安装中…（git 来源需克隆，可能稍慢）' : '安装'}
      </button>

      {result && (
        <div className="result-box">
          <div className="result-title">✔ {result.name}</div>
          {result.description && <div className="dim">{result.description.slice(0, 160)}</div>}
          <div className="dim mono small">
            source: {result.source} · checksum: {result.checksum.slice(0, 18)}…
          </div>
          {result.enabled.length > 0 && (
            <div>已开放给:{result.enabled.join('、')}</div>
          )}
          {result.skipped.map((s, i) => (
            <div key={i} className="warn-text">
              ⚠ {s.agent}: {s.reason}
            </div>
          ))}
          {result.lint.length > 0 && (
            <div className="lint-box">
              <div className="dim">安装即体检，发现 {result.lint.length} 个问题:</div>
              {result.lint.map((li, i) => (
                <div key={i} className={li.level === 'error' ? 'warn-text' : 'dim'}>
                  {li.level === 'error' ? '✗' : '⚠'} {li.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
