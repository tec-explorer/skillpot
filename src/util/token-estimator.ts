export type TokenCostLevel = 'light' | 'moderate' | 'heavy';

export interface TokenEstimation {
  tokens: number;
  level: TokenCostLevel;
  charCount: number;
}

/**
 * 启发式估算文本 Token 数量（零外部依赖，极速计算）。
 * - CJK 字符（中文/日文/韩文）按平均约 1.3 tokens/字计算；
 * - 英文单词与代码符号按字符数与单词数加权折算（平均约 3.8 字符 / 1 token）；
 * - 兼顾代码块与缩进。
 */
export function estimateTokens(text: string): TokenEstimation {
  if (!text || !text.trim()) {
    return { tokens: 0, level: 'light', charCount: 0 };
  }

  const charCount = text.length;
  // 匹配 CJK 字符
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 移除非 CJK 以外的字符以统计拉丁字母、数字与代码符号
  const nonCjkText = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ');
  const nonCjkWords = nonCjkText.trim().split(/\s+/).filter(Boolean);
  const nonCjkCharCount = nonCjkText.replace(/\s+/g, '').length;

  const nonCjkTokens = Math.max(
    Math.round(nonCjkCharCount / 3.8),
    Math.round(nonCjkWords.length * 1.3),
  );
  const cjkTokens = Math.round(cjkCount * 1.3);

  const tokens = Math.max(1, nonCjkTokens + cjkTokens);

  let level: TokenCostLevel = 'light';
  if (tokens > 2500) {
    level = 'heavy';
  } else if (tokens >= 500) {
    level = 'moderate';
  }

  return {
    tokens,
    level,
    charCount,
  };
}
