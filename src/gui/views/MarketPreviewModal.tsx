import { useEffect, useState } from 'react';
import { api } from '../api';
import { AddResult, MarketSkill, MarketSkillPreview } from '../types';

interface Props {
  skill: MarketSkill;
  url: string;
  agents?: { id: string; name: string; installed: boolean }[];
  onClose: () => void;
  onInstalled: (subdir: string) => void;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

export function MarketPreviewModal({
  skill,
  url,
  agents = [],
  onClose,
  onInstalled,
  reload,
  toast,
}: Props) {
  const [preview, setPreview] = useState<MarketSkillPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [pickedAgents, setPickedAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    api<MarketSkillPreview>(
      `/api/market/preview?url=${encodeURIComponent(url)}&subdir=${encodeURIComponent(skill.subdir)}`,
    )
      .then((data) => {
        setPreview(data);
        setLoading(false);
      })
      .catch((e: Error) => {
        toast(`加载预览失败: ${e.message}`, true);
        onClose();
      });
  }, [url, skill.subdir, toast, onClose]);

  const toggleAgent = (id: string) => {
    setPickedAgents((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const install = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const r = await api<AddResult>('/api/market/install', {
        method: 'POST',
        body: {
          url,
          subdir: skill.subdir,
          for: pickedAgents.size > 0 ? [...pickedAgents] : undefined,
        },
      });
      const enabledMsg = r.enabled.length > 0 ? `，并已开放给 ${r.enabled.join(', ')}` : '';
      toast(`已安装 ${r.name}${enabledMsg}`);
      onInstalled(skill.subdir);
      if (preview) {
        setPreview({ ...preview, installed: true });
      }
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{preview?.name ?? skill.name}</h2>
            <div className="dim small mono" style={{ marginTop: 2 }}>{skill.subdir}</div>
          </div>
          <div className="modal-actions">
            {preview?.installed || skill.installed ? (
              <span className="badge-success">✔ 已安装</span>
            ) : (
              <button className="btn small-btn" onClick={install} disabled={installing || loading}>
                {installing ? '安装中…' : '安装到中央仓库'}
              </button>
            )}
            <button className="tab" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="modal-body">
          {loading || !preview ? (
            <div className="loading" style={{ margin: '24px 0' }}>加载技能详情与提示词…</div>
          ) : (
            <>
              {!preview.installed && !skill.installed && agents.length > 0 && (
                <div className="market-install-agents-box">
                  <div className="form-label-row" style={{ marginBottom: 6 }}>
                    <span className="dim small bold">安装后立即开放给 Agent（可选）：</span>
                    <div className="agent-picker-quick">
                      <button
                        type="button"
                        className="bulk-pill-btn"
                        onClick={() =>
                          setPickedAgents(
                            new Set(agents.filter((a) => a.installed && a.id !== 'broadcast').map((a) => a.id)),
                          )
                        }
                      >
                        全选已安装
                      </button>
                      <span className="bulk-divider" />
                      <button
                        type="button"
                        className="bulk-pill-btn"
                        onClick={() => setPickedAgents(new Set())}
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="agent-chips-grid mini" style={{ marginBottom: 12 }}>
                    {agents
                      .filter((a) => a.installed)
                      .map((a) => (
                        <label
                          key={a.id}
                          className={`agent-chip mini ${pickedAgents.has(a.id) ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={pickedAgents.has(a.id)}
                            onChange={() => toggleAgent(a.id)}
                          />
                          <span className="agent-chip-name">{a.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {preview.description && <p className="preview-desc">{preview.description}</p>}

              <div style={{ margin: '12px 0 8px' }}>
                {preview.lint.length === 0 ? (
                  <span className="lint-badge clean">✔ 静态安全扫描通过（无风险告警）</span>
                ) : (
                  <span className="lint-badge warn">⚠ 发现 {preview.lint.length} 个潜在风险告警</span>
                )}
              </div>

              {preview.lint.length > 0 && (
                <div className="lint-box">
                  {preview.lint.map((li, i) => (
                    <div key={i} className={li.level === 'error' ? 'warn-text' : 'dim'}>
                      {li.level === 'error' ? '✗ [严重]' : '⚠ [告警]'} {li.message}
                    </div>
                  ))}
                </div>
              )}

              <div className="detail-files">
                <div className="dim small" style={{ marginBottom: 4 }}>包含文件 ({preview.files.length})</div>
                <div className="file-list mono small">
                  {preview.files.map((f) => (
                    <div key={f}>{f}</div>
                  ))}
                </div>
              </div>

              <div style={{ margin: '14px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dim small">SKILL.md 完整提示词指令：</span>
                <span className="dim small mono">{preview.skillMd ? `${preview.skillMd.split('\n').length} 行` : ''}</span>
              </div>
              <pre className="skill-md">{preview.skillMd || '（无提示词内容）'}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
