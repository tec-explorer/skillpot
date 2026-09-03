import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export interface SkillMeta {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/** 读取 <skillDir>/SKILL.md 的 YAML frontmatter；无则返回 null */
export function readSkillMeta(skillDirPath: string): SkillMeta | null {
  const md = path.join(skillDirPath, 'SKILL.md');
  if (!fs.existsSync(md)) return null;
  const text = fs.readFileSync(md, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const data = parse(m[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as SkillMeta;
}

/** 校验并规范化 skill 名：小写字母数字与 . _ - */
export function sanitizeSkillName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!name) throw new Error(`非法 skill 名：'${raw}'`);
  if (name.length > 64) throw new Error(`skill 名过长：'${raw}'`);
  return name;
}
