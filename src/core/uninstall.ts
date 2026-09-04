import { AGENTS } from '../agents/registry';
import { loadConfig, saveConfig } from './config';
import { disableSkill } from './sync';
import { removeSkillDir } from './store';

/**
 * 卸载：撤下所有 Agent 的受管链接（只动台账内）、删除中央仓库内容、注销 config。
 * CLI remove 与 GUI 卸载按钮共用。
 */
export function uninstallSkill(name: string): void {
  const config = loadConfig();
  if (!config.skills[name]) throw new Error(`config 中没有 skill '${name}'`);
  disableSkill(name, AGENTS.map((a) => a.id));
  removeSkillDir(name);
  delete config.skills[name];
  saveConfig(config);
}
