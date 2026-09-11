import { useState } from 'react';
import { api } from '../api';
import { AddResult } from '../types';
import { Toast } from '../App';

interface Props {
  agents: { id: string; name: string; installed: boolean }[];
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
  onOpenDetail?: (skill: string) => void;
  onNavigateTab?: (tab: 'matrix' | 'doctor' | 'adopt' | 'add' | 'market' | 'update' | 'team' | 'policy') => void;
}

export function AddView({ agents, reload, toast, onOpenDetail, onNavigateTab }: Props) {
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
    <div className="panel add-panel">
      <div className="doctor-head">
        <div>
          <h2>安装 skill 到中央仓库</h2>
          <div className="dim small">
            支持本地目录或 Git URL（带 <code>#subdir</code> 定位子目录），安装后受管于 SkillPot
          </div>
        </div>
      </div>

      <div className="add-form-card">
        <div className="form-group">
          <label className="form-label">
            <span>技能来源路径或 Git URL</span>
            <span className="dim small">（必填）</span>
          </label>
          <input
            className="input full-width"
            placeholder="例如: https://github.com/owner/skills.git#subdir 或 ~/source/my-skill"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <div className="input-hint">
            <span>格式提示：</span>
            <code>repo.git#subdir</code>（定位子目录） · <code>~/path/to/skill</code>（本地目录）
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            <span>技能自定义名称</span>
            <span className="dim small">（可选，留空则自动从目录或 SKILL.md 解析）</span>
          </label>
          <input
            className="input"
            style={{ maxWidth: 360 }}
            placeholder="例如: my-custom-skill"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <div className="form-label-row">
            <span className="form-label">安装后立即开放给 Agent（可选）</span>
            <div className="agent-picker-quick">
              <button
                type="button"
                className="bulk-pill-btn"
                onClick={() => setPicked(new Set(agents.filter((a) => a.installed).map((a) => a.id)))}
              >
                全选已安装
              </button>
              <span className="bulk-divider" />
              <button
                type="button"
                className="bulk-pill-btn"
                onClick={() => setPicked(new Set())}
              >
                清空
              </button>
            </div>
          </div>
          <div className="agent-chips-grid">
            {agents.map((a) => (
              <label
                key={a.id}
                className={`agent-chip ${a.installed ? '' : 'disabled'} ${picked.has(a.id) ? 'checked' : ''}`}
              >
                <input
                  type="checkbox"
                  disabled={!a.installed}
                  checked={picked.has(a.id)}
                  onChange={() => toggleAgent(a.id)}
                />
                <span className="agent-chip-name">{a.name}</span>
                {!a.installed && <span className="agent-chip-off">未安装</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button className="btn primary" onClick={submit} disabled={busy || !source.trim()}>
            {busy ? '安装中…（Git 来源需克隆，可能稍慢）' : '立即安装到中央仓库'}
          </button>
        </div>
      </div>

      {result && (
        <div className="result-box">
          <div className="result-title">✔ 安装成功: {result.name}</div>
          {result.description && <div className="result-desc">{result.description}</div>}
          <div className="result-meta">
            <span className="meta-pill">来源: {result.source}</span>
            <span className="meta-pill mono">校验和: {result.checksum.slice(0, 16)}…</span>
          </div>
          {result.enabled.length > 0 && (
            <div className="result-enabled">
              <span>已开放给:</span>
              {result.enabled.map((agent) => (
                <span key={agent} className="agent-tag-badge">✓ {agent}</span>
              ))}
            </div>
          )}
          {result.skipped.map((s, i) => (
            <div key={i} className="dim small warn-text">
              ⚠ 跳过 {s.agent}: {s.reason}
            </div>
          ))}
          {result.lint.length > 0 && (
            <div className="lint-box" style={{ marginTop: 10 }}>
              <div className="dim small">静态安全扫描发现 {result.lint.length} 个问题:</div>
              {result.lint.map((li, i) => (
                <div key={i} className={li.level === 'error' ? 'warn-text' : 'dim'}>
                  {li.level === 'error' ? '✗' : '⚠'} {li.message}
                </div>
              ))}
            </div>
          )}
          <div className="result-actions" style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            {onOpenDetail && (
              <button
                type="button"
                className="btn small-btn primary"
                onClick={() => onOpenDetail(result.name)}
              >
                查看详情与 Agent 适配 ↗
              </button>
            )}
            {onNavigateTab && (
              <button
                type="button"
                className="btn small-btn subtle"
                onClick={() => onNavigateTab('matrix')}
              >
                返回开关矩阵 ↗
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
