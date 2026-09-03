import React from 'react';
import { render } from 'ink';
import { deriveMatrix } from './matrix';
import { renderStatic } from './cells';
import { App } from './App';

/**
 * TUI 入口：TTY 下进入交互矩阵；无 TTY 或 --once 时降级为静态输出（管道/CI 可用）。
 */
export function runTui(opts: { once?: boolean } = {}): void {
  const matrix = deriveMatrix();
  if (opts.once || !process.stdout.isTTY) {
    console.log(renderStatic(matrix));
    return;
  }
  render(React.createElement(App, { initial: matrix }));
}
