import fs from 'node:fs';
import path from 'node:path';
import { skillDir } from '../paths';
import { readSkillDetail } from './skill-detail';
import { estimateTokens, TokenEstimation } from '../util/token-estimator';
import { SuitabilityAnalysis, SuitabilityLevel, TargetKind, VerifyLevel } from '../types';
import { MatrixAgent } from '../tui/matrix';

/** PATH 命令缓存 */
const binaryCheckCache = new Map<string, boolean>();

/** 重置 PATH 探针缓存（用于测试） */
export function resetBinaryCache(): void {
  binaryCheckCache.clear();
}

/**
 * 跨平台安全检查某个可执行二进制是否在当前系统 PATH 中（零子进程 spawn，性能高且安全）。
 */
export function isBinaryAvailable(bin: string): boolean {
  if (!bin || typeof bin !== 'string') return false;
  const normalized = bin.trim().toLowerCase();
  if (binaryCheckCache.has(normalized)) {
    return binaryCheckCache.get(normalized)!;
  }

  const envPath = process.env.PATH || '';
  const dirs = envPath.split(path.delimiter);
  const isWin = process.platform === 'win32';
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];

  for (const d of dirs) {
    if (!d) continue;
    for (const ext of exts) {
      try {
        const full = path.join(d, normalized + ext);
        if (fs.existsSync(full)) {
          const st = fs.statSync(full);
          if (st.isFile()) {
            binaryCheckCache.set(normalized, true);
            return true;
          }
        }
      } catch {
        // ignore permission or path errors
      }
    }
  }

  binaryCheckCache.set(normalized, false);
  return false;
}

/** 常见外部 CLI 候选池，用于依赖扫描 */
const COMMON_EXTERNAL_CLIS = [
  'docker',
  'docker-compose',
  'kubectl',
  'helm',
  'git',
  'gh',
  'aws',
  'gcloud',
  'terraform',
  'ffmpeg',
  'cargo',
  'npm',
  'pnpm',
  'yarn',
  'go',
  'make',
  'jq',
];

export interface SkillInspection {
  name: string;
  tokenEst: TokenEstimation;
  totalBytes: number;
  filesCount: number;
  hasScripts: boolean;
  requiredInterpreters: string[];
  referencedTools: string[];
  specificAgentsOnly?: string[];
}

/**
 * 静态检查 Skill 的物理特征（Token 体量、解释器需求、引用的工具库）。
 */
export function inspectSkillFeatures(name: string): SkillInspection | null {
  const detail = readSkillDetail(name);
  if (!detail || !detail.skillMd) return null;

  const dir = skillDir(name);
  const tokenEst = estimateTokens(detail.skillMd);
  const files = detail.files || [];

  let totalBytes = Buffer.byteLength(detail.skillMd, 'utf8');
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (st.isFile()) {
        totalBytes += st.size;
      }
    } catch {
      // ignore
    }
  }

  // 1. 扫描 scripts/ 下的文件后缀，推导需要的解释器
  const requiredInterpreters = new Set<string>();
  for (const f of files) {
    if (f.startsWith('scripts/')) {
      if (f.endsWith('.py')) {
        requiredInterpreters.add('python3');
      } else if (f.endsWith('.sh') || f.endsWith('.bash')) {
        requiredInterpreters.add('bash');
      } else if (f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs')) {
        requiredInterpreters.add('node');
      } else if (f.endsWith('.rb')) {
        requiredInterpreters.add('ruby');
      }
    }
  }

  // 2. 扫描 SKILL.md 正文与 frontmatter 中的工具声明
  const referencedTools = new Set<string>();
  const mdLower = detail.skillMd.toLowerCase();

  // 从 frontmatter 中提取 tools/dependencies
  if (detail.meta && typeof detail.meta === 'object') {
    const deps = (detail.meta as Record<string, unknown>).dependencies;
    const tools = (detail.meta as Record<string, unknown>).tools;
    const bins = (detail.meta as Record<string, unknown>).bins;
    const list = [
      ...(Array.isArray(deps) ? deps : []),
      ...(Array.isArray(tools) ? tools : []),
      ...(Array.isArray(bins) ? bins : []),
    ];
    for (const item of list) {
      if (typeof item === 'string' && item.trim()) {
        referencedTools.add(item.trim().toLowerCase());
      }
    }
  }

  // 从正文中扫描高频外部 CLI（限制为独立词，且排除普通英文单词如 go/make 等若无明确命令上下文）
  for (const cli of COMMON_EXTERNAL_CLIS) {
    if (cli === 'go' || cli === 'make') {
      // 特别注意 go / make 容易在英语中误伤，只匹配带反引号或命令前缀的 `go ` 或 `make `
      if (new RegExp('(`|\\$ |run )' + cli + '\\b').test(mdLower)) {
        referencedTools.add(cli);
      }
    } else {
      const regex = new RegExp('\\b' + cli + '\\b');
      if (regex.test(mdLower)) {
        referencedTools.add(cli);
      }
    }
  }

  // 3. 检查是否专属于某些 Agent
  const specificAgentsOnly: string[] = [];
  if (/\b(claude code only|for claude code|only for claude)\b/i.test(mdLower)) {
    specificAgentsOnly.push('claude-code');
  }
  if (/\b(cursor rules only|only for cursor)\b/i.test(mdLower)) {
    specificAgentsOnly.push('cursor');
  }
  if (/\b(gemini cli only|antigravity only)\b/i.test(mdLower)) {
    specificAgentsOnly.push('gemini-cli');
  }

  return {
    name,
    tokenEst,
    totalBytes,
    filesCount: files.length,
    hasScripts: requiredInterpreters.size > 0,
    requiredInterpreters: Array.from(requiredInterpreters),
    referencedTools: Array.from(referencedTools),
    specificAgentsOnly: specificAgentsOnly.length > 0 ? specificAgentsOnly : undefined,
  };
}

export interface AdvisorTarget {
  id: string;
  name: string;
  kind?: TargetKind;
  installed?: boolean;
  verify?: VerifyLevel;
}

/**
 * 核心评估算法：评估单个 Skill 与目标 Agent 的契合度
 */
export function evaluateSkillForAgent(
  skillName: string,
  target: AdvisorTarget,
  cachedInspection?: SkillInspection,
): SuitabilityAnalysis {
  const inspection = cachedInspection ?? inspectSkillFeatures(skillName);

  // 若 Skill 不存在或读取失败
  if (!inspection) {
    return {
      level: 'incompatible',
      score: 0,
      summary: 'Skill 无法读取或 SKILL.md 缺失',
      tokenCost: { tokens: 0, level: 'light' },
      dependencies: { satisfied: [], missing: [] },
      reasons: { pros: [], risks: ['Skill 目录损坏或缺失 SKILL.md 文件'] },
    };
  }

  let score = 100;
  const pros: string[] = [];
  const risks: string[] = [];

  const satisfied: string[] = [];
  const missing: string[] = [];

  // 1. 检查解释器环境依赖（强要求）
  let interpreterMissing = false;
  for (const interp of inspection.requiredInterpreters) {
    if (isBinaryAvailable(interp)) {
      satisfied.push(interp);
    } else {
      missing.push(interp);
      interpreterMissing = true;
    }
  }

  // 2. 检查引用的外部工具（次级要求）
  for (const tool of inspection.referencedTools) {
    // 已经包含在解释器中的跳过
    if (inspection.requiredInterpreters.includes(tool)) continue;
    if (isBinaryAvailable(tool)) {
      satisfied.push(tool);
    } else {
      missing.push(tool);
    }
  }

  // 扣分与优势记录：依赖方面
  if (interpreterMissing) {
    score -= 40;
    risks.push(`缺少脚本执行所需解释器: ${missing.filter((m) => inspection.requiredInterpreters.includes(m)).join(', ')}`);
  }
  const missingOtherTools = missing.filter((m) => !inspection.requiredInterpreters.includes(m));
  if (missingOtherTools.length > 0) {
    score -= Math.min(30, missingOtherTools.length * 15);
    risks.push(`系统缺少引用的外部工具: ${missingOtherTools.join(', ')}`);
  }
  if (satisfied.length > 0 && missing.length === 0) {
    pros.push(`所需运行环境与工具已齐全 (${satisfied.slice(0, 3).join(', ')}${satisfied.length > 3 ? ' 等' : ''})`);
  }

  // 3. Token 上下文开销评估
  const tokenTokens = inspection.tokenEst.tokens;
  const tokenLevel = inspection.tokenEst.level;
  if (tokenLevel === 'light') {
    pros.push(`体量小巧 (~${tokenTokens} tokens)，上下文零负担`);
  } else if (tokenLevel === 'moderate') {
    pros.push(`体量适中 (~${tokenTokens} tokens)`);
  } else {
    score -= 18;
    risks.push(`体量较大 (~${tokenTokens} tokens)，可能占用较多上下文窗口`);
  }

  // 4. 渠道特定规则：通用广播渠道 (broadcast)
  const isChannel = target.kind === 'channel' || target.id === 'broadcast';
  if (isChannel) {
    if (tokenLevel === 'heavy') {
      score -= 25;
      risks.push('通用广播渠道会将此较重 Skill 暴露给所有 Agent，导致全局上下文膨胀');
    }
    if (inspection.specificAgentsOnly && inspection.specificAgentsOnly.length > 0) {
      score -= 30;
      risks.push(`此 Skill 声明了专有偏好 (${inspection.specificAgentsOnly.join(', ')})，不建议放入通用广播渠道`);
    }
    if (missing.length > 0) {
      score -= 15;
      risks.push('广播渠道中包含依赖缺失的 Skill 可能导致部分 Agent 触发失败');
    }
    if (tokenLevel === 'light' && missing.length === 0 && !inspection.specificAgentsOnly) {
      pros.push('适合作为跨 Agent 全局通用广播技能');
    }
  } else {
    // 单 Agent 规则
    if (target.installed === false) {
      score -= 20;
      risks.push(`本机未检测到 ${target.name} 运行环境`);
    }
    if (target.verify === 'unverified') {
      score -= 10;
      risks.push(`目标 Agent (${target.name}) 的 Skill 发现机制处于未实测验证状态`);
    }
    if (inspection.specificAgentsOnly) {
      if (inspection.specificAgentsOnly.includes(target.id)) {
        score += 10;
        pros.push(`专为 ${target.name} 设计，高度适配`);
      } else {
        score -= 20;
        risks.push(`该 Skill 专为 ${inspection.specificAgentsOnly.join(', ')} 设计`);
      }
    }
  }

  // 归一化得分 [0, 100]
  score = Math.max(0, Math.min(100, score));

  // 判定建议级别
  let level: SuitabilityLevel;
  if (interpreterMissing || score < 30) {
    level = 'incompatible';
  } else if (isChannel && tokenLevel === 'heavy') {
    level = 'caution';
  } else if (score >= 80) {
    level = 'recommended';
  } else if (score >= 55) {
    level = 'neutral';
  } else {
    level = 'caution';
  }

  // 生成一句话诊断结论
  let summary = '';
  if (level === 'recommended') {
    summary = '推荐启用：环境依赖已满足，上下文开销轻量';
  } else if (level === 'neutral') {
    summary = '按需启用：体量适中，可按具体任务场景开启';
  } else if (level === 'caution') {
    if (isChannel && tokenLevel === 'heavy') {
      summary = '谨慎广播：体积较大，全域广播将增加所有 Agent 的上下文负担';
    } else if (tokenLevel === 'heavy') {
      summary = '谨慎开启：文件体量较大，请留意上下文窗口占用';
    } else if (target.installed === false) {
      summary = `谨慎开启：本机未检测到 ${target.name} 安装`;
    } else {
      summary = '谨慎开启：存在部分未就绪的依赖或轻微不兼容';
    }
  } else {
    if (interpreterMissing) {
      summary = `不推荐：缺少执行脚本所需的解释器 (${missing.filter((m) => inspection.requiredInterpreters.includes(m)).join(', ')})`;
    } else {
      summary = '不推荐：环境依赖缺失或存在明确不兼容';
    }
  }

  return {
    level,
    score,
    summary,
    tokenCost: {
      tokens: tokenTokens,
      level: tokenLevel,
    },
    dependencies: {
      satisfied,
      missing,
    },
    reasons: {
      pros,
      risks,
    },
  };
}

/**
 * 构建整个 Matrix 矩阵的适配度分析映射 (skills × agents)
 */
export function buildMatrixSuitability(
  skills: string[],
  agents: MatrixAgent[],
): Record<string, Record<string, SuitabilityAnalysis>> {
  const result: Record<string, Record<string, SuitabilityAnalysis>> = {};

  for (const s of skills) {
    const inspection = inspectSkillFeatures(s);
    result[s] = {};
    for (const a of agents) {
      if (!inspection) {
        result[s][a.id] = {
          level: 'incompatible',
          score: 0,
          summary: 'Skill 无法读取',
          tokenCost: { tokens: 0, level: 'light' },
          dependencies: { satisfied: [], missing: [] },
          reasons: { pros: [], risks: ['Skill 无法读取'] },
        };
      } else {
        result[s][a.id] = evaluateSkillForAgent(s, a, inspection);
      }
    }
  }

  return result;
}
