# Working agreements

- Before continuing the core refactor, read `docs/development/core-refactor-progress.md` for scope, ownership, validation and next actions.
- Before TUI work, read `docs/development/tui-progress.md` for the current task, shared contracts, ownership and validation.
- When changing code, follow `docs/development/code-standards.md`; use the repository's npm/Vitest commands and isolated fixtures.
- Core refactoring and the TUI have passed isolated development acceptance. The subsequent real SSH/TCP remote validation is paused at the user's explicit request: read `docs/development/tui-remote-validation-checkpoint-20261022.md` before resuming, and wait for the user to resume it. Temporary services/tunnels are stopped; evidence is retained. Never install Codex on the remote Linux host.
- Keep normal development without time pressure; changes to existing functionality require prior agreement. Preserve specifications, approval decisions and validation evidence; remove accepted tasks and their active references.
