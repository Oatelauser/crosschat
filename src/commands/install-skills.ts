/**
 * `crosschat install-skills`: copy the repo's skills/crosschat into
 * <root>/.claude/skills/crosschat and <root>/.codex/skills/crosschat so both
 * agent families learn the protocol from a local skill (low-invasion: the
 * mechanism ships its own teaching, prompts stay role-only).
 */

export { defaultInstallSkillsDeps, runInstallSkills } from '../application/maintenance/skills.js';
export type { InstallSkillsArgs, InstallSkillsDeps } from '../application/maintenance/skills.js';
