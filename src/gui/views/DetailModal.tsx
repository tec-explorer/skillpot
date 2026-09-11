import { useEffect, useState } from 'react';
import { api } from '../api';
import { SkillDetail } from '../types';
import { Toast } from '../App';

interface Props {
  skill: string;
  onClose: () => void;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

export function DetailModal({ skill, onClose, reload, toast }: Props) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    api<SkillDetail>(`/api/skill/${encodeURIComponent(skill)}`)
      .then(setDetail)
      .catch((e: Error) => {
        toast(e.message, true);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);

  const remove = async () => {
    if (removing) return;
    if (!window.confirm(`确认卸载 ${skill}？将撤下所有 Agent 的链接并删除中央仓库内容，不可恢复。`)) {
      return;
    }
    setRemoving(true);
    try {
      await api('/api/remove', { method: 'POST', body: { skill } });
      toast(`已卸载 ${skill}`);
      await reload();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
      setRemoving(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{skill}</h2>
          <div className="modal-actions">
            <button className="btn danger small-btn" onClick={remove} disabled={removing}>
              {removing ? '卸载中…' : '卸载'}
            </button>
            <button className="tab" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div className="modal-body">
          {!detail ? (
            <div className="loading">加载详情…</div>
          ) : (
            <>
              {detail.meta?.description && <p>{detail.meta.description}</p>}
              {detail.lint.length > 0 && (
                <div className="lint-box">
                  <div className="dim">lint:{detail.lint.length} 个问题</div>
                  {detail.lint.map((li, i) => (
                    <div key={i} className={li.level === 'error' ? 'warn-text' : 'dim'}>
                      {li.level === 'error' ? '✗' : '⚠'} {li.message}
                    </div>
                  ))}
                </div>
              )}
              {detail.agentSuitability && Object.keys(detail.agentSuitability).length > 0 && (
                <div className="modal-suitability-section">
                  <div className="modal-suitability-title">
                    <span>🎯 Agent 适用性与开销分析</span>
                    <span className="dim small">基于本地静态扫描与启发式估算</span>
                  </div>
                  <div className="suitability-grid">
                    {Object.entries(detail.agentSuitability).map(([agentId, sa]) => (
                      <div key={agentId} className="suitability-card">
                        <div className="suitability-card-header">
                          <span className="suitability-card-name">{agentId}</span>
                          <span className={`advisor-level-pill ${sa.level}`}>
                            {sa.level === 'recommended'
                              ? '推荐'
                              : sa.level === 'neutral'
                                ? '按需'
                                : sa.level === 'caution'
                                  ? '需留意'
                                  : '不推荐'}{' '}
                            ({sa.score}分)
                          </span>
                        </div>
                        <div className="suitability-card-summary">{sa.summary}</div>
                        <div className="suitability-card-stats">
                          <span>⚡ ~{sa.tokenCost.tokens} tokens</span>
                          {sa.dependencies.satisfied.length > 0 && (
                            <span style={{ color: '#10b981' }}>✓ {sa.dependencies.satisfied.length} 就绪</span>
                          )}
                          {sa.dependencies.missing.length > 0 && (
                            <span style={{ color: '#ef4444' }}>✗ {sa.dependencies.missing.length} 缺失</span>
                          )}
                        </div>
                        {(sa.reasons.pros.length > 0 || sa.reasons.risks.length > 0) && (
                          <div className="suitability-card-list">
                            {sa.reasons.pros.slice(0, 1).map((p, idx) => (
                              <div key={`cp-${idx}`} style={{ color: '#059669' }}>
                                • {p}
                              </div>
                            ))}
                            {sa.reasons.risks.slice(0, 1).map((r, idx) => (
                              <div key={`cr-${idx}`} style={{ color: '#dc2626' }}>
                                • {r}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="detail-files">
                <div className="dim">文件({detail.files.length})</div>
                <div className="file-list mono small">
                  {detail.files.map((f) => (
                    <div key={f}>{f}</div>
                  ))}
                </div>
              </div>
              <pre className="skill-md">{detail.skillMd}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
