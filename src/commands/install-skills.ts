/**
 * `crosschat install-skills`: copy the repo's skills/crosschat into
 * <root>/.claude/skills/crosschat, <root>/.codex/skills/crosschat and the
 * Harness skills/crosschat (default <root>/.dsh, honoring DSH_HOME) so each
 * agent family learns the protocol from a local skill (low-invasion: the
 * mechanism ships its own teaching, prompts stay role-only).
 */

export { defaultInstallSkillsDeps, runInstallSkills } from '../application/maintenance/skills.js';
export type { InstallSkillsArgs, InstallSkillsDeps } from '../application/maintenance/skills.js';
