// 注意：shebang 由构建脚本的 --banner 注入（esbuild 会把源码 hashbang 排在 banner 之后，
// 而 ESM 产物要求 hashbang 必须在第一行，故源码不写 shebang）。
import path from 'node:path';
import * as readline from 'node:readline';
import { Command } from 'commander';
import pc from 'picocolors';

import { agentHome, skillDir, storeDir } from './paths';
import { AGENTS } from './agents/registry';
import { detectAll } from './agents/detect';
import { initStore, loadConfig, saveConfig } from './core/config';
import {
  installFromGit,
  installFromLocal,
  removeSkillDir,
  storeSkillNames,
} from './core/store';
import { disableSkill, enableSkill, resolveAgentIds, SyncResult } from './core/sync';
import { fixDoctor, runDoctor } from './core/doctor';
import { adoptSkills, AdoptStatus, scanAdoptable } from './core/adopt';
import { lintSkill, lintSummary } from './core/lint';
import { updateSkills } from './core/update';
import { startMcpServer } from './core/mcp-server';
import { startGuiServer } from './core/gui-server';
import { runTui } from './tui/index';
import { renderTable } from './util/table';
import { VERSION } from './version';

const program = new Command();

program
  .name('skillpot')
  .description('跨编程 Agent 的 Skill 管理器 —— 一处安装，按 Agent 开关，一处更新')
  .version(VERSION);

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

function printAgents(): void {
  const results = detectAll();
  const rows = results.map((r) => [
    r.name,
    r.installed ? pc.green('yes') : pc.dim('no'),
    r.version ?? '-',
    r.skillsDir.replace(agentHome(), '~'),
    r.installed ? r.verified : '',
  ]);
  console.log(renderTable(['Agent', 'Installed', 'Version', 'Skills目录', '依据'], rows));
  for (const r of results) {
    if (r.note) console.log(pc.dim(`· ${r.name}: ${r.note}`));
  }
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
  .action(
    run((source: string, opts: { name?: string }) => {
      initStore();
      const isGit =
        /^https?:\/\//.test(source) ||
        /^git@/.test(source) ||
        /^file:\/\//.test(source) ||
        /\.git$/.test(source);
      const res = isGit ? installFromGit(source, opts.name) : installFromLocal(source, opts.name);
      const config = loadConfig();
      config.skills[res.name] = {
        source: isGit ? `git:${source}` : `local:${path.resolve(source)}`,
        checksum: res.checksum,
        installed_at: new Date().toISOString(),
        expose: {},
      };
      saveConfig(config);
      console.log(pc.green(`✔ 已安装 ${res.name}`));
      if (res.description) console.log(pc.dim(`  ${res.description.slice(0, 120)}`));
      const issues = lintSkill(skillDir(res.name));
      if (issues.length) {
        for (const i of issues) {
          const tag = i.level === 'error' ? pc.red('error') : pc.yellow('warn ');
          console.log(`  ${tag} ${i.message}`);
        }
        console.log(pc.dim(`  lint: ${lintSummary(issues)}（skillpot lint ${res.name} 查看详情）`));
      }
      console.log(
        `默认未对任何 Agent 开放。执行 ${pc.cyan(
          `skillpot enable ${res.name} --for <agents>`,
        )}（agents: ${AGENTS.map((a) => a.id).join(',')} 或 all）`,
      );
    }),
  );

program
  .command('list')
  .description('列出中央仓库中的 skill及开放状态')
  .option('-a, --agent <id>', '只看某个 Agent 的可见列表')
  .action(
    run((opts: { agent?: string }) => {
      const config = loadConfig();
      const names = Object.keys(config.skills).sort();
      const untracked = storeSkillNames().filter((n) => !config.skills[n]);

      if (opts.agent) {
        const id = resolveAgentIds(opts.agent)[0];
        if (resolveAgentIds(opts.agent).length !== 1) {
          throw new Error('list --agent 只接受单个 agent id');
        }
        console.log(pc.bold(`${id} 可见的 skill（来自 SkillPot）：`));
        const rows = names
          .filter((n) => config.skills[n].expose[id])
          .map((n) => [n, config.skills[n].source]);
        console.log(rows.length ? renderTable(['Skill', 'Source'], rows) : pc.dim('  （无）'));
        return;
      }

      const rows = names.map((n) => {
        const e = config.skills[n];
        const exposed =
          Object.entries(e.expose)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(',') || '-';
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
  .description('对指定 Agent 开放 skill（在 Agent 的 skills目录建立 symlink）')
  .option('-f, --for <agents>', '逗号分隔 agent id，或 all', 'all')
  .action(
    run((skill: string, opts: { for: string }) => {
      reportSync(enableSkill(skill, resolveAgentIds(opts.for)), '开放');
    }),
  );

program
  .command('disable <skill>')
  .description('对指定 Agent 关闭 skill（移除 symlink）')
  .option('-f, --for <agents>', '逗号分隔 agent id，或 all', 'all')
  .action(
    run((skill: string, opts: { for: string }) => {
      reportSync(disableSkill(skill, resolveAgentIds(opts.for)), '关闭');
    }),
  );

function reportSync(res: SyncResult, verb: string): void {
  if (res.linked.length) {
    console.log(pc.green(`✔ ${res.skill} 已${verb}：${res.linked.join(', ')}`));
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
      const config = loadConfig();
      if (!config.skills[skill]) throw new Error(`config 中没有 skill '${skill}'`);
      disableSkill(skill, AGENTS.map((a) => a.id));
      removeSkillDir(skill);
      delete config.skills[skill];
      saveConfig(config);
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
  .option('-f, --for <agents>', '导入后开放给哪些 agent（逗号分隔或 all；默认不开放）')
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
    run((skill: string | undefined, opts: { check?: boolean }) => {
      const results = updateSkills(skill, { check: opts.check });
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
          results.map((r) => [r.skill, label[r.status] ?? r.status, r.detail ?? '']),
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
  .description('启动本地 Web 控制台（仅监听 127.0.0.1）：开关矩阵、体检与修复')
  .option('--port <port>', '指定监听端口（默认随机空闲端口）')
  .option('--no-open', '不自动打开浏览器，仅打印访问地址')
  .action(
    run(async (opts: { port?: string; open?: boolean }) => {
      const port = opts.port ? Number(opts.port) : undefined;
      if (opts.port && (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535)) {
        throw new Error(`非法端口：${opts.port}`);
      }
      const { url } = await startGuiServer({ port, open: opts.open });
      console.log(pc.bold(`✓ SkillPot GUI 已启动：${pc.cyan(url)}`));
      if (opts.open === false) console.log(pc.dim('（未自动打开浏览器，请手动访问上方地址）'));
      console.log(pc.dim('按 Ctrl+C 退出'));
    }),
  );

// 拒绝多余位置参数：把拼写/连接符错误（如 init $$ adopt、add / adopt）变成显式报错而非静默忽略
for (const cmd of program.commands) cmd.allowExcessArguments(false);

await program.parseAsync(process.argv);
