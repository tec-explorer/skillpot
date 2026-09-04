import { useState } from 'react';
import { api } from '../api';
import { CellState, StateResp, ToggleResp } from '../types';
import { Toast } from '../App';

interface Props {
  state: StateResp;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
  onOpenDetail: (skill: string) => void;
}

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

export function MatrixView({ state, reload, toast, onOpenDetail }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const { matrix } = state;

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
      <table className="matrix">
        <thead>
          <tr>
            <th className="skill-col">Skill</th>
            {matrix.agents.map((a) => (
              <th key={a.id} className={a.installed ? '' : 'agent-off'} title={a.skillsDir}>
                {a.name}
                {!a.installed && <span className="dim">（未检测到）</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.skills.map((s) => (
            <tr key={s}>
              <td
                className="skill-name link"
                title={state.skills[s]?.source ?? ''}
                onClick={() => onOpenDetail(s)}
              >
                {s}
              </td>
              {matrix.agents.map((a) => {
                const cs = matrix.cells[s]?.[a.id];
                if (!cs) return <td key={a.id} className="cell muted">·</td>;
                return (
                  <td
                    key={a.id}
                    className={cellClass(cs) + (busy === `${s}@${a.id}` ? ' busy' : '')}
                    title={cellTitle(cs)}
                    onClick={() => toggle(s, a.id)}
                  >
                    {cellGlyph(cs)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="legend">
        ✓ 已开放　⚠ 漂移（声明开放但链接缺失）　! 链接状态异常　× 外部同名占用　· 未开放
        <span className="dim">　·　点击单元格切换（重启示例会话后生效）</span>
      </p>
    </div>
  );
}
