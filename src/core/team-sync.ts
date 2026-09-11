import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { skillDir } from '../paths';
import { loadConfig, loadState, saveConfig } from './config';
import { exposedTargets } from './expose';
import { addSkill, isGitSource } from './add';
import { enableSkill } from './sync';
import { uninstallSkill } from './uninstall';
import { dirChecksum } from './store';
import { allTargetIds } from '../agents/registry';

/**
 * 团队对齐（主线 B / 产品计划 M2 项目级配置）：
 * - `.skillpot.yaml` 随项目仓库提交，声明本项目需要哪些 skill（来源 + 可选版本锁 + 可选开放矩阵）
 * - `skillpot sync` 让成员本机对齐清单：装缺失、重装与版本锁不一致的、应用开放矩阵
 * - `skillpot sync --export` 从当前中央仓库导出清单（本地来源可配合 --bundle-local 内联打包）
 *
 * 对齐语义（可预期优先）：
 * - 清单带 checksum：本机不一致 → 重装对齐；一致或未声明 → 只保证已装，不主动更新
 * - expose 只做"开启声明为 true 的 Agent"，不主动关闭用户自行开放的
 */

export interface ProjectSkillBundle {
  files: Record<string, string>;
}

export interface ProjectSkillEntry {
  /** git:<url>#<subdir> 或 local:<绝对路径> 或 local:bundled */
  source: string;
  /** 版本锁：省略则只保证已安装，不主动更新 */
  checksum?: string;
  /** 安装/对齐后开放给哪些 Agent（仅 true 生效；省略则装完不开放） */
  expose?: Record<string, boolean>;
  /** 内联本地技能包：直接包含文件树与内容（文本为 utf8，二进制为 base64 data-uri） */
  bundle?: ProjectSkillBundle;
}

export interface ProjectManifest {
  version: 1;
  skills: Record<string, ProjectSkillEntry>;
}

export function loadManifest(file: string): ProjectManifest {
  if (!fs.existsSync(file)) throw new Error(`清单不存在：${file}`);
  let data: ProjectManifest | null = null;
  try {
    data = parse(fs.readFileSync(file, 'utf8')) as ProjectManifest | null;
  } catch (e) {
    throw new Error(`清单解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!data || typeof data !== 'object' || !data.skills || typeof data.skills !== 'object') {
    throw new Error(`清单格式不合法：${file}（需要 version: 1 与 skills 字段）`);
  }
  return { version: 1, skills: data.skills };
}

export interface ExportResult {
  manifest: ProjectManifest;
  file: string;
  /** 导出中发现的 warning 或提示（如 local 来源无法跨机器对齐） */
  warnings: string[];
}

export interface ExportManifestOptions {
  /** 是否将 local 来源技能以 bundle 内联打包进清单（免 Git 分发） */
  bundleLocal?: boolean;
}

/** 从当前中央仓库导出清单；names 缺省导出全部 */
export function exportManifest(
  file: string,
  names?: string[],
  opts?: ExportManifestOptions,
): ExportResult {
  const config = loadConfig();
  const all = Object.entries(config.skills);
  const picked = names?.length ? all.filter(([n]) => names.includes(n)) : all;
  if (!picked.length) throw new Error('中央仓库为空（或未匹配到指定 skill），无可导出内容');

  const warnings: string[] = [];
  const skills: ProjectManifest['skills'] = {};
  const state = loadState();
  const knownIds = allTargetIds();
  for (const [n, e] of picked) {
    // 目标列表覆盖通用广播列（0.11 的广播只落在台账、未登记 expose）
    const ids = exposedTargets(e, state, n, knownIds);
    skills[n] = {
      source: e.source,
      checksum: e.checksum,
      expose: Object.fromEntries(ids.map((id) => [id, true])),
    };
    if (e.source.startsWith('local:')) {
      if (opts?.bundleLocal) {
        const dir = skillDir(n);
        if (fs.existsSync(dir)) {
          const bundleFiles: Record<string, string> = {};
          const walk = (d: string) => {
            for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
              const full = path.join(d, ent.name);
              if (ent.isDirectory()) {
                walk(full);
              } else {
                const rel = path.relative(dir, full).replace(/\\/g, '/');
                const buf = fs.readFileSync(full);
                const isBinary = buf.includes(0);
                if (isBinary) {
                  bundleFiles[rel] = `data:application/octet-stream;base64,${buf.toString('base64')}`;
                } else {
                  bundleFiles[rel] = buf.toString('utf8');
                }
              }
            }
          };
          walk(dir);
          skills[n].bundle = { files: bundleFiles };
          skills[n].source = 'local:bundled';
          warnings.push(`'${n}' 为 local 来源，已通过 --bundle-local 打包内联进清单`);
        } else {
          warnings.push(`'${n}' 本地中央目录缺失，无法打包`);
        }
      } else {
        warnings.push(
          `'${n}' 为 local 来源（${e.source}）——队友无法从本机路径对齐，建议改为 git 源或使用 --bundle-local 导出`,
        );
      }
    }
  }
  const manifest: ProjectManifest = { version: 1, skills };
  fs.writeFileSync(file, stringify(manifest));
  return { manifest, file, warnings };
}

export interface SyncItem {
  skill: string;
  /** install=新装 reinstall=重装对齐版本锁 ok=已一致 skip=跳过 error=失败 */
  action: 'install' | 'reinstall' | 'ok' | 'skip' | 'error';
  /** dry-run 时为 true：action 是"将执行"而非"已执行" */
  dryRun?: boolean;
  detail?: string;
}

function applyExpose(name: string, expose?: Record<string, boolean>): string[] {
  const enabled: string[] = [];
  for (const [agent, on] of Object.entries(expose ?? {})) {
    if (on !== true) continue;
    try {
      const r = enableSkill(name, [agent]);
      if (r.linked.length) enabled.push(agent);
    } catch {
      /* 冲突由 enable 内部跳过 */
    }
  }
  return enabled;
}

export async function syncManifest(
  file: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<SyncItem[]> {
  const manifest = loadManifest(file);
  const config = loadConfig();
  const out: SyncItem[] = [];

  for (const [name, entry] of Object.entries(manifest.skills)) {
    try {
      const installed = !!config.skills[name];
      const src = entry.source.replace(/^git:/, '');

      // 1. 内联 bundle 来源处理（支持免外部 Git 的纯本地技能跨机器还原）
      if (entry.bundle?.files) {
        const dest = skillDir(name);
        const fileCount = Object.keys(entry.bundle.files).length;
        if (fileCount === 0) {
          out.push({ skill: name, action: 'skip', detail: '内联 bundle 为空，无法安装' });
          continue;
        }

        const unpackBundle = () => {
          fs.rmSync(dest, { recursive: true, force: true });
          fs.mkdirSync(dest, { recursive: true });
          for (const [relPath, content] of Object.entries(entry.bundle!.files)) {
            const fullPath = path.join(dest, relPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            if (content.startsWith('data:application/octet-stream;base64,')) {
              const b64 = content.slice('data:application/octet-stream;base64,'.length);
              fs.writeFileSync(fullPath, Buffer.from(b64, 'base64'));
            } else {
              fs.writeFileSync(fullPath, content, 'utf8');
            }
          }
          const checksum = dirChecksum(dest);
          const currentConfig = loadConfig();
          currentConfig.skills[name] = {
            source: entry.source || 'local:bundled',
            checksum,
            installed_at: new Date().toISOString(),
            expose: {},
          };
          saveConfig(currentConfig);
          applyExpose(name, entry.expose);
          return checksum;
        };

        if (!installed) {
          if (opts.dryRun) {
            out.push({ skill: name, action: 'install', dryRun: true, detail: '从清单内嵌 bundle 安装' });
            continue;
          }
          const newChecksum = unpackBundle();
          const detail =
            entry.checksum && newChecksum !== entry.checksum
              ? '已从 bundle 安装（但与清单 checksum 不一致）'
              : '已从清单内嵌 bundle 安装';
          out.push({ skill: name, action: 'install', detail });
          continue;
        }

        // 已安装：比对实际内容与 checksum
        let drifted = false;
        if (entry.checksum) {
          try {
            drifted = dirChecksum(dest) !== entry.checksum;
          } catch {
            drifted = true;
          }
        }
        if (drifted) {
          if (opts.dryRun) {
            out.push({
              skill: name,
              action: 'reinstall',
              dryRun: true,
              detail: '本机版本与清单锁定的 checksum 不一致，将从内嵌 bundle 重新覆盖',
            });
            continue;
          }
          unpackBundle();
          out.push({ skill: name, action: 'reinstall', detail: '已从内嵌 bundle 重新覆盖对齐' });
          continue;
        }

        applyExpose(name, entry.expose);
        out.push({ skill: name, action: 'ok', detail: '已一致（内嵌 bundle）' });
        continue;
      }

      // 2. local 来源：机器相关，不跨机器对齐
      if (entry.source.startsWith('local:')) {
        out.push({
          skill: name,
          action: installed ? 'ok' : 'skip',
          detail: installed
            ? 'local 来源，跳过对齐（仅本机有意义）'
            : `local 来源（${entry.source}）在本机不存在，无法安装（建议导出时使用 --bundle-local）`,
        });
        continue;
      }
      if (!isGitSource(src)) {
        out.push({ skill: name, action: 'skip', detail: `不支持的来源：${entry.source}` });
        continue;
      }

      if (!installed) {
        if (opts.dryRun) {
          out.push({ skill: name, action: 'install', dryRun: true });
          continue;
        }
        const r = await addSkill(src, {
          name,
          for: Object.entries(entry.expose ?? {})
            .filter(([, v]) => v === true)
            .map(([a]) => a),
          force: opts.force,
        });
        let detail = r.checksum === entry.checksum ? undefined : '已安装，但与清单 checksum 不一致（远端可能已更新）';
        out.push({ skill: name, action: 'install', detail });
        continue;
      }

      // 已登记：用本地仓库"实际内容"的校验和与清单锁对齐（可发现被手改的漂移）；
      // 仓库目录缺失/损坏也视为偏离 → 走重装
      let drifted = false;
      if (entry.checksum) {
        try {
          drifted = dirChecksum(skillDir(name)) !== entry.checksum;
        } catch {
          drifted = true;
        }
      }
      if (drifted) {
        if (opts.dryRun) {
          out.push({
            skill: name,
            action: 'reinstall',
            dryRun: true,
            detail: '本机版本与清单锁定的 checksum 不一致，将重装对齐',
          });
          continue;
        }
        uninstallSkill(name);
        const r = await addSkill(src, {
          name,
          for: Object.entries(entry.expose ?? {})
            .filter(([, v]) => v === true)
            .map(([a]) => a),
          force: opts.force,
        });

        out.push({
          skill: name,
          action: 'reinstall',
          detail:
            r.checksum === entry.checksum
              ? '已重装对齐清单版本'
              : '已重装，但仍与清单 checksum 不一致（远端可能已更新，建议更新清单）',
        });
        continue;
      }

      // 已装且（无版本锁或内容一致）：应用 expose 增量
      applyExpose(name, entry.expose);
      out.push({ skill: name, action: 'ok' });
    } catch (e) {
      out.push({
        skill: name,
        action: 'error',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/** 供 CLI/GUI 展示的动作中文标签 */
export const SYNC_ACTION_LABELS: Record<SyncItem['action'], string> = {
  install: '安装',
  reinstall: '重装对齐',
  ok: '已一致',
  skip: '跳过',
  error: '失败',
};

export function syncActionLabel(item: SyncItem): string {
  return SYNC_ACTION_LABELS[item.action] + (item.dryRun ? '（将执行）' : '');
}

/** 校验和一致性小工具（测试/诊断用） */
export function manifestChecksumOf(dir: string): string {
  return dirChecksum(dir);
}

export interface ManifestInspectItem {
  skill: string;
  source: string;
  checksum?: string;
  expose: Record<string, boolean>;
  /** 本机是否已安装（config 登记） */
  installed: boolean;
  /** 已安装时：本地实际内容是否与清单 checksum 一致（清单未声明 checksum 时为 null） */
  checksumMatch: boolean | null;
  /** config 有登记但中央仓库目录已缺失 */
  storeMissing?: boolean;
  /** local 来源无法跨机器对齐（若内嵌 bundle 则为 false） */
  localOnly: boolean;
  /** 是否内联了技能完整包 */
  bundled?: boolean;
}

export interface ManifestInspect {
  file: string;
  skills: ManifestInspectItem[];
  warnings: string[];
}

/** 清单体检：逐项标注本机安装状态与校验和一致性（GUI 预览用，无副作用） */
export function inspectManifest(file: string): ManifestInspect {
  const manifest = loadManifest(file);
  const config = loadConfig();
  const skills: ManifestInspectItem[] = [];
  const warnings: string[] = [];

  for (const [name, entry] of Object.entries(manifest.skills)) {
    const installed = !!config.skills[name];
    const isBundled = !!entry.bundle?.files;
    const localOnly = entry.source.startsWith('local:') && !isBundled;
    let checksumMatch: boolean | null = null;
    let storeMissing = false;
    if (installed && entry.checksum) {
      try {
        checksumMatch = dirChecksum(skillDir(name)) === entry.checksum;
      } catch (e) {
        checksumMatch = false; // config 有记录但仓库目录已缺失/损坏
        storeMissing = !fs.existsSync(skillDir(name));
      }
    }
    if (localOnly) {
      warnings.push(
        installed
          ? `'${name}' 为 local 来源，跳过对齐（仅本机有意义）`
          : `'${name}' 为 local 来源（${entry.source}）在本机不存在，sync 将跳过（可使用 --bundle-local）`,
      );
    }
    skills.push({
      skill: name,
      source: entry.source,
      checksum: entry.checksum,
      expose: Object.fromEntries(Object.entries(entry.expose ?? {}).filter(([, v]) => v === true)),
      installed,
      checksumMatch,
      storeMissing,
      localOnly,
      bundled: isBundled,
    });
  }
  return { file, skills, warnings };
}
