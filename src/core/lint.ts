import fs from 'node:fs';
import path from 'node:path';
import { readSkillMeta } from '../util/frontmatter';

export interface LintIssue {
  level: 'error' | 'warn';
  message: string;
  rule?: string;
  file?: string;
}

/** 脚本静态扫描的高危模式（命中即 warn，提示风险） */
const SCRIPT_DANGEROUS_PATTERNS: [RegExp, string][] = [
  [/\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rf]/, 'rm 递归/强制删除'],
  [/\bcurl\s+[^\n|]*\|\s*(?:ba|z)?sh\b/, 'curl 管道执行脚本'],
  [/\bwget\s+[^\n|]*\|\s*(?:ba|z)?sh\b/, 'wget 管道执行脚本'],
  [/\bsudo\b/, 'sudo 提权'],
  [/\bchmod\s+777\b/, 'chmod 777 开放写权限'],
  // —— 凭据与敏感信息（§9.1：读取 env / credentials）——
  [/\.ssh[/']|\.aws[/']|\.kube[/']|\.netrc\b/, '触碰 SSH/云厂商凭据文件'],
  [
    /\b(?:API[_-]?KEY|APIKEY|SECRET[_-]?KEY|ACCESS[_-]?TOKEN|PRIVATE[_-]?KEY|AWS_SECRET[_-]?ACCESS[_-]?KEY)\b/i,
    '引用密钥类标识符',
  ],
  [/\bprintenv\b/, 'printenv 导出环境变量'],
  [
    /process\.env\.[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\w*/i,
    '读取 Node 密钥类环境变量',
  ],
  // —— 外发数据（§9.1：外发网络请求）——
  [
    /\bcurl\b[^\n]*(?:-X\s*(?:POST|PUT)\b|--data(?:-binary|-raw|-urlencode)?\b|--form\b|--upload-file\b|\s-T\s)/,
    'curl 向外发送数据（POST/PUT/上传）',
  ],
  [/\bwget\b[^\n]*--(?:post-data|post-file)\b/, 'wget 向外发送数据'],
  [/\bnc\b[^\n]*\s-e\b/, 'nc -e 远程执行/反弹 shell'],
  [/\b(?:scp|rsync)\b[^\n]*\b\w+@(?!localhost|127\.0\.0\.1)/, '向远端主机拷贝文件'],
  // —— 反取证 ——
  [/\.(?:bash|zsh)_history/, '触碰 shell 历史文件'],
];

const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl)$/;

/** 提示词注入模式（SKILL.md 正文中诱导越狱、覆盖系统指令） -> 致命阻断 (error) */
const PROMPT_INJECTION_PATTERNS: [RegExp, string][] = [
  [
    /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|rules|directives|prompts)\b/i,
    '提示词注入：试图忽略前序指令',
  ],
  [
    /\bdisregard\s+(?:all\s+)?(?:previous|prior|above|safety|system)\s+(?:instructions|rules|directives|filters|guidelines)\b/i,
    '提示词注入：试图无视安全/前序规则',
  ],
  [
    /\byou\s+are\s+now\s+in\s+(?:unrestricted|developer|jailbreak|god|dan)\s+mode\b/i,
    '提示词注入：诱导越狱/开发者模式',
  ],
  [
    /\b(?:system\s+prompt\s+override|override\s+system\s+prompt)\b/i,
    '提示词注入：试图覆写系统提示词',
  ],
  [
    /\bdo\s+not\s+follow\s+any\s+(?:previous|prior|system)\s+(?:instructions|rules)\b/i,
    '提示词注入：拒绝遵从预设规则',
  ],
];

/** 隐藏 HTML 注释中嵌入的危险指令/注入模式 */
const HIDDEN_COMMENT_SUSPICIOUS = [
  /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)|system\s+prompt|jailbreak|override\s+system)\b/i,
  /\b(?:curl|wget)\s+[^\n|]*\|\s*(?:ba|z)?sh\b/i,
  /\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rf]/,
  /\b(?:sudo|chmod\s+777)\b/,
  /\b(?:eval|base64\s+-d)\b/i,
];

/** 运行时远程拉取并执行指令（SKILL.md 正文诱导） */
const REMOTE_EXEC_INSTRUCTIONS: [RegExp, string][] = [
  [/\b(?:curl|wget)\s+[^\n|]*\|\s*source\b/i, '正文诱导远程拉取并 source 执行'],
  [/\bsource\s+<\s*\(\s*(?:curl|wget)\b/i, '正文诱导进程替换远程执行'],
  [/\beval\s+["']?\$\(\s*(?:curl|wget)\b/i, '正文诱导 eval 动态远程拉取执行'],
  [/\b(?:curl|wget)\s+[^\n|]*\|\s*(?:ba|z)?sh\b/i, '正文诱导远程管道执行脚本'],
];

/** 提取 SKILL.md 正文（剥离 YAML frontmatter 与首部 UTF-8 BOM） */
function extractSkillBody(raw: string): string {
  let content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1] : content;
}

/** 单个 skill 目录的安全与质量检查 */
export function lintSkill(dir: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const skillMdPath = path.join(dir, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    return [{ level: 'error', message: '缺少 SKILL.md', rule: 'meta/missing-skill-md' }];
  }

  let rawSkillMd = '';
  try {
    rawSkillMd = fs.readFileSync(skillMdPath, 'utf8');
  } catch (e) {
    return [
      {
        level: 'error',
        message: `无法读取 SKILL.md：${e instanceof Error ? e.message : String(e)}`,
        rule: 'meta/unreadable-skill-md',
      },
    ];
  }

  // 1. Frontmatter 检查
  const meta = readSkillMeta(dir);
  if (!meta) {
    issues.push({
      level: 'error',
      message: 'SKILL.md frontmatter 无法解析',
      rule: 'meta/invalid-frontmatter',
      file: 'SKILL.md',
    });
  } else {
    if (!meta.name) {
      issues.push({
        level: 'warn',
        message: 'frontmatter 缺少 name（安装时将回退为目录名）',
        rule: 'meta/missing-name',
        file: 'SKILL.md',
      });
    }
    const desc = typeof meta.description === 'string' ? meta.description : '';
    if (!desc) {
      issues.push({
        level: 'error',
        message: 'frontmatter 缺少 description——Agent 依赖它判断何时触发',
        rule: 'meta/missing-description',
        file: 'SKILL.md',
      });
    } else if (desc.length < 20) {
      issues.push({
        level: 'warn',
        message: 'description 过短（<20 字符），跨 Agent 触发可能不稳定',
        rule: 'meta/short-description',
        file: 'SKILL.md',
      });
    } else if (desc.length > 1024) {
      issues.push({
        level: 'warn',
        message: 'description 过长（>1024 字符）',
        rule: 'meta/long-description',
        file: 'SKILL.md',
      });
    }
  }

  // 2. SKILL.md 正文扫描（Phase 2: 提示词注入、隐藏 HTML 注释、Unicode 零宽混淆、Base64 载荷、运行时远程拉取）
  const body = extractSkillBody(rawSkillMd);

  // 2.1 提示词注入检查
  for (const [re, label] of PROMPT_INJECTION_PATTERNS) {
    if (re.test(body)) {
      issues.push({
        level: 'error',
        message: `SKILL.md 检出提示词注入风险：${label}`,
        rule: 'security/prompt-injection',
        file: 'SKILL.md',
      });
    }
  }

  // 2.2 隐藏 HTML 注释检查
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let commentMatch: RegExpExecArray | null = null;
  while ((commentMatch = commentRegex.exec(body)) !== null) {
    const commentContent = commentMatch[1];
    for (const pat of HIDDEN_COMMENT_SUSPICIOUS) {
      if (pat.test(commentContent)) {
        issues.push({
          level: 'error',
          message: 'SKILL.md 隐藏 HTML 注释中检出注入指令或高危代码载荷',
          rule: 'security/hidden-html-comment',
          file: 'SKILL.md',
        });
        break;
      }
    }
  }

  // 2.3 Unicode 零宽字符混淆与双向控制符（隐蔽攻击载荷）
  // 排除可能出现的正常首字符 BOM（已在 extractSkillBody 中处理）
  if (/[\u200B\u200C\u200D\uFEFF]/.test(body)) {
    issues.push({
      level: 'error',
      message: 'SKILL.md 检出零宽不可见字符混淆（Zero-Width Characters 隐蔽载荷）',
      rule: 'security/unicode-zero-width',
      file: 'SKILL.md',
    });
  }
  if (/[\u202A-\u202E\u2066-\u2069]/.test(body)) {
    issues.push({
      level: 'error',
      message: 'SKILL.md 检出双向文本欺骗字符（BiDi Override 欺骗载荷）',
      rule: 'security/unicode-bidi-override',
      file: 'SKILL.md',
    });
  }

  // 2.4 正文中诱导运行时远程拉取执行
  for (const [re, label] of REMOTE_EXEC_INSTRUCTIONS) {
    if (re.test(body)) {
      issues.push({
        level: 'error',
        message: `SKILL.md ${label}`,
        rule: 'security/remote-fetch-exec',
        file: 'SKILL.md',
      });
    }
  }

  // 2.5 Base64 隐蔽解码并执行
  const base64ExecRegex =
    /(?:echo\s+['"]?[A-Za-z0-9+/=]+['"]?\s*\|\s*base64\s+-(?:d|-decode|D)\b)\s*\|\s*(?:ba|z)?sh/i;
  const evalBase64Regex = /\beval\s*\(\s*(?:Buffer\.from\([^)]*base64|atob\()/i;
  if (base64ExecRegex.test(body) || evalBase64Regex.test(body)) {

    issues.push({
      level: 'error',
      message: 'SKILL.md 检出 Base64 隐蔽解码并执行载荷',
      rule: 'security/base64-exec',
      file: 'SKILL.md',
    });
  }

  // 3. 依赖声明生命周期钩子（package.json postinstall 等价物）
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      for (const hook of ['preinstall', 'install', 'postinstall', 'preuninstall', 'postuninstall']) {
        const cmd = scripts[hook];
        if (typeof cmd === 'string' && cmd.trim()) {
          if (/\b(?:curl|wget|bash|sh|rm\s+-rf|eval|base64|python|node\s+-e)\b/i.test(cmd)) {
            issues.push({
              level: 'error',
              message: `package.json 包含高危 ${hook} 自动执行钩子：${cmd}`,
              rule: 'security/package-lifecycle-hook',
              file: 'package.json',
            });
          } else {
            issues.push({
              level: 'warn',
              message: `package.json 包含 ${hook} 安装钩子（${cmd}），请确认安全性`,
              rule: 'security/package-lifecycle-hook',
              file: 'package.json',
            });
          }
        }
      }
    } catch {
      issues.push({
        level: 'warn',
        message: 'package.json 解析失败',
        rule: 'security/invalid-package-json',
        file: 'package.json',
      });
    }
  }

  // 4. 脚本静态扫描
  const scripts: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && SCRIPT_EXT.test(e.name)) scripts.push(p);
    }
  };
  walk(dir);

  for (const s of scripts) {
    let text = '';
    try {
      text = fs.readFileSync(s, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(dir, s);

    // 脚本中隐蔽混淆与 Base64 解码执行同样属于致命 error
    if (/[\u200B\u200C\u200D\uFEFF]/.test(text)) {
      issues.push({
        level: 'error',
        message: `${rel} 检出零宽字符混淆`,
        rule: 'security/unicode-zero-width',
        file: rel,
      });
    }
    if (base64ExecRegex.test(text) || evalBase64Regex.test(text)) {
      issues.push({
        level: 'error',
        message: `${rel} 检出 Base64 解码并执行代码`,
        rule: 'security/base64-exec',
        file: rel,
      });
    }

    // 脚本中常见的高危模式
    for (const [re, label] of SCRIPT_DANGEROUS_PATTERNS) {
      if (re.test(text)) {
        issues.push({
          level: 'warn',
          message: `${rel} 疑似高危操作：${label}`,
          file: rel,
        });
      }
    }
  }

  return issues;
}

export function lintSummary(issues: LintIssue[]): string {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  if (errors) return `${errors} error / ${warns} warn`;
  if (warns) return `${warns} warn`;
  return 'clean';
}

