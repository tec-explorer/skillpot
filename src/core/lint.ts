import fs from 'node:fs';
import path from 'node:path';
import { readSkillMeta } from '../util/frontmatter';

export interface LintIssue {
  level: 'error' | 'warn';
  message: string;
}

/** 脚本静态扫描的高危模式（命中即 warn，不阻断） */
const DANGEROUS_PATTERNS: [RegExp, string][] = [
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

/** 单个 skill 目录的安全与质量检查 */
export function lintSkill(dir: string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
    return [{ level: 'error', message: '缺少 SKILL.md' }];
  }
  const meta = readSkillMeta(dir);
  if (!meta) {
    issues.push({ level: 'error', message: 'SKILL.md frontmatter 无法解析' });
  } else {
    if (!meta.name) {
      issues.push({ level: 'warn', message: 'frontmatter 缺少 name（安装时将回退为目录名）' });
    }
    const desc = typeof meta.description === 'string' ? meta.description : '';
    if (!desc) {
      issues.push({
        level: 'error',
        message: 'frontmatter 缺少 description——Agent 依赖它判断何时触发',
      });
    } else if (desc.length < 20) {
      issues.push({ level: 'warn', message: 'description 过短（<20 字符），跨 Agent 触发可能不稳定' });
    } else if (desc.length > 1024) {
      issues.push({ level: 'warn', message: 'description 过长（>1024 字符）' });
    }
  }

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
    for (const [re, label] of DANGEROUS_PATTERNS) {
      if (re.test(text)) {
        issues.push({ level: 'warn', message: `${path.relative(dir, s)} 疑似高危操作：${label}` });
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
