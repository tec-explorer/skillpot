import { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { deriveMatrix, Matrix } from './matrix';
import { cellGlyph, toggleCell, TUI_LEGEND } from './cells';
import { CellTone } from './cells';

const toneColor: Record<CellTone, string | undefined> = {
  ok: 'green',
  warn: 'yellow',
  conflict: 'red',
  muted: undefined,
};

export function App({ initial }: { initial: Matrix }) {
  const { exit } = useApp();
  const [m, setM] = useState<Matrix>(initial);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);
  const [msg, setMsg] = useState('');

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }
    if (key.upArrow || input === 'k') setRow((r) => Math.max(0, r - 1));
    if (key.downArrow || input === 'j') setRow((r) => Math.min(m.skills.length - 1, r + 1));
    if (key.leftArrow || input === 'h') setCol((c) => Math.max(0, c - 1));
    if (key.rightArrow || input === 'l') setCol((c) => Math.min(m.agents.length - 1, c + 1));
    if (input === 'r') {
      setM(deriveMatrix());
      setMsg('已刷新');
    }
    if ((input === ' ' || key.return) && m.skills[row] && m.agents[col]) {
      const res = toggleCell(m.skills[row], m.agents[col].id);
      setMsg(res.message);
      setM(deriveMatrix());
    }
    if (input === 'a' && m.skills[row]) {
      let ok = 0;
      let fail = 0;
      for (const a of m.agents) {
        const res = toggleCell(m.skills[row], a.id);
        if (res.ok) ok++;
        else fail++;
      }
      setMsg(`${m.skills[row]}：${ok} 个 Agent 成功${fail ? `，${fail} 失败` : ''}`);
      setM(deriveMatrix());
    }
  });

  if (!m.skills.length) {
    return (
      <Box flexDirection="column">
        <Text>中央仓库为空。运行 skillpot adopt 收编各 Agent 已有 skill（--move 为移动模式）。</Text>
        <Text>或用 skillpot add 安装新 skill。</Text>
        <Text dimColor>按 q 退出</Text>
      </Box>
    );
  }

  const nameW = Math.max('Skill'.length, ...m.skills.map((s) => s.length), 5) + 2;
  const colW = m.agents.map((a) => Math.max(a.name.length, 3) + 2);
  const sel = m.skills[row] && m.agents[col];

  return (
    <Box flexDirection="column">
      <Text bold inverse>
        {' SkillPot 开关矩阵 '}
      </Text>
      <Box>
        <Text bold dimColor>
          {'（↑↓←→/hjkl 移动 · 空格 切换 · a 整行开关 · r 刷新 · q 退出）\n'}
        </Text>
      </Box>
      <Box>
        <Text bold backgroundColor={sel && row === -1 ? 'blue' : undefined}>
          {'Skill'.padEnd(nameW)}
        </Text>
        {m.agents.map((a, ci) => (
          <Text key={a.id} bold inverse={ci === col}>
            {a.name.padEnd(colW[ci])}
          </Text>
        ))}
      </Box>
      {m.skills.map((s, ri) => (
        <Box key={s}>
          <Text bold inverse={ri === row}>
            {s.padEnd(nameW)}
          </Text>
          {m.agents.map((a, ci) => {
            const g = cellGlyph(m.cells[s][a.id]);
            const selected = ri === row && ci === col;
            return (
              <Text
                key={a.id}
                inverse={selected}
                color={selected ? undefined : toneColor[g.tone]}
                dimColor={!selected && g.tone === 'muted'}
              >
                {g.ch.padEnd(colW[ci])}
              </Text>
            );
          })}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>{TUI_LEGEND}</Text>
      </Box>
      {msg ? <Text color="yellow">{msg}</Text> : null}
    </Box>
  );
}
