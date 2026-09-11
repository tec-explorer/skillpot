import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox } from './util';
import { initStore, loadConfig, saveConfig } from '../src/core/config';
import { installFromLocal, dirChecksum } from '../src/core/store';
import {
  exportManifest,
  inspectManifest,
  loadManifest,
  syncManifest,
} from '../src/core/team-sync';
import { skillDir } from '../src/paths';

describe('团队 Manifest 本地技能内联打包与跨机器对齐 (Team Manifest Bundle)', () => {
  let sandboxRoot = '';
  let localSkillPath = '';

  beforeEach(() => {
    sandboxRoot = makeSandbox();
    initStore();

    // 建立一个含子目录脚本与二进制资源的本地技能目录
    localSkillPath = path.join(sandboxRoot, 'my-local-skill');
    fs.mkdirSync(path.join(localSkillPath, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(localSkillPath, 'assets'), { recursive: true });

    fs.writeFileSync(
      path.join(localSkillPath, 'SKILL.md'),
      '---\nname: my-bundled-skill\ndescription: A bundled team skill fixture.\n---\n# Bundled Skill\nDo something useful.',
      'utf8',
    );
    fs.writeFileSync(
      path.join(localSkillPath, 'scripts', 'deploy.sh'),
      '#!/bin/bash\necho "deploying via script"',
      'utf8',
    );
    // 写入一个二进制文件（含 0 字节）
    fs.writeFileSync(
      path.join(localSkillPath, 'assets', 'icon.bin'),
      Buffer.from([0x00, 0xff, 0x01, 0xfe, 0x02, 0xfd]),
    );

    // 安装进中央仓库
    installFromLocal(localSkillPath);
    const config = loadConfig();
    config.skills['my-bundled-skill'] = {
      source: `local:${localSkillPath}`,
      checksum: dirChecksum(skillDir('my-bundled-skill')),
      installed_at: new Date().toISOString(),
      expose: { 'claude-code': true },
    };
    saveConfig(config);
  });

  it('exportManifest 开启 bundleLocal 时，将本地文件树打包内联进清单并消除不可跨机器警告', () => {
    const manifestFile = path.join(sandboxRoot, 'skillpot.yaml');
    const { manifest, warnings } = exportManifest(manifestFile, undefined, { bundleLocal: true });

    expect(manifest.skills['my-bundled-skill']).toBeDefined();
    const entry = manifest.skills['my-bundled-skill'];
    expect(entry.source).toBe('local:bundled');
    expect(entry.bundle).toBeDefined();
    expect(entry.bundle!.files).toBeDefined();

    const files = entry.bundle!.files;
    expect(files['SKILL.md']).toContain('# Bundled Skill');
    expect(files['scripts/deploy.sh']).toContain('deploying via script');
    expect(files['assets/icon.bin']).toContain('data:application/octet-stream;base64,');

    // 警告已转换为打包成功的通知信息
    expect(warnings.some((w) => w.includes('通过 --bundle-local 打包内联'))).toBe(true);
    expect(warnings.some((w) => w.includes('无法从本机路径对齐'))).toBe(false);

    // 落盘文件再次被 loadManifest 正确读回
    const loaded = loadManifest(manifestFile);
    expect(loaded.skills['my-bundled-skill'].bundle?.files['SKILL.md']).toContain('# Bundled Skill');
  });

  it('全新机器环境中（无原始本地路径），syncManifest 仅凭清单内的 bundle 即可完整还原并启用技能', async () => {
    // 1. 导出带 bundle 的清单
    const manifestFile = path.join(sandboxRoot, 'skillpot.yaml');
    exportManifest(manifestFile, undefined, { bundleLocal: true });

    // 2. 模拟新机器环境：删除原始本地目录与中央仓库中的技能
    fs.rmSync(localSkillPath, { recursive: true, force: true });
    fs.rmSync(skillDir('my-bundled-skill'), { recursive: true, force: true });
    const config = loadConfig();
    delete config.skills['my-bundled-skill'];
    saveConfig(config);

    // 验证当前确实未安装
    expect(fs.existsSync(skillDir('my-bundled-skill'))).toBe(false);
    expect(loadConfig().skills['my-bundled-skill']).toBeUndefined();

    // 3. 执行对齐
    const items = await syncManifest(manifestFile);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      skill: 'my-bundled-skill',
      action: 'install',
      detail: expect.stringContaining('内嵌 bundle'),
    });

    // 4. 验证中央仓库已完整还原所有文件与二进制资产
    const restoredDir = skillDir('my-bundled-skill');
    expect(fs.existsSync(path.join(restoredDir, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(restoredDir, 'SKILL.md'), 'utf8')).toContain('# Bundled Skill');
    expect(fs.readFileSync(path.join(restoredDir, 'scripts', 'deploy.sh'), 'utf8')).toContain('deploying via script');
    const binData = fs.readFileSync(path.join(restoredDir, 'assets', 'icon.bin'));
    expect(binData).toEqual(Buffer.from([0x00, 0xff, 0x01, 0xfe, 0x02, 0xfd]));

    // 5. 验证 config 与 expose 正确生效
    const newConfig = loadConfig();
    expect(newConfig.skills['my-bundled-skill']).toBeDefined();

    // 6. 二次运行幂等：返回 ok
    const secondSync = await syncManifest(manifestFile);
    expect(secondSync[0]).toMatchObject({ skill: 'my-bundled-skill', action: 'ok' });
  });

  it('本地文件篡改产生校验和漂移时，syncManifest 能够自动重新覆盖对齐', async () => {
    const manifestFile = path.join(sandboxRoot, 'skillpot.yaml');
    exportManifest(manifestFile, undefined, { bundleLocal: true });

    // 故意篡改中央仓库的 SKILL.md
    fs.writeFileSync(path.join(skillDir('my-bundled-skill'), 'SKILL.md'), '# Tampered Content', 'utf8');

    // 再次 sync 应当发现版本锁不一致并 reinstall
    const res = await syncManifest(manifestFile);
    expect(res[0]).toMatchObject({
      skill: 'my-bundled-skill',
      action: 'reinstall',
      detail: expect.stringContaining('重新覆盖对齐'),
    });

    // 验证文件已被修复还原
    expect(fs.readFileSync(path.join(skillDir('my-bundled-skill'), 'SKILL.md'), 'utf8')).toContain('# Bundled Skill');
  });

  it('inspectManifest 能够识别并标注内联 bundle 技能', () => {
    const manifestFile = path.join(sandboxRoot, 'skillpot.yaml');
    exportManifest(manifestFile, undefined, { bundleLocal: true });

    const inspect = inspectManifest(manifestFile);
    expect(inspect.skills).toHaveLength(1);
    expect(inspect.skills[0].bundled).toBe(true);
    expect(inspect.skills[0].localOnly).toBe(false);
    expect(inspect.warnings).toHaveLength(0);
  });
});
