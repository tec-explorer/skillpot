import pc from 'picocolors';
import { loadConfig } from '../core/config';
import { disableSkill, enableSkill } from '../core/sync';
import { Matrix, MatrixAgent, CellState } from './matrix';

export type CellTone = 'ok' | 'warn' | 'conflict' | 'muted';

/** 单元格语义：开放且受管=✓；声明开放但链接缺失=⚠（漂移）；被外部占用=×/! */
export function cellGlyph(cs: CellState): { ch: string; tone: CellTone } {
  if (cs.enabled && cs.managed) return { ch: '✓', tone: 'ok' };
  if (cs.enabled && !cs.actual) return { ch: '⚠', tone: 'warn' };
  if (cs.enabled && cs.actual && !cs.managed) return { ch: '!', tone: 'conflict' };
  if (!cs.enabled && cs.managed) return { ch: '!', tone: 'warn' };
  if (!cs.enabled && cs.actual) return { ch: '×', tone: 'conflict' };
  return { ch: '·', tone: 'muted' };
}

export function paintCell(glyph: { ch: string; tone: CellTone }): string {
  switch (glyph.tone) {
    case 'ok':
      return pc.green(glyph.ch);
    case 'warn':
      return pc.yellow(glyph.ch);
    case 'conflict':
      return pc.red(glyph.ch);
    default:
      return pc.dim(glyph.ch);
  }
}

export const TUI_LEGEND =
  '✓ 已开放   ⚠ 漂移（声明开放但链接缺失）   ! 链接状态异常   × 外部同名占用   · 未开放';

/** 切换单元格：按当前矩阵状态取反；冲突/错误以 message 返回，不抛出 */
export function toggleCell(skill: string, agentId: string): { ok: boolean; message: string } {
  const config = loadConfig();
  const entry = config.skills[skill];
  if (!entry) return { ok: false, message: `skill 不存在：${skill}` };
  const wantEnable = entry.expose[agentId] !== true;
  try {
    const res = wantEnable
      ? enableSkill(skill, [agentId])
      : disableSkill(skill, [agentId]);
    if (res.skipped.length) {
      return { ok: false, message: `${agentId}: ${res.skipped[0].reason}` };
    }
    return {
      ok: true,
      message: `${skill} 已${wantEnable ? '开放' : '关闭'}给 ${agentId}（重启示例会话后生效）`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const colWidth = (a: MatrixAgent): number => Math.max(a.name.length, 3) + 2;

/** 静态文本渲染：非 TTY 环境 / --once 模式使用 */
export function renderStatic(m: Matrix): string {
  if (!m.skills.length) {
    return '中央仓库为空。运行 skillpot adopt 收编各 Agent 已有 skill（--move 为移动模式），或 skillpot add 安装。';
  }
  const nameW = Math.max('Skill'.length, ...m.skills.map((s) => s.length), 5) + 2;
  const pad = (s: string, w: number) => s.padEnd(w);
  const lines: string[] = [];
  lines.push(
    pc.bold(pad('Skill', nameW)) +
      m.agents.map((a) => pc.bold(pad(a.name, colWidth(a)))).join(''),
  );
  for (const s of m.skills) {
    lines.push(
      pad(s, nameW) +
        m.agents.map((a) => pad(paintCell(cellGlyph(m.cells[s][a.id])), colWidth(a))).join(''),
    );
  }
  lines.push('');
  lines.push(pc.dim(TUI_LEGEND));
  return lines.join('\n');
}
