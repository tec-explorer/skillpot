/** 极简等宽表格渲染：计算列宽/填充时剔除 ANSI 色码，避免彩色单元格错位 */
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - visibleLength(s)));
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(
      visibleLength(h),
      ...rows.map((r) => visibleLength(r[i] ?? '')),
      1,
    ),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c ?? '', widths[i])).join('  ');
  return [line(headers), ...rows.map((r) => line(r))].join('\n');
}
