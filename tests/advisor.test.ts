import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { skillDir } from '../src/paths';
import { estimateTokens } from '../src/util/token-estimator';
import {
  buildMatrixSuitability,
  evaluateSkillForAgent,
  inspectSkillFeatures,
  isBinaryAvailable,
  resetBinaryCache,
} from '../src/core/advisor';

beforeEach(() => {
  makeSandbox();
  resetBinaryCache();
});

function createStoreSkill(name: string, files: Record<string, string>): string {
  const dir = skillDir(name);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

describe('Token Estimator', () => {
  it('空文本返回 0 token 且评级为 light', () => {
    expect(estimateTokens('').tokens).toBe(0);
    expect(estimateTokens('   ').level).toBe('light');
  });

  it('短文本评级为 light', () => {
    const res = estimateTokens('# Hello World\nThis is a short test skill.');
    expect(res.tokens).toBeGreaterThan(0);
    expect(res.tokens).toBeLessThan(500);
    expect(res.level).toBe('light');
  });

  it('支持中英混合启发式计算', () => {
    const cnText = '这是一段中文指令，用于测试 CJK 字符在 Token 估算器中的加权系数。';
    const res = estimateTokens(cnText);
    expect(res.tokens).toBeGreaterThan(20);
    expect(res.level).toBe('light');
  });

  it('大体量文本正确划分为 heavy', () => {
    const longText = 'long word '.repeat(3000); // 3000 words ~ 3900 tokens
    const res = estimateTokens(longText);
    expect(res.tokens).toBeGreaterThan(2500);
    expect(res.level).toBe('heavy');
  });
});

describe('Advisor Dependency & Feature Inspection', () => {
  it('PATH 探针能准确识别常见命令与不存在的命令', () => {
    // node 或 sh 通常存在于测试运行环境
    expect(isBinaryAvailable('sh') || isBinaryAvailable('node')).toBe(true);
    expect(isBinaryAvailable('definitely_not_a_real_binary_xyz_999')).toBe(false);
  });

  it('能准确检测 scripts/ 目录下的解释器需求', () => {
    createStoreSkill('py-tool', {
      'SKILL.md': '---\nname: py-tool\ndescription: A python tool\n---\n# Python Tool\n',
      'scripts/task.py': 'print("hello")\n',
    });

    const features = inspectSkillFeatures('py-tool');
    expect(features).not.toBeNull();
    expect(features?.requiredInterpreters).toContain('python3');
  });

  it('能准确从正文与 frontmatter 中提取工具依赖', () => {
    createStoreSkill('docker-k8s', {
      'SKILL.md': `---
name: docker-k8s
description: Manage containers and clusters
tools:
  - helm
---
# Docker & K8s
Run docker build and deploy with kubectl.
`,
    });

    const features = inspectSkillFeatures('docker-k8s');
    expect(features).not.toBeNull();
    expect(features?.referencedTools).toContain('helm');
    expect(features?.referencedTools).toContain('docker');
    expect(features?.referencedTools).toContain('kubectl');
  });
});

describe('evaluateSkillForAgent & Matrix Suitability', () => {
  it('依赖齐全且体量小巧时给出 recommended', () => {
    createStoreSkill('clean-tool', {
      'SKILL.md': `---
name: clean-tool
description: Standard git tool
---
# Git Tool
Use git status to check state.
`,
    });

    const target = {
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'agent' as const,
      installed: true,
      verify: 'live' as const,
    };

    const res = evaluateSkillForAgent('clean-tool', target);
    expect(res.level).toBe('recommended');
    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.reasons.pros.length).toBeGreaterThan(0);
    expect(res.summary).toContain('推荐启用');
  });

  it('缺少脚本解释器时评级降为 incompatible', () => {
    createStoreSkill('ruby-tool', {
      'SKILL.md': `---
name: ruby-tool
description: Ruby script skill
---
# Ruby
`,
      'scripts/process.rb': 'puts "ruby"',
    });

    // 假设模拟测试环境没有 ruby（如果系统有 ruby，可以用一个不存在的脚本后缀模式测试）
    const target = {
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'agent' as const,
      installed: true,
    };

    const features = inspectSkillFeatures('ruby-tool')!;
    // 人为注入一个肯定不存在的解释器以验证不兼容分支
    features.requiredInterpreters = ['definitely_fake_interpreter_999'];

    const res = evaluateSkillForAgent('ruby-tool', target, features);
    expect(res.level).toBe('incompatible');
    expect(res.score).toBeLessThan(70);
    expect(res.reasons.risks.some((r) => r.includes('缺少脚本执行所需解释器'))).toBe(true);
    expect(res.summary).toContain('缺少执行脚本所需的解释器');
  });

  it('通用广播渠道对重型技能降级为 caution', () => {
    createStoreSkill('heavy-skill', {
      'SKILL.md': `---
name: heavy-skill
description: Huge reference library
---
# Big Data
` + 'Paragraph with lots of tokens. '.repeat(1500),
    });

    const broadcastTarget = {
      id: 'broadcast',
      name: '通用广播',
      kind: 'channel' as const,
      installed: true,
      verify: 'live' as const,
    };

    const res = evaluateSkillForAgent('heavy-skill', broadcastTarget);
    expect(res.level).toBe('caution');
    expect(res.reasons.risks.some((r) => r.includes('通用广播渠道'))).toBe(true);
    expect(res.summary).toContain('谨慎广播');
  });

  it('buildMatrixSuitability 成功产出全矩阵推导结果', () => {
    createStoreSkill('s1', {
      'SKILL.md': '---\nname: s1\ndescription: skill 1\n---\n# S1\n',
    });
    createStoreSkill('s2', {
      'SKILL.md': '---\nname: s2\ndescription: skill 2\n---\n# S2\n',
    });

    const agents = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        kind: 'agent' as const,
        installed: true,
        skillsDir: '/dummy/claude',
        verify: 'live' as const,
      },
      {
        id: 'broadcast',
        name: '通用广播',
        kind: 'channel' as const,
        installed: true,
        skillsDir: '/dummy/agents',
        verify: 'live' as const,
      },
    ];

    const matrix = buildMatrixSuitability(['s1', 's2'], agents);
    expect(matrix['s1']).toBeDefined();
    expect(matrix['s1']['claude-code']).toBeDefined();
    expect(matrix['s1']['broadcast']).toBeDefined();
    expect(matrix['s2']['claude-code'].score).toBeGreaterThan(0);
  });
});
