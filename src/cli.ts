// 注意：shebang 由构建脚本的 --banner 注入（esbuild 会把源码 hashbang 排在 banner 之后，
// 而 ESM 产物要求 hashbang 必须在第一行，故源码不写 shebang）。
import fs from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline';
import { Command } from 'commander';
import pc from 'picocolors';

import { agentHome, skillDir, storeDir } from './paths';
import { allTargetIds } from './agents/registry';
import { detectAll } from './agents/detect';
import { initStore, loadConfig, loadState } from './core/config';
import { exposedTargets, isExposed } from './core/expose';
import { storeSkillNames } from './core/store';
import { addSkill } from './core/add';
import { uninstallSkill } from './core/uninstall';
import { addSource, formatInstalls, getRegistryStatus, installFromDirectory, listSources, removeSource, scanSource, searchDirectory } from './core/market';
import { runAudit } from './core/audit';
import { exportManifest, SYNC_ACTION_LABELS, syncManifest } from './core/team-sync';
import { disableSkill, enableSkill, broadcastSkill, isBroadcastTarget, resolveAgentIds, SyncResult } from './core/sync';
import { fixDoctor, runDoctor } from './core/doctor';
import { adoptSkills, AdoptStatus, scanAdoptable } from './core/adopt';
import { lintSkill, lintSummary } from './core/lint';
import { updateSkills } from './core/update';
import { applyPolicy, checkPolicy, DEFAULT_POLICY_FILE, generatePolicyTemplate, loadPolicy } from './core/policy';
import { startMcpServer } from './core/mcp-server';
import { startGuiServer } from './core/gui-server';
import { runTui } from './tui/index';
import { renderTable } from './util/table';
import { VERSION } from './version';
import { VERIFY_LABELS, VerifyLevel } from './types';
import { initUpdateNotifier } from './util/update-notifier';

const program = new Command();

program
  .name('skillpot')
  .description(
    '面向编程 Agent 的 Skill 供应链安全与跨工具治理层 —— 一处安装，按 Agent 粒度开关，安装即阻断恶意注入，全量目录审计与 CI 门禁',
  )
  .version(VERSION);

initUpdateNotifier();

/** 统一错误出口：业务错误只打印消息，不打堆栈；兼容同步/异步 action */
function run(fn: (...args: any[]) => unknown): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(pc.red(`✗ ${e instanceof Error ? e.message : String(e)}`));
      process.exitCode = 1;
    }
  };
}

/** --for 的统一说明：all 只展开具体 Agent；通用广播是粗粒度渠道，需显式写 broadcast */
const FOR_HELP =
  '逗号分隔目标 id（agent，或 broadcast=通用广播），或 all（全部 Agent，不含通用广播）';

/** 验证等级着色：实测=绿，文档确认=默认，未验证=黄（不假装已确认） */
function verifyTag(level: VerifyLevel): string {
  const label = VERIFY_LABELS[level];
  if (level === 'live') return pc.green(label);
  if (level === 'unverified') return pc.yellow(label);
  return label;
}

function printAgents(): void {
  const results = detectAll();
  const rows = results.map((r) => [
    r.kind === 'channel' ? `${r.name}${pc.dim('（共享目录）')}` : r.name,
    r.kind === 'channel' ? pc.dim('channel') : r.installed ? pc.green('yes') : pc.dim('no'),
    r.version ?? '-',
    r.skillsDir.replace(agentHome(), '~'),
    verifyTag(r.verify),
  ]);
  console.log(renderTable(['Agent', 'Installed', 'Version', 'Skills目录', '验证'], rows));
  console.log();
  for (const r of results) {
    console.log(pc.dim(`${r.name}：`) + verifyTag(r.verify) + pc.dim(` — ${r.verified}`));
    if (r.note) console.log(pc.dim(`  ${r.note}`));
  }
  console.log(
    pc.dim(
      '\n验证等级：实测=实机确认该 Agent 能发现 SkillPot 建立的链接；文档确认=路径有官方依据、链接发现未实测；未验证=路径仍待确认',
    ),
  );
}

function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      const a = ans.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes' || a === '是' || a === '好');
    });
  });
}

/**
 * 空仓库提醒：检测各已安装 Agent 下的已有 skill，TTY 下询问用户是否移入 SkillPot
 * （move 模式：内容拷入中央仓库后，原目录替换为指向中央仓库的 symlink，来源 Agent 继续可用）。
 * 返回是否执行了收编。
 */
async function suggestAdopt(): Promise<boolean> {
  const config = loadConfig();
  if (Object.keys(config.skills).length > 0) return false;

  const found = detectAll()
    .filter((r) => r.installed)
    .map((r) => ({ id: r.id, name: r.name, skills: scanAdoptable(r.id) }))
    .filter((f) => f.skills.length > 0);
  if (!found.length) return false;

  const total = found.reduce((n, f) => n + f.skills.length, 0);
  console.log();
  console.log(pc.bold(`检测到各 Agent 目录下已有 ${total} 个 skill：`));
  console.log(
    renderTable(
      ['Agent', '可收编', '目录'],
      found.map((f) => [
        f.name,
        String(f.skills.length),
        f.skills[0].path.replace(agentHome(), '~') + (f.skills.length > 1 ? ' …' : ''),
      ]),
    ),
  );

  if (!process.stdin.isTTY) {
    console.log(
      pc.dim(
        `\n运行 ${pc.cyan('skillpot adopt')} 收编（--move 可将原目录替换为 symlink），${pc.cyan('skillpot adopt --dry-run')} 预览`,
      ),
    );
    return false;
  }

  const yes = await promptConfirm(
    pc.cyan(`\n是否移入 SkillPot（内容拷入中央仓库，原目录替换为 symlink，各 Agent 继续可用）？[Y/n] `),
  );
  if (!yes) {
    console.log(pc.dim('已跳过。可随时运行 skillpot adopt'));
    return false;
  }

  const report = adoptSkills({ move: true });
  console.log(
    pc.green(
      `\n✔ 移入完成：导入 ${report.imported}，链接 ${report.linked}，同名跳过 ${report.exists}，其他跳过 ${report.skipped}`,
    ),
  );
  for (const i of report.items) {
    if (i.status === 'skipped-invalid' && i.detail) {
      console.log(pc.yellow(`⚠ ${i.agent}/${i.name}: ${i.detail}`));
    }
  }
  return report.imported + report.linked > 0;
}

program
  .command('init')
  .description('初始化中央仓库（~/.skillpot）并检测本机 Agent')
  .action(
    run(async () => {
      const { created } = initStore();
      console.log(
        created
          ? pc.green(`已创建中央仓库 ${storeDir()}`)
          : `中央仓库已存在：${storeDir()}`,
      );
      console.log();
      printAgents();
      const adopted = await suggestAdopt();
      if (!adopted) {
        console.log(
          `\n下一步：${pc.cyan('skillpot add <本地目录 | git URL[#subdir]>')} 安装 skill，或 ${pc.cyan('skillpot adopt')} 收编各 Agent 已有 skill`,
        );
      }
    }),
  );

program
  .command('agents')
  .description('检测本机安装的编程 Agent 及其 skill 能力')
  .option('--json', '以 JSON 输出')
  .action(
    run((opts: { json?: boolean }) => {
      const results = detectAll();
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      printAgents();
    }),
  );

program
  .command('add <source>')
  .description(
    '安装 skill 到中央仓库（本地目录或 git URL；git 支持 repo#subdir。默认不对任何 Agent 开放）',
  )
  .option('-n, --name <name>', '指定 skill 名（默认取 frontmatter name 或目录名）')
  .option('-f, --force', '跳过安全检查阻断，强制安装')
  .option('-p, --policy <path>', '指定策略文件路径进行合规校验')
  .action(
    run(async (source: string, opts: { name?: string; force?: boolean; policy?: string }) => {
      const policyObj = opts.policy ? loadPolicy(opts.policy)?.policy : undefined;
      const res = await addSkill(source, { name: opts.name, force: opts.force, policy: policyObj });
      console.log(pc.green(`✔ 已安装 ${res.name}`));
      if (res.description) console.log(pc.dim(`  ${res.description.slice(0, 120)}`));
      for (const i of res.lint) {
        const tag = i.level === 'error' ? pc.red('error') : pc.yellow('warn ');
        console.log(`  ${tag} ${i.message}`);
      }
      if (res.lint.length) {
        console.log(pc.dim(`  lint: ${lintSummary(res.lint)}（skillpot lint ${res.name} 查看详情）`));
      }
      if (res.enabled.length) {
        console.log(pc.green(`已开放：${res.enabled.join(', ')}`));
        warnBroadcast(res.enabled);
        for (const s of res.skipped) console.log(pc.yellow(`⚠ ${s.agent}: ${s.reason}`));
      } else {
        console.log(
          `默认未对任何目标开放。执行 ${pc.cyan(
            `skillpot enable ${res.name} --for <targets>`,
          )}（可选：${allTargetIds().join(',')}，或 all=全部 Agent）`,
        );
      }
    }),
  );


program
  .command('list')
  .description('列出中央仓库中的 skill及开放状态')
  .option('-a, --agent <id>', '只看某个目标（agent id 或 broadcast）的可见列表')
  .action(
    run((opts: { agent?: string }) => {
      const config = loadConfig();
      const state = loadState();
      const names = Object.keys(config.skills).sort();
      const untracked = storeSkillNames().filter((n) => !config.skills[n]);
      const knownIds = allTargetIds();

      if (opts.agent) {
        const ids = resolveAgentIds(opts.agent);
        if (ids.length !== 1) throw new Error('list --agent 只接受单个目标 id');
        const id = ids[0];
        console.log(pc.bold(`${id} 可见的 skill（来自 SkillPot）：`));
        const rows = names
          .filter((n) => isExposed(config.skills[n], state, n, id))
          .map((n) => [n, config.skills[n].source]);
        console.log(rows.length ? renderTable(['Skill', 'Source'], rows) : pc.dim('  （无）'));
        return;
      }

      const rows = names.map((n) => {
        const e = config.skills[n];
        const exposed = exposedTargets(e, state, n, knownIds).join(',') || '-';
        return [n, exposed, e.source, e.checksum.slice(0, 15)];
      });
      console.log(renderTable(['Skill', '开放给', 'Source', 'Checksum'], rows));
      if (untracked.length) {
        console.log(pc.yellow(`未登记：${untracked.join(', ')}（运行 skillpot doctor 查看）`));
      }
    }),
  );

program
  .command('enable <skill>')
  .description('对指定目标开放 skill（在目标的 skills 目录建立 symlink）')
  .option('-f, --for <targets>', FOR_HELP, 'all')
  .option('-p, --policy <path>', '指定策略文件路径进行合规校验')
  .action(
    run((skill: string, opts: { for: string; policy?: string }) => {
      const policyObj = opts.policy ? loadPolicy(opts.policy)?.policy : undefined;
      reportSync(enableSkill(skill, resolveAgentIds(opts.for), { policy: policyObj }), '开放');
    }),
  );

program
  .command('disable <skill>')
  .description('对指定目标关闭 skill（移除 symlink）')
  .option('-f, --for <targets>', FOR_HELP, 'all')
  .action(
    run((skill: string, opts: { for: string }) => {
      reportSync(disableSkill(skill, resolveAgentIds(opts.for)), '关闭');
    }),
  );

/** 通用广播是粗粒度渠道，落到这一列时显式告知用户影响面 */
function warnBroadcast(targets: string[]): void {
  if (!targets.some((t) => isBroadcastTarget(t))) return;
  console.log(
    pc.yellow(
      '  ⚠ 通用广播：~/.agents/skills 里所有支持该约定的 Agent 都可见，且无法按 Agent 单独关闭',
    ),
  );
}

function reportSync(res: SyncResult, verb: string): void {
  if (res.linked.length) {
    console.log(pc.green(`✔ ${res.skill} 已${verb}：${res.linked.join(', ')}`));
    warnBroadcast(res.linked);
    console.log(pc.dim('  提示：Agent 在会话启动时扫描 skill 目录，重启示例会话后生效'));
  }
  for (const s of res.skipped) {
    console.log(pc.yellow(`⚠ ${s.agent}: ${s.reason}`));
  }
  if (!res.linked.length && !res.skipped.length) console.log(pc.dim('无变更'));
}

program
  .command('remove <skill>')
  .description('从中央仓库卸载 skill（撤下所有 Agent 的链接并删除文件）')
  .action(
    run((skill: string) => {
      uninstallSkill(skill);
      console.log(pc.green(`✔ 已卸载 ${skill}`));
    }),
  );

program
  .command('doctor')
  .description('体检：断链、expose 漂移、未登记 skill、孤儿链接')
  .option('--fix', '自动修复可修复项（断链台账、expose 漂移）')
  .action(
    run((opts: { fix?: boolean }) => {
      if (opts.fix) {
        const { fixed, remaining } = fixDoctor();
        for (const f of fixed) console.log(pc.green(`✔ ${f}`));
        if (!remaining.length) {
          console.log(pc.green('体检通过'));
          return;
        }
        printIssues(remaining);
        return;
      }
      const issues = runDoctor();
      if (!issues.length) {
        console.log(pc.green('体检通过：config、台账与各 Agent 目录一致'));
        return;
      }
      printIssues(issues);
    }),
  );

program
  .command('audit')
  .description('审计：每个 Agent 实际生效的 skill、来源与被绕过/遮蔽情况')
  .option('-p, --policy <path>', '指定策略文件进行合规审计')
  .option('--json', '以 JSON 输出')
  .option('--ci', 'CI 模式（存在风险时非零退出码）')
  .option('--fail-on <level>', '非零退出门禁级别：error（默认）或 warn')
  .action(
    run((opts: { policy?: string; json?: boolean; ci?: boolean; failOn?: string }) => {
      const report = runAudit({ policyFile: opts.policy });
      const errorCount = report.agents.reduce(
        (n, a) => n + a.findings.filter((f) => f.level === 'error').length,
        0,
      );
      const warnCount = report.agents.reduce(
        (n, a) => n + a.findings.filter((f) => f.level === 'warn').length,
        0,
      );

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        if (report.policyResult) {
          console.log(
            pc.bold(`【组织策略合规审查：${report.policyResult.policy.name || '安全基线'}】`),
          );
          if (report.policyResult.compliant) {
            console.log(pc.green('  ✔ 策略合规：未发现违规项'));
          } else {
            for (const v of report.policyResult.violations) {
              const tag = v.severity === 'error' ? pc.red('  ✗') : pc.yellow('  ⚠');
              console.log(`${tag} ${v.message} ${pc.dim(`(${v.rule})`)}`);
            }
          }
          console.log();
        }

        for (const a of report.agents) {
          console.log(
            pc.bold(`${a.agentName} (${a.agent})`) + ` — 实际生效 ${a.active.length} 个`,
          );
          if (a.active.length) {
            console.log(
              renderTable(
                ['Skill', '来源', '声明'],
                a.active.map((e) => [
                  e.skill,
                  e.source.length > 64 ? e.source.slice(0, 61) + '…' : e.source,
                  e.enabled ? '开放' : pc.yellow('关闭（链接残留）'),
                ]),
              ),
            );
          } else {
            console.log(pc.dim('  （无生效 skill）'));
          }
          for (const e of a.external) {
            console.log(pc.yellow(`⚠ 外部条目（非本工具创建）：${e.path}`));
          }
          for (const f of a.findings) {
            console.log(f.level === 'error' ? pc.red(`✗ ${f.message}`) : pc.yellow(`⚠ ${f.message}`));
          }
          console.log();
        }
        const total = report.agents.reduce((n, a) => n + a.findings.length, 0);
        console.log(
          total
            ? pc.yellow(
                `审计完成，共 ${total} 条发现（${errorCount} error / ${warnCount} warn），详见上表`,
              )
            : pc.green('审计通过：各 Agent 实际生效状态与矩阵一致'),
        );
      }

      if (opts.ci || opts.failOn) {
        const threshold = (opts.failOn || 'error').toLowerCase();
        if (threshold === 'warn' && (errorCount > 0 || warnCount > 0)) {
          process.exitCode = 1;
        } else if (threshold === 'error' && errorCount > 0) {
          process.exitCode = 1;
        }
      }
    }),
  );


function printIssues(issues: { level: string; message: string }[]): void {
  for (const i of issues) {
    const tag = i.level === 'error' ? pc.red('error') : pc.yellow('warn ');
    console.log(`${tag}  ${i.message}`);
  }
  console.log(
    pc.dim(`\n共 ${issues.length} 项。运行 ${pc.cyan('skillpot doctor --fix')} 自动修复可修复项`),
  );
}

program
  .command('adopt')
  .description('收编各 Agent 目录下已有的 skill 进中央仓库（原目录保留不动；--dry-run 预览）')
  .option('--from <agents>', '只扫描指定 agent（逗号分隔），缺省为全部已检测安装的 agent')
  .option('-f, --for <targets>', `导入后开放给哪些目标（${FOR_HELP}；默认不开放）`)
  .option('--move', '移动模式：导入（或已有同名）后把来源 Agent 目录下的原目录替换为 symlink')
  .option('--dry-run', '只报告将导入的内容，不做任何修改')
  .action(
    run((opts: { from?: string; for?: string; move?: boolean; dryRun?: boolean }) => {
      initStore();
      const report = adoptSkills({
        from: opts.from ? resolveAgentIds(opts.from) : undefined,
        enableFor: opts.for ? resolveAgentIds(opts.for) : undefined,
        move: opts.move,
        dryRun: opts.dryRun,
      });
      const label: Record<AdoptStatus, string> = {
        imported: '✔ 导入',
        linked: '⇄ 已链接（move）',
        exists: '＝ 已存在（同名跳过）',
        'skipped-managed': '· 已由本工具管理',
        'skipped-invalid': '✗ 无效',
        'dry-run': '… 待导入',
      };
      const rows = report.items.map((i) => [
        i.agent,
        i.name,
        label[i.status],
        i.detail ?? '',
      ]);
      if (rows.length) console.log(renderTable(['Agent', 'Skill', '状态', '备注'], rows));
      if (opts.dryRun) {
        console.log(
          pc.dim(`\ndry-run：将导入 ${report.imported} 个（同名冲突 ${report.exists}）。去掉 --dry-run 执行`),
        );
      } else {
        console.log(
          pc.green(
            `\n✔ 收编完成：导入 ${report.imported}，链接 ${report.linked}，同名跳过 ${report.exists}，其他跳过 ${report.skipped}`,
          ),
        );
        if (report.imported && !opts.for && !opts.move) {
          console.log(`执行 ${pc.cyan('skillpot enable <skill> --for <agents>')} 开放给目标 Agent`);
        }
      }
    }),
  );

program
  .command('lint [skill]')
  .description('安全与质量检查：frontmatter 完整性 + 脚本高危模式扫描（缺省检查全部）')
  .option('--strict', '存在 warn 时以非零码退出（CI 用）')
  .action(
    run((skill: string | undefined, opts: { strict?: boolean }) => {
      const config = loadConfig();
      const names = skill ? [skill] : Object.keys(config.skills).sort();
      let bad = 0;
      for (const n of names) {
        if (!config.skills[n]) throw new Error(`config 中没有 skill '${n}'`);
        const issues = lintSkill(skillDir(n));
        if (!issues.length) {
          console.log(pc.green(`✔ ${n}: clean`));
          continue;
        }
        bad++;
        console.log(pc.bold(`${n}（${lintSummary(issues)}）`));
        for (const i of issues) {
          const tag = i.level === 'error' ? pc.red('error') : pc.yellow('warn ');
          console.log(`  ${tag} ${i.message}`);
        }
      }
      if (opts.strict && bad) process.exitCode = 1;
    }),
  );

program
  .command('update [skill]')
  .description('检查并应用 git 来源 skill 的更新（--check 只报告；local 来源会跳过）')
  .option('--check', '只检查远端是否有更新，不应用')
  .action(
    run(async (skill: string | undefined, opts: { check?: boolean }) => {
      const results = await updateSkills(skill, { check: opts.check });
      const label: Record<string, string> = {
        'up-to-date': '＝ 已是最新',
        outdated: '↑ 有更新',
        updated: '✔ 已更新',
        local: '· 本地来源',
        error: '✗ 失败',
      };
      console.log(
        renderTable(
          ['Skill', '状态', '备注'],
          results.map((r) => {
            let note = r.detail ?? '';
            if (r.diff) {
              const { added, modified, removed } = r.diff;
              const counts = [
                added.length ? `+${added.length}` : '',
                modified.length ? `~${modified.length}` : '',
                removed.length ? `-${removed.length}` : '',
              ]
                .filter(Boolean)
                .join(' ');
              const paths = [...added, ...modified, ...removed];
              note = `${note ? note + ' ' : ''}diff ${counts}（${paths.slice(0, 4).join('、')}${
                paths.length > 4 ? ' 等' : ''
              }）`;
            }
            return [r.skill, label[r.status] ?? r.status, note];
          }),
        ),
      );
    }),
  );

program
  .command('mcp')
  .description('以 MCP server (stdio) 运行，供任意支持 MCP 的 Agent 消费中央仓库')
  .action(
    run(() => {
      startMcpServer();
    }),
  );

program
  .command('tui')
  .description('交互式开关矩阵（skill × Agent）：↑↓←→ 移动，空格切换，a 整行，q 退出')
  .option('--once', '静态输出矩阵后退出（无 TTY / 管道场景）')
  .action(
    run((opts: { once?: boolean }) => {
      runTui({ once: opts.once });
    }),
  );

program
  .command('gui')
  .description('启动本地 Web 控制台（默认仅监听 127.0.0.1）：矩阵、收编、安装、维护与体检')
  .option('--port <port>', '指定监听端口（默认随机空闲端口）')
  .option(
    '--host <host>',
    '监听地址（默认 127.0.0.1；设为 0.0.0.0 允许局域网访问，届时所有请求都要求 token）',
  )
  .option('--no-open', '不自动打开浏览器，仅打印访问地址')
  .action(
    run(async (opts: { port?: string; host?: string; open?: boolean }) => {
      const port = opts.port ? Number(opts.port) : undefined;
      if (opts.port && (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535)) {
        throw new Error(`非法端口：${opts.port}`);
      }
      const { url } = await startGuiServer({
        port,
        host: opts.host,
        open: opts.open,
      });
      console.log(pc.bold(`✓ SkillPot GUI 已启动：${pc.cyan(url)}`));
      if (opts.host && !['127.0.0.1', 'localhost', '::1'].includes(opts.host)) {
        console.log(
          pc.yellow('⚠ 已绑定非回环地址：同网段设备可访问，所有请求（含读取）均要求 token'),
        );
      }
      if (opts.open === false) console.log(pc.dim('（未自动打开浏览器，请手动访问上方地址）'));
      console.log(pc.dim('按 Ctrl+C 退出'));
    }),
  );

const sourceCmd = program.command('source').description('管理市场技能源（git 仓库）');
sourceCmd
  .command('list')
  .description('列出已配置的技能源')
  .action(
    run(() => {
      const rows = listSources().map((s) => [s.name, s.url, s.builtin ? '内置' : '自定义']);
      console.log(renderTable(['名称', 'URL', '类型'], rows));
    }),
  );
sourceCmd
  .command('add <url> [name]')
  .description('添加自定义技能源（git 仓库地址）')
  .action(
    run(async (url: string, name?: string) => {
      const s = addSource(url, name);
      console.log(pc.green(`✔ 已添加源 ${s.name}：${s.url}`));
      console.log(pc.dim(`预览：skillpot market ${s.url}，或在 GUI「市场」页一键安装`));
    }),
  );
sourceCmd
  .command('remove <url>')
  .description('移除自定义技能源')
  .action(
    run((url: string) => {
      removeSource(url);
      console.log(pc.green(`✔ 已移除源 ${url}`));
    }),
  );

program
  .command('market [url]')
  .description('浏览技能源里的 skill（缺省扫描全部源；官方源为 anthropics/skills）')
  .option('--refresh', '强制重新克隆源仓库（默认命中本地缓存）')
  .action(
    run(async (url: string | undefined, opts: { refresh?: boolean }) => {
      const targets = url ? [url] : listSources().map((s) => s.url);
      for (const t of targets) {
        const r = await scanSource(t, { refresh: opts.refresh });
        console.log(
          pc.bold(`${t}（${r.skills.length} 个 skill，${r.cloned ? '已重新克隆' : '本地缓存'}）`),
        );
        if (r.skills.length) {
          console.log(
            renderTable(
              ['Skill', '说明', '子目录', '已装'],
              r.skills.map((s) => [
                s.name,
                s.description.slice(0, 56),
                s.subdir,
                s.installed ? '✓' : '',
              ]),
            ),
          );
        }
        console.log();
      }
      console.log(
        pc.dim(`安装：skillpot add <源地址>#<子目录>，或在 GUI「市场」页一键安装并开放`),
      );
    }),
  );

program
  .command('sync')
  .description('团队对齐：按项目清单（默认 ./.skillpot.yaml）安装/对齐 skill 并应用开放矩阵')
  .option('--file <path>', '清单路径（默认 ./.skillpot.yaml）')
  .option('--export', '把当前中央仓库导出为清单（配合 --file/--skill）')
  .option('--skill <skills>', '导出时仅导出指定 skill（逗号分隔）')
  .option('--dry-run', '只展示将对齐的动作，不做任何变更')
  .action(
    run(async (opts: { file?: string; export?: boolean; skill?: string; dryRun?: boolean }) => {
      const file = path.resolve(opts.file ?? '.skillpot.yaml');
      if (opts.export) {
        const { manifest, warnings } = exportManifest(file, opts.skill?.split(','));
        console.log(pc.green(`✔ 已导出 ${Object.keys(manifest.skills).length} 个 skill → ${file}`));
        for (const w of warnings) console.log(pc.yellow(`⚠ ${w}`));
        console.log(pc.dim('提交进项目仓库后，团队成员执行 skillpot sync 即可一键对齐'));
        return;
      }
      const items = await syncManifest(file, { dryRun: opts.dryRun });
      if (!items.length) {
        console.log(pc.dim('清单为空，无可对齐内容'));
        return;
      }
      console.log(
        renderTable(
          ['Skill', '动作', '说明'],
          items.map((i) => [
            i.skill,
            SYNC_ACTION_LABELS[i.action] + (i.dryRun ? '（将执行）' : ''),
            i.detail ?? '',
          ]),
        ),
      );
      const counts = items.reduce<Record<string, number>>((m, i) => {
        m[i.action] = (m[i.action] ?? 0) + 1;
        return m;
      }, {});
      const summary = Object.entries(counts)
        .map(([k, v]) => `${SYNC_ACTION_LABELS[k as keyof typeof SYNC_ACTION_LABELS] ?? k} ${v}`)
        .join('，');
      console.log(
        opts.dryRun
          ? pc.dim(`以上为试运行结果（--dry-run），未做任何变更。${summary}`)
          : pc.green(`对齐完成：${summary}`),
      );
      const errors = items.filter((i) => i.action === 'error');
      if (errors.length) process.exitCode = 1;
    }),
  );

program
  .command('broadcast <skill>')
  .description(
    '通用广播列的命令糖（等价 enable --for broadcast）：放进跨工具共享目录 ~/.agents/skills，对所有支持该约定的 Agent 可见；粗粒度、无法按 Agent 单独关闭',
  )
  .option('--off', '撤下广播')
  .action(
    run((skill: string, opts: { off?: boolean }) => {
      const r = broadcastSkill(skill, opts.off === true);
      if (r.changed) console.log(pc.green(`✔ ${r.message}`));
      else console.log(pc.dim(r.message));
    }),
  );

program
  .command('search <query>')
  .description('在 skills.sh 目录中搜索 skill（匿名联网，无需 token）')
  .option('--limit <n>', '结果数量上限（默认 20）')
  .action(
    run(async (query: string, opts: { limit?: string }) => {
      const skills = await searchDirectory(query, Number(opts.limit) || 20);
      if (!skills.length) {
        console.log(pc.dim('无结果'));
        return;
      }
      console.log(
        renderTable(
          ['Skill', '安装量', 'id'],
          skills.map((s) => [s.name, formatInstalls(s.installs), s.id]),
        ),
      );
      console.log(pc.dim(`安装：skillpot install-search <id>（例：${skills[0].id}）`));
    }),
  );

program
  .command('install-search <id>')
  .description('安装 skills.sh 目录中的 skill（id 形如 owner/repo/slug）')
  .option('-f, --for <targets>', `安装后开放给哪些目标（${FOR_HELP}）`)
  .action(
    run(async (id: string, opts: { for?: string }) => {
      const r = await installFromDirectory(id, {
        for: opts.for ? resolveAgentIds(opts.for) : undefined,
      });
      console.log(pc.green(`✔ 已安装 ${r.name}`));
      if (r.description) console.log(pc.dim(`  ${r.description.slice(0, 120)}`));
      for (const i of r.lint) {
        console.log(`  ${i.level === 'error' ? pc.red('error') : pc.yellow('warn ')} ${i.message}`);
      }
      if (r.enabled.length) console.log(pc.green(`已开放：${r.enabled.join(', ')}`));
      else
        console.log(
          pc.dim('默认未开放。skillpot enable <skill> --for <agents> 或在 GUI 矩阵打勾'),
        );
    }),
  );

const policyCmd = program.command('policy').description('企业与团队策略治理命令');

policyCmd
  .command('check')
  .description('检查当前本机环境与已装技能是否符合企业安全治理策略')
  .option('-p, --policy <path>', '指定策略文件路径')
  .option('--ci', 'CI 模式（存在策略违规时以非零退出码阻断）')
  .option('--json', '以 JSON 输出')
  .action(
    run((opts: { policy?: string; ci?: boolean; json?: boolean }) => {
      const loaded = loadPolicy(opts.policy);
      if (!loaded) {
        throw new Error('未找到策略文件；可使用 skillpot policy init 初始化一个，或通过 -p/--policy 指定');
      }
      const res = checkPolicy(loaded.policy, loaded.file);
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(pc.bold(`=== 策略合规检查：${loaded.policy.name || '安全基线'} ===`));
        console.log(`策略文件: ${res.file}`);
        console.log(
          `执行模式: ${res.policy.mode === 'audit' ? pc.yellow('audit (仅告警)') : pc.cyan('strict (强制阻断)')}`,
        );
        console.log(`基线规则: 强制 ${res.enforcedCount} 项 / 禁用 ${res.deniedCount} 项\n`);

        if (res.compliant) {
          console.log(pc.green('✔ 策略检查通过：所有合规基线与安全限制均已满足'));
        } else {
          for (const v of res.violations) {
            const tag = v.severity === 'error' ? pc.red('✗ [严重]') : pc.yellow('⚠ [告警]');
            console.log(`${tag} ${v.message} ${pc.dim(`(${v.rule})`)}`);
          }
          const errors = res.violations.filter((v) => v.severity === 'error').length;
          const warns = res.violations.filter((v) => v.severity === 'warn').length;
          console.log(pc.yellow(`\n发现 ${res.violations.length} 条策略违规（${errors} error / ${warns} warn）`));
          console.log(pc.dim('提示：运行 skillpot policy apply 可自动对齐强制基线并卸载违规技能'));
        }
      }

      if (opts.ci) {
        const errorCount = res.violations.filter((v) => v.severity === 'error').length;
        if (errorCount > 0 || (res.policy.mode === 'strict' && res.violations.length > 0)) {
          process.exitCode = 1;
        }
      }
    }),
  );

policyCmd
  .command('apply')
  .description('自动执行策略修复：安装强制技能、开启目标、撤下并卸载禁用技能')
  .option('-p, --policy <path>', '指定策略文件路径')
  .option('--dry-run', '仅预览将要执行的策略修复动作，不实际修改磁盘或配置')
  .option('-f, --force', '强制放行安装过程中的提示词阻断检查')
  .action(
    run(async (opts: { policy?: string; dryRun?: boolean; force?: boolean }) => {
      const loaded = loadPolicy(opts.policy);
      if (!loaded) {
        throw new Error('未找到策略文件；可使用 skillpot policy init 初始化一个，或通过 -p/--policy 指定');
      }
      console.log(pc.bold(`正在应用策略：${loaded.policy.name || '安全基线'} (${loaded.file})`));
      if (opts.dryRun) console.log(pc.yellow('【DRY-RUN 预览模式】不实际修改磁盘或配置\n'));

      const res = await applyPolicy(loaded.policy, loaded.file, {
        dryRun: opts.dryRun,
        force: opts.force,
      });

      if (!res.actions.length) {
        console.log(pc.green('✔ 当前环境已完全符合策略，无需变更'));
      } else {
        for (const a of res.actions) {
          const prefix =
            a.action === 'failed'
              ? pc.red('✗')
              : a.action === 'uninstalled' || a.action === 'disabled'
                ? pc.yellow('✔')
                : pc.green('✔');
          console.log(`${prefix} ${a.detail}`);
        }
      }

      if (res.violationsRemaining.length > 0) {
        console.log(pc.yellow(`\n仍存在 ${res.violationsRemaining.length} 条无法自动解决的违规项：`));
        for (const v of res.violationsRemaining) {
          console.log(`  - ${v.message}`);
        }
      } else {
        console.log(pc.green('\n✔ 策略修复完成，当前环境合规！'));
      }
    }),
  );

policyCmd
  .command('init')
  .description('在当前目录初始化策略文件模板（skillpot.policy.yaml）')
  .option('-f, --file <path>', '自定义输出路径', DEFAULT_POLICY_FILE)
  .action(
    run((opts: { file: string }) => {
      const target = path.resolve(process.cwd(), opts.file);
      if (fs.existsSync(target)) {
        throw new Error(`策略文件已存在：${target}`);
      }
      fs.writeFileSync(target, generatePolicyTemplate(), 'utf8');
      console.log(pc.green(`✔ 已生成策略文件模板：${target}`));
      console.log(pc.dim('编辑该文件后，运行 skillpot policy check 即可验证合规性'));
    }),
  );

program
  .command('registry')
  .description('查看当前生效的技能 Registry 终端、认证状态及企业私有配置')
  .option('-p, --policy <path>', '指定关联的策略文件')
  .option('--json', '以 JSON 输出')
  .action(
    run((opts: { policy?: string; json?: boolean }) => {
      const policyObj = loadPolicy(opts.policy)?.policy;
      const status = getRegistryStatus(policyObj);
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      console.log(pc.bold('=== Skill Registry 状态 ==='));
      console.log(`终端 URL:     ${pc.cyan(status.url)}${status.isPrivate ? pc.green(' (企业私有)') : pc.dim(' (公共目录)')}`);
      console.log(`认证 Token:   ${status.hasToken ? pc.green(`已配置 (${status.tokenSource})`) : pc.dim('未配置（匿名访问）')}`);
      console.log(`私有模式强制: ${status.forcePrivate ? pc.yellow('已开启 (force_private，禁止访问公共源)') : '未开启'}`);
    }),
  );

// 拒绝多余位置参数：把拼写/连接符错误（如 init $$ adopt、add / adopt）变成显式报错而非静默忽略
for (const cmd of program.commands) cmd.allowExcessArguments(false);

await program.parseAsync(process.argv);
