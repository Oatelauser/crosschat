# Working agreements

- Before continuing the core refactor, read `docs/development/core-refactor-progress.md` for scope, ownership, validation and next actions.
- Before TUI work, read `docs/development/tui-progress.md` for the current task, shared contracts, ownership and validation.
- When changing code, follow `docs/development/code-standards.md`; use the repository's npm/Vitest commands and isolated fixtures.
- Core refactoring and the TUI have passed isolated development acceptance. The authorized real SSH/TCP remote checks have also passed; read `docs/development/tui-remote-validation-20261023.md` for tested scope, environment limits and the local temporary-credential cleanup blocked by automatic approval. Remote fixtures and tunnels are removed; evidence is retained. Never install Codex on the remote Linux host.
- Keep normal development without time pressure; changes to existing functionality require prior agreement. Preserve specifications, approval decisions and validation evidence; remove accepted tasks and their active references.
