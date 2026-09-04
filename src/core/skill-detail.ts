import fs from 'node:fs';
import path from 'node:path';
import { skillDir } from '../paths';
import { readSkillMeta, SkillMeta } from '../util/frontmatter';

export interface SkillDetail {
  name: string;
  meta: SkillMeta | null;
  /** 相对路径排序的文件树（目录带 / 后缀） */
  files: string[];
  skillMd: string | null;
}

/**
 * 读取 skill 详情：SKILL.md 全文 + 文件树 + frontmatter。
 * MCP 的 skillpot_read 与 GUI 详情视图共用；skill 不存在（无 SKILL.md）返回 null。
 */
export function readSkillDetail(name: string): SkillDetail | null {
  const dir = skillDir(name);
  const mdPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return null;

  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        files.push(path.relative(dir, p) + '/');
        walk(p);
      } else {
        files.push(path.relative(dir, p));
      }
    }
  };
  walk(dir);

  return {
    name,
    meta: readSkillMeta(dir),
    files: files.sort(),
    skillMd: fs.readFileSync(mdPath, 'utf8'),
  };
}
