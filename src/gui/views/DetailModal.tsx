import { useEffect, useState } from 'react';
import { api } from '../api';
import { SkillDetail, StateResp, ToggleResp } from '../types';

interface Props {
  skill: string;
  state: StateResp;
  onClose: () => void;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

export function DetailModal({ skill, state, onClose, reload, toast }: Props) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    api<SkillDetail>(`/api/skill/${encodeURIComponent(skill)}`)
      .then(setDetail)
      .catch((e: Error) => {
        toast(e.message, true);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);

  const handleToggle = async (agentId: string) => {
    if (toggling) return;
    setToggling(agentId);
    try {
      const r = await api<ToggleResp>('/api/toggle', {
        method: 'POST',
        body: { skill, agent: agentId },
      });
      toast(r.message, !r.ok);
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setToggling(null);
    }
  };

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
          <div>
            <h2>{skill}</h2>
            {state.skills[skill]?.source && (
              <div className="dim small mono" style={{ marginTop: 2 }}>
                {state.skills[skill].source}
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn danger small-btn" onClick={remove} disabled={removing}>
              {removing ? '卸载中…' : '卸载'}
            </button>
            <button className="tab" onClick={onClose} title="按 Esc 亦可关闭">
              关闭 (Esc)
            </button>
          </div>
        </div>
        <div className="modal-body">
          {!detail ? (
            <div className="loading">加载详情…</div>
          ) : (
            <>
              {detail.meta?.description && <p className="detail-desc">{detail.meta.description}</p>}
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
                    <span>🎯 Agent 适用性与就地开关</span>
                    <span className="dim small">点击各 Agent 右侧开关可直接开启或关闭</span>
                  </div>
                  <div className="suitability-grid">
                    {Object.entries(detail.agentSuitability).map(([agentId, sa]) => {
                      const cell = state.matrix.cells[skill]?.[agentId];
                      const isEnabled = cell?.enabled;
                      const agent = state.matrix.agents.find((a) => a.id === agentId);
                      const isInstalled = agent?.installed ?? true;
                      return (
                        <div key={agentId} className="suitability-card">
                          <div className="suitability-card-header">
                            <div className="suitability-header-left">
                              <span className="suitability-card-name">{agent?.name ?? agentId}</span>
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
                            <button
                              type="button"
                              className={`suitability-toggle-btn ${isEnabled ? 'on' : 'off'} ${!isInstalled ? 'disabled' : ''}`}
                              disabled={toggling === agentId || !isInstalled}
                              onClick={() => handleToggle(agentId)}
                              title={
                                !isInstalled
                                  ? '该 Agent 本机未安装'
                                  : isEnabled
                                    ? '点击撤销该 Agent 的开放软链接'
                                    : '点击为该 Agent 创建软链接开放此 Skill'
                              }
                            >
                              {toggling === agentId
                                ? '处理中…'
                                : !isInstalled
                                  ? '未安装'
                                  : isEnabled
                                    ? '✓ 已开启'
                                    : '+ 开启'}
                            </button>
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
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="detail-files">
                <div className="dim small" style={{ marginBottom: 4 }}>包含文件 ({detail.files.length})</div>
                <div className="file-list mono small">
                  {detail.files.map((f) => (
                    <div key={f}>{f}</div>
                  ))}
                </div>
              </div>
              <div style={{ margin: '14px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dim small">SKILL.md 完整提示词指令：</span>
                <span className="dim small mono">{detail.skillMd ? `${detail.skillMd.split('\n').length} 行` : ''}</span>
              </div>
              <pre className="skill-md">{detail.skillMd}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
