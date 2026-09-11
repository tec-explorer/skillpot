import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { parseGitSource, addSkill } from '../src/core/add';
import { loadConfig } from '../src/core/config';
import { skillDir } from '../src/paths';

beforeEach(() => {
  makeSandbox();
});

describe('Git 来源版本解析与 Tag/Ref 锁定 (Git Ref Pinning)', () => {
  describe('parseGitSource 解析规则', () => {
    it('解析普通 HTTPS Git URL（无 ref）', () => {
      const r = parseGitSource('https://github.com/tec-explorer/skills.git');
      expect(r.url).toBe('https://github.com/tec-explorer/skills.git');
      expect(r.ref).toBeUndefined();
      expect(r.subdir).toBeUndefined();
    });

    it('解析带 @ref 的 HTTPS Git URL', () => {
      const r = parseGitSource('https://github.com/tec-explorer/skills.git@v1.2.0');
      expect(r.url).toBe('https://github.com/tec-explorer/skills.git');
      expect(r.ref).toBe('v1.2.0');
      expect(r.subdir).toBeUndefined();
    });

    it('解析带 @ref 与 #subdir 的完整 URL (url@ref#subdir)', () => {
      const r = parseGitSource('https://github.com/tec-explorer/skills.git@v1.2.0#skills/docker');
      expect(r.url).toBe('https://github.com/tec-explorer/skills.git');
      expect(r.ref).toBe('v1.2.0');
      expect(r.subdir).toBe('skills/docker');
    });

    it('解析 #subdir@ref 形式的 URL', () => {
      const r = parseGitSource('https://github.com/tec-explorer/skills#skills/docker@v2.0.0');
      expect(r.url).toBe('https://github.com/tec-explorer/skills');
      expect(r.ref).toBe('v2.0.0');
      expect(r.subdir).toBe('skills/docker');
    });

    it('解析 SSH git@ URL 并在有 @ref 时准确提取', () => {
      const r = parseGitSource('git@github.com:tec-explorer/skills.git@v3.1.0#my-skill');
      expect(r.url).toBe('git@github.com:tec-explorer/skills.git');
      expect(r.ref).toBe('v3.1.0');
      expect(r.subdir).toBe('my-skill');
    });

    it('优先采用显式指定的 explicitRef 参数', () => {
      const r = parseGitSource('https://github.com/tec-explorer/skills.git#my-skill', 'v4.0.0');
      expect(r.url).toBe('https://github.com/tec-explorer/skills.git');
      expect(r.ref).toBe('v4.0.0');
      expect(r.subdir).toBe('my-skill');
    });
  });

  describe('addSkill 本地 Git 仓库 Tag 锁定测试', () => {
    it('精确克隆并安装指定 Tag 的版本', async () => {
      // 在沙箱中初始化一个真实的 git 仓库
      const repoDir = path.join(makeSandbox(), 'remote-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execSync('git init -b main', { cwd: repoDir });
      execSync('git config user.name "Tester"', { cwd: repoDir });
      execSync('git config user.email "tester@test.com"', { cwd: repoDir });

      // 提交 v1.0.0
      const skill1 = `---
name: ref-skill
description: This is version 1.0.0 of the skill which is reasonably long.
---
# Version 1.0.0
`;
      fs.writeFileSync(path.join(repoDir, 'SKILL.md'), skill1);
      execSync('git add . && git commit -m "release v1.0.0"', { cwd: repoDir });
      execSync('git tag v1.0.0', { cwd: repoDir });

      // 提交 v2.0.0
      const skill2 = `---
name: ref-skill
description: This is version 2.0.0 of the skill which has updated description.
---
# Version 2.0.0
`;
      fs.writeFileSync(path.join(repoDir, 'SKILL.md'), skill2);
      execSync('git add . && git commit -m "release v2.0.0"', { cwd: repoDir });
      execSync('git tag v2.0.0', { cwd: repoDir });

      // 1. 安装锁定 v1.0.0
      const gitUrlV1 = `file://${repoDir}@v1.0.0`;
      const res1 = await addSkill(gitUrlV1);
      expect(res1.name).toBe('ref-skill');
      expect(res1.description).toContain('version 1.0.0');

      const installedMd1 = fs.readFileSync(path.join(skillDir('ref-skill'), 'SKILL.md'), 'utf8');
      expect(installedMd1).toContain('Version 1.0.0');

      const config1 = loadConfig();
      expect(config1.skills['ref-skill'].source).toBe(`git:file://${repoDir}@v1.0.0`);

      // 2. 卸载后通过 --ref 参数安装 v2.0.0
      const { uninstallSkill } = await import('../src/core/uninstall');
      uninstallSkill('ref-skill');

      const res2 = await addSkill(`file://${repoDir}`, { ref: 'v2.0.0' });
      expect(res2.description).toContain('version 2.0.0');

      const installedMd2 = fs.readFileSync(path.join(skillDir('ref-skill'), 'SKILL.md'), 'utf8');
      expect(installedMd2).toContain('Version 2.0.0');

      const config2 = loadConfig();
      expect(config2.skills['ref-skill'].source).toBe(`git:file://${repoDir}@v2.0.0`);
    });
  });
});
