import fs from 'node:fs';
import { parse, stringify } from 'yaml';
import { skillDir } from '../paths';
import { loadConfig } from './config';
import { addSkill, isGitSource } from './add';
import { enableSkill } from './sync';
import { uninstallSkill } from './uninstall';
import { dirChecksum } from './store';

/**
 * 团队对齐（主线 B / 产品计划 M2 项目级配置）：
 * - `.skillpot.yaml` 随项目仓库提交，声明本项目需要哪些 skill（来源 + 可选版本锁 + 可选开放矩阵）
 * - `skillpot sync` 让成员本机对齐清单：装缺失、重装与版本锁不一致的、应用开放矩阵
 * - `skillpot sync --export` 从当前中央仓库导出清单（本地来源会警告——队友无法对齐）
 *
 * 对齐语义（可预期优先）：
 * - 清单带 checksum：本机不一致 → 重装对齐；一致或未声明 → 只保证已装，不主动更新
 * - expose 只做"开启声明为 true 的 Agent"，不主动关闭用户自行开放的
 */

export interface ProjectSkillEntry {
  /** git:<url>#<subdir> 或 local:<绝对路径>（local 无法跨机器对齐，仅本机有意义） */
  source: string;
  /** 版本锁：省略则只保证已安装，不主动更新 */
  checksum?: string;
  /** 安装/对齐后开放给哪些 Agent（仅 true 生效；省略则装完不开放） */
  expose?: Record<string, boolean>;
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
  /** 导出中发现的 warning（如 local 来源无法跨机器对齐） */
  warnings: string[];
}

/** 从当前中央仓库导出清单；names 缺省导出全部 */
export function exportManifest(file: string, names?: string[]): ExportResult {
  const config = loadConfig();
  const all = Object.entries(config.skills);
  const picked = names?.length ? all.filter(([n]) => names.includes(n)) : all;
  if (!picked.length) throw new Error('中央仓库为空（或未匹配到指定 skill），无可导出内容');

  const warnings: string[] = [];
  const skills: ProjectManifest['skills'] = {};
  for (const [n, e] of picked) {
    skills[n] = {
      source: e.source,
      checksum: e.checksum,
      expose: Object.fromEntries(Object.entries(e.expose).filter(([, v]) => v === true)),
    };
    if (e.source.startsWith('local:')) {
      warnings.push(
        `'${n}' 为 local 来源（${e.source}）——队友无法从本机路径对齐，建议改为 git 源后重新导出`,
      );
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
  opts: { dryRun?: boolean } = {},
): Promise<SyncItem[]> {
  const manifest = loadManifest(file);
  const config = loadConfig();
  const out: SyncItem[] = [];

  for (const [name, entry] of Object.entries(manifest.skills)) {
    try {
      const installed = !!config.skills[name];
      const src = entry.source.replace(/^git:/, '');

      // local 来源：机器相关，不跨机器对齐
      if (entry.source.startsWith('local:')) {
        out.push({
          skill: name,
          action: installed ? 'ok' : 'skip',
          detail: installed
            ? 'local 来源，跳过对齐（仅本机有意义）'
            : `local 来源（${entry.source}）在本机不存在，无法安装`,
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
        const r = await addSkill(src, { name, for: Object.entries(entry.expose ?? {}).filter(([, v]) => v === true).map(([a]) => a) });
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
        const r = await addSkill(src, { name, for: Object.entries(entry.expose ?? {}).filter(([, v]) => v === true).map(([a]) => a) });
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
  /** local 来源无法跨机器对齐 */
  localOnly: boolean;
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
    const localOnly = entry.source.startsWith('local:');
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
          : `'${name}' 为 local 来源（${entry.source}）在本机不存在，sync 将跳过`,
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
    });
  }
  return { file, skills, warnings };
}
