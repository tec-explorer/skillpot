import { useMemo, useState } from 'react';
import { api } from '../api';
import { CellState, StateResp, SuitabilityAnalysis, ToggleResp, VERIFY_LABEL } from '../types';
import { Toast } from '../App';

interface Props {
  state: StateResp;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
  onOpenDetail: (skill: string) => void;
}

type StatusFilter = 'all' | 'enabled' | 'issue' | 'advisor';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'enabled', label: '已开放' },
  { id: 'issue', label: '异常/漂移' },
  { id: 'advisor', label: '适配提醒' },
];

const LEVEL_LABELS: Record<string, string> = {
  recommended: '推荐',
  neutral: '按需',
  caution: '需留意',
  incompatible: '不推荐/缺依赖',
};

/** 与 TUI cellGlyph 同一套语义：✓ 已开放 / ⚠ 漂移 / ! 异常 / × 外部占用 / · 未开放 */
function cellClass(cs: CellState): string {
  if (cs.enabled && cs.managed) return 'cell ok';
  if (cs.enabled && !cs.actual) return 'cell warn';
  if (cs.enabled && cs.actual && !cs.managed) return 'cell conflict';
  if (!cs.enabled && cs.managed) return 'cell warn';
  if (!cs.enabled && cs.actual) return 'cell conflict';
  return 'cell muted';
}

function cellGlyph(cs: CellState): string {
  if (cs.enabled && cs.managed) return '✓';
  if (cs.enabled && !cs.actual) return '⚠';
  if (cs.enabled && cs.actual && !cs.managed) return '!';
  if (!cs.enabled && cs.managed) return '!';
  if (!cs.enabled && cs.actual) return '×';
  return '·';
}

function cellTitle(cs: CellState): string {
  if (cs.enabled && cs.managed) return '已开放（symlink 受管）';
  if (cs.enabled && !cs.actual) return '漂移：声明开放但链接缺失，点击重建';
  if (cs.enabled && cs.actual && !cs.managed) return '冲突：被外部同名条目占用，点击也不生效';
  if (!cs.enabled && cs.managed) return '异常：已关闭但受管链接仍在，点击撤下';
  if (!cs.enabled && cs.actual) return '外部同名占用：非本工具创建，点击无效';
  return '未开放，点击开放';
}

interface TooltipState {
  x: number;
  y: number;
  isBelow: boolean;
  skill: string;
  agentId: string;
}

export function MatrixView({ state, reload, toast, onOpenDetail }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [visible, setVisible] = useState(20);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const { matrix } = state;

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matrix.skills.filter((s) => {
      if (q && !s.toLowerCase().includes(q)) return false;
      if (agentFilter !== 'all') {
        const c = matrix.cells[s]?.[agentFilter];
        if (!c?.enabled) return false;
      }
      if (statusFilter === 'all') return true;
      if (statusFilter === 'advisor') {
        return matrix.agents.some((a) => {
          const adv = matrix.advisor?.[s]?.[a.id];
          return adv && (adv.level === 'caution' || adv.level === 'incompatible');
        });
      }
      const cells = matrix.agents.map((a) => matrix.cells[s]?.[a.id]);
      if (statusFilter === 'enabled') return cells.some((c) => c?.enabled);
      return cells.some(
        (c) =>
          c &&
          ((c.enabled && !c.actual) || (c.enabled && c.actual && !c.managed) || (!c.enabled && c.managed)),
      );
    });
  }, [matrix, query, statusFilter, agentFilter]);

  const visibleSkills = useMemo(
    () => filteredSkills.slice(0, visible),
    [filteredSkills, visible],
  );

  const bulk = async (agentId: string, enable: boolean) => {
    if (busy) return;
    const verb = enable ? '开放' : '关闭';
    const target = matrix.agents.find((a) => a.id === agentId);
    const scope =
      target?.kind === 'channel'
        ? '\n\n注意：这是通用广播列（~/.agents/skills），所有支持该约定的 Agent 都可见，包含未检测到的；事后无法按 Agent 单独关闭。'
        : '';
    if (!window.confirm(`确认对该目标 ${verb}全部 skill？${scope}`)) return;
    setBusy(`bulk:${agentId}`);
    try {
      const r = await api<{ changed: string[]; skipped: { skill: string; reason: string }[] }>(
        '/api/bulk',
        { method: 'POST', body: { agent: agentId, enable } },
      );
      toast(
        `已${verb} ${r.changed.length} 个 skill${r.skipped.length ? `，跳过 ${r.skipped.length} 个` : ''}`,
        r.changed.length === 0,
      );
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const bulkRow = async (skill: string, enable: boolean) => {
    if (busy) return;
    const verb = enable ? '开放' : '关闭';
    setBusy(`row:${skill}`);
    try {
      const r = await api<{ changed: string[]; skipped: { agent: string; reason: string }[] }>(
        '/api/bulk',
        { method: 'POST', body: { skill, enable } },
      );
      toast(
        `已对所有已安装 Agent ${verb} ${skill}（${r.changed.length} 处变更${r.skipped.length ? `，跳过 ${r.skipped.length} 处` : ''}）`,
        r.changed.length === 0,
      );
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (skill: string, agentId: string) => {
    const key = `${skill}@${agentId}`;
    if (busy) return;
    setBusy(key);
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
      setBusy(null);
    }
  };

  if (!matrix.skills.length) {
    return (
      <div className="empty">
        <p>中央仓库为空。</p>
        <p className="dim">
          运行 <code>skillpot adopt</code> 收编各 Agent 已有 skill（<code>--move</code> 为移动模式），
          或 <code>skillpot add</code> 安装。安装后即可在此切换开关。
        </p>
      </div>
    );
  }

  return (
    <div className="matrix-wrap">
      <div className="toolbar">
        <input
          className="input grow"
          placeholder="搜索 skill 名…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(20);
          }}
        />
        <select
          className="agent-select"
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value);
            setVisible(20);
          }}
          title="按特定目标 Agent 筛选已开启的技能"
        >
          <option value="all">全部目标 Agent</option>
          {matrix.agents.map((a) => {
            const count = matrix.skills.filter((s) => matrix.cells[s]?.[a.id]?.enabled).length;
            return (
              <option key={a.id} value={a.id}>
                {a.name}（已开 {count}）
              </option>
            );
          })}
        </select>
        <div className="segment">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={statusFilter === f.id ? 'seg-btn active' : 'seg-btn'}
              onClick={() => {
                setStatusFilter(f.id);
                setVisible(20);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="dim small">
          {filteredSkills.length}/{matrix.skills.length}
        </span>
      </div>
      <div className="matrix-card">
        <div className="matrix-scroll-wrap">
          {filteredSkills.length === 0 ? (
            <div className="matrix-empty-search">
              <div className="empty-search-icon">🔍</div>
              <div className="empty-search-title">未找到匹配的 Skill</div>
              <div className="dim small">尝试更换搜索词、切回「全部」状态或调整目标 Agent</div>
              <button
                className="btn small-btn subtle"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setAgentFilter('all');
                }}
                style={{ marginTop: 12 }}
              >
                重置所有筛选
              </button>
            </div>
          ) : (
            <table className="matrix">
              <thead>
                <tr>
                  <th className="skill-th">Skill 技能</th>
                  {matrix.agents.map((a) => (
                    <th
                      key={a.id}
                      className={[
                        'agent-th',
                        a.installed ? '' : 'agent-off',
                        a.kind === 'channel' ? 'agent-channel' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={`${a.skillsDir}（验证等级：${VERIFY_LABEL[a.verify]}）`}
                    >
                      <div className="agent-th-inner">
                        <div className="agent-th-title-row">
                          <span className="agent-th-name" title={a.name}>
                            {a.name}
                          </span>
                          {a.kind === 'channel' ? (
                            <span className="th-tag channel">广播</span>
                          ) : !a.installed ? (
                            <span className="th-tag off">未装</span>
                          ) : a.verify === 'unverified' ? (
                            <span className="th-tag unverified">待验</span>
                          ) : null}
                        </div>
                        <div className="agent-th-bulk">
                          <button
                            className="bulk-pill-btn"
                            title={`对 ${a.name} 开放全部 skill`}
                            disabled={busy !== null}
                            onClick={() => bulk(a.id, true)}
                          >
                            全开
                          </button>
                          <span className="bulk-divider" />
                          <button
                            className="bulk-pill-btn"
                            title={`对 ${a.name} 关闭全部 skill`}
                            disabled={busy !== null}
                            onClick={() => bulk(a.id, false)}
                          >
                            全停
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleSkills.map((s) => (
                  <tr key={s} className="matrix-row">
                    <td
                      className="skill-cell"
                      title={state.skills[s]?.source ?? ''}
                      onClick={() => onOpenDetail(s)}
                    >
                      <div className="skill-cell-inner">
                        <span className="skill-name-label">{s}</span>
                        <div className="skill-row-actions">
                          <button
                            type="button"
                            className="bulk-mini-btn"
                            title={`对所有已安装 Agent 开启 ${s}`}
                            disabled={busy !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              bulkRow(s, true);
                            }}
                          >
                            全开
                          </button>
                          <span className="bulk-divider mini" />
                          <button
                            type="button"
                            className="bulk-mini-btn"
                            title={`对所有 Agent 关闭 ${s}`}
                            disabled={busy !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              bulkRow(s, false);
                            }}
                          >
                            全停
                          </button>
                          <span className="skill-info-tag">详情 ↗</span>
                        </div>
                      </div>
                    </td>
                    {matrix.agents.map((a) => {
                      const cs = matrix.cells[s]?.[a.id];
                      if (!cs) return <td key={a.id} className="cell-td empty-cell">·</td>;
                      const adv = matrix.advisor?.[s]?.[a.id];
                      const statusKind = cellClass(cs);
                      return (
                        <td
                          key={a.id}
                          className={`cell-td ${a.kind === 'channel' ? 'agent-channel-cell' : ''} ${busy === `${s}@${a.id}` ? 'busy' : ''}`}
                          onClick={() => toggle(s, a.id)}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const isBelow = rect.top < 230;
                            const x = Math.max(170, Math.min(window.innerWidth - 170, rect.left + rect.width / 2));
                            const y = isBelow ? rect.bottom + 8 : rect.top - 8;
                            setTooltip({
                              x,
                              y,
                              isBelow,
                              skill: s,
                              agentId: a.id,
                            });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <div className="token-wrapper">
                            <span className={`token-badge ${statusKind}`}>
                              {statusKind !== 'off' ? cellGlyph(cs) : null}
                            </span>
                            {adv && adv.level !== 'neutral' && (
                              <span className={`advisor-badge-dot ${adv.level}`} />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="matrix-card-footer">
          <div className="matrix-footer-left">
            {filteredSkills.length > visible ? (
              <div className="matrix-load-group">
                <button
                  className="btn-footer primary"
                  onClick={() => setVisible((v) => v + 20)}
                >
                  加载下 20 项（已显示 {visible}/{filteredSkills.length}）
                </button>
                <button
                  className="btn-footer subtle"
                  onClick={() => setVisible(filteredSkills.length)}
                >
                  展开全部 ({filteredSkills.length})
                </button>
              </div>
            ) : (
              <div className="matrix-total-badge">
                <span>已显示全部 {filteredSkills.length} 项 Skill</span>
                {visible > 20 && filteredSkills.length > 20 && (
                  <button
                    className="btn-footer link"
                    onClick={() => setVisible(20)}
                  >
                    收起至前 20 项
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="matrix-footer-right">
            <div className="legend-section compact">
              <span className="legend-label">开关：</span>
              <span className="legend-pill ok" title="Agent 已创建软链接启用">✓ 开放</span>
              <span className="legend-pill warn" title="配置记录开放但磁盘软链接缺失">⚠ 漂移</span>
              <span className="legend-pill conflict" title="冲突或非受管实体文件">! 异常</span>
              <span className="legend-pill off" title="未对该 Agent 开放">· 未开</span>
            </div>
            <div className="legend-sep" />
            <div className="legend-section compact">
              <span className="legend-label">适配：</span>
              <span className="legend-item" title="匹配良好且开销适中"><span className="legend-dot rec" /> 推荐</span>
              <span className="legend-item" title="需留意上下文开销或潜在限制"><span className="legend-dot caution" /> 需留意</span>
              <span className="legend-item" title="缺少依赖工具或渠道冲突"><span className="legend-dot incompatible" /> 缺依赖</span>
            </div>
          </div>
        </div>
      </div>
      {tooltip && matrix.cells[tooltip.skill]?.[tooltip.agentId] && (
        <div
          className={`advisor-tooltip ${tooltip.isBelow ? 'flip-down' : 'flip-up'}`}
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          {(() => {
            const cs = matrix.cells[tooltip.skill][tooltip.agentId];
            const adv = matrix.advisor?.[tooltip.skill]?.[tooltip.agentId];
            const agent = matrix.agents.find((a) => a.id === tooltip.agentId);
            return (
              <>
                <div className="advisor-tooltip-head">
                  <span className="advisor-tooltip-target">
                    {tooltip.skill} → {agent?.name ?? tooltip.agentId}
                  </span>
                  {adv && (
                    <span className={`advisor-level-pill ${adv.level}`}>
                      {LEVEL_LABELS[adv.level] || adv.level} ({adv.score}分)
                    </span>
                  )}
                </div>
                <div className="advisor-tooltip-status">
                  状态：{cellTitle(cs)}
                </div>
                {adv && (
                  <>
                    <div className="advisor-tooltip-summary">
                      {adv.summary}
                    </div>
                    <div className="advisor-tooltip-meta">
                      <div className="advisor-tooltip-meta-item">
                        <span>⚡ 预估：</span>
                        <span>
                          ~{adv.tokenCost.tokens} tokens (
                          {adv.tokenCost.level === 'light'
                            ? '轻量'
                            : adv.tokenCost.level === 'moderate'
                              ? '适中'
                              : '较重'}
                          )
                        </span>
                      </div>
                      {adv.dependencies.satisfied.length > 0 && (
                        <div className="advisor-tooltip-meta-item">
                          <span>✓ 就绪：</span>
                          <span>{adv.dependencies.satisfied.slice(0, 3).join(', ')}</span>
                        </div>
                      )}
                      {adv.dependencies.missing.length > 0 && (
                        <div className="advisor-tooltip-meta-item" style={{ color: '#f87171' }}>
                          <span>✗ 缺少：</span>
                          <span>{adv.dependencies.missing.join(', ')}</span>
                        </div>
                      )}
                    </div>
                    {(adv.reasons.pros.length > 0 ||
                      adv.reasons.risks.length > 0) && (
                      <div className="advisor-tooltip-reasons">
                        {adv.reasons.pros.slice(0, 2).map((p, idx) => (
                          <div key={`p-${idx}`} className="advisor-tooltip-reason pro">
                            <span>•</span>
                            <span>{p}</span>
                          </div>
                        ))}
                        {adv.reasons.risks.slice(0, 2).map((r, idx) => (
                          <div key={`r-${idx}`} className="advisor-tooltip-reason risk">
                            <span>•</span>
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
