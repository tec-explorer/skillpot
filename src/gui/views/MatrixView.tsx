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
  skill: string;
  agentName: string;
  cellStatusText: string;
  analysis?: SuitabilityAnalysis;
}

export function MatrixView({ state, reload, toast, onOpenDetail }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [visible, setVisible] = useState(20);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const { matrix } = state;

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matrix.skills.filter((s) => {
      if (q && !s.toLowerCase().includes(q)) return false;
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
  }, [matrix, query, statusFilter]);

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
                      <span className="skill-info-tag">详情 ↗</span>
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
                          setTooltip({
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                            skill: s,
                            agentName: a.name,
                            cellStatusText: cellTitle(cs),
                            analysis: adv,
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
        </div>
      </div>
      {filteredSkills.length > visible && (
        <div className="load-more">
          <button className="btn" onClick={() => setVisible((v) => v + 20)}>
            加载更多（已显示 {visible}/{filteredSkills.length}）
          </button>
        </div>
      )}
      {filteredSkills.length === 0 && (
        <p className="dim" style={{ textAlign: 'center', marginTop: 16 }}>
          没有匹配的 skill（换个关键词或切回「全部」）。
        </p>
      )}
      {tooltip && (
        <div
          className="advisor-tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          <div className="advisor-tooltip-head">
            <span className="advisor-tooltip-target">
              {tooltip.skill} → {tooltip.agentName}
            </span>
            {tooltip.analysis && (
              <span className={`advisor-level-pill ${tooltip.analysis.level}`}>
                {LEVEL_LABELS[tooltip.analysis.level] || tooltip.analysis.level} ({tooltip.analysis.score}分)
              </span>
            )}
          </div>
          <div className="advisor-tooltip-status">
            状态：{tooltip.cellStatusText}
          </div>
          {tooltip.analysis && (
            <>
              <div className="advisor-tooltip-summary">
                {tooltip.analysis.summary}
              </div>
              <div className="advisor-tooltip-meta">
                <div className="advisor-tooltip-meta-item">
                  <span>⚡ 预估：</span>
                  <span>
                    ~{tooltip.analysis.tokenCost.tokens} tokens (
                    {tooltip.analysis.tokenCost.level === 'light'
                      ? '轻量'
                      : tooltip.analysis.tokenCost.level === 'moderate'
                        ? '适中'
                        : '较重'}
                    )
                  </span>
                </div>
                {tooltip.analysis.dependencies.satisfied.length > 0 && (
                  <div className="advisor-tooltip-meta-item">
                    <span>✓ 就绪：</span>
                    <span>{tooltip.analysis.dependencies.satisfied.slice(0, 3).join(', ')}</span>
                  </div>
                )}
                {tooltip.analysis.dependencies.missing.length > 0 && (
                  <div className="advisor-tooltip-meta-item" style={{ color: '#f87171' }}>
                    <span>✗ 缺少：</span>
                    <span>{tooltip.analysis.dependencies.missing.join(', ')}</span>
                  </div>
                )}
              </div>
              {(tooltip.analysis.reasons.pros.length > 0 ||
                tooltip.analysis.reasons.risks.length > 0) && (
                <div className="advisor-tooltip-reasons">
                  {tooltip.analysis.reasons.pros.slice(0, 2).map((p, idx) => (
                    <div key={`p-${idx}`} className="advisor-tooltip-reason pro">
                      <span>•</span>
                      <span>{p}</span>
                    </div>
                  ))}
                  {tooltip.analysis.reasons.risks.slice(0, 2).map((r, idx) => (
                    <div key={`r-${idx}`} className="advisor-tooltip-reason risk">
                      <span>•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="matrix-footer-legend">
        <div className="legend-section">
          <span className="legend-label">开关状态：</span>
          <span className="legend-pill ok">✓ 已开放</span>
          <span className="legend-pill warn">⚠ 漂移缺失</span>
          <span className="legend-pill conflict">! 异常/冲突</span>
          <span className="legend-pill off">· 未开放（点击切换）</span>
        </div>
        <div className="legend-section">
          <span className="legend-label">适配评估：</span>
          <span className="legend-item"><span className="legend-dot rec" /> 推荐</span>
          <span className="legend-item"><span className="legend-dot caution" /> 需留意</span>
          <span className="legend-item"><span className="legend-dot incompatible" /> 缺依赖/不兼容</span>
          <span className="legend-hint">（悬停单元格查看开销与依赖诊断）</span>
        </div>
      </div>
    </div>
  );
}
