# OpenCode C17/C19 Native Validation

2026-11-11. This record tracks the OpenCode explicit TUI membership and native rename slice. The parent tasks remain open for hosted validation and the remaining platform matrix.

## Implemented behavior

- OpenCode sessions can be explicitly adopted through the shared TCP TUI using their full native reference. The operation rechecks the selected provider, endpoint type and exact native ID; sessions without verified delivery remain unavailable for adoption.
- Native rename is enabled only for the source-verified OpenCode V2 `2.1.3` shared endpoint. Before writing, the adapter checks service registration, PID, version and URL, then rereads the exact session ID, title and workspace. It sends one `PATCH` and relies on the shared operation flow for a read-only confirmation; an uncertain write is never replayed.
- Other OpenCode versions remain `needs-verification`. TUI membership is explicit; this work does not enable automatic window selection or resume tracking.

## Native evidence

- Windows OpenCode CLI `2.1.3`: seven smoke checks and four exact membership/rename operations passed. The report and PTY logs are in [Windows CLI evidence](evidence/opencode-native-enhancement-20261110/result.json).
- Windows OpenCode Desktop `2.1.3`: baseline and candidate each passed 12 checks, including native title refresh and membership routing. The [Desktop lifecycle report](evidence/opencode-native-enhancement-20261110/desktop-fixed-v213-acl-json-fix-20261110/summary.json) also records official uninstall and exact protocol-state restoration.
- WSL Ubuntu `22.04`, Node `22.14.0`, Python `3.10.12`, official Linux x64 CLI `2.1.3`: the seven smoke checks and four membership/rename operations passed against a loopback model stub. The [Linux retry report](evidence/opencode-native-linux-20261111-retry/result.json) records normal exit and fixture cleanup. The first [Linux failure report](evidence/opencode-native-linux-20261111/result.json) is retained; it timed out waiting for a second identical TUI toast after the clipboard event had already confirmed the full reference, and its fixture cleanup completed.
- The Linux binary was verified against the pinned `114345218` byte release with SHA-256 `f1561a5fa724b781d97e9bf86eb6aceb82b56ef91fa19c03a2cd7b24c36028ab`. No personal model key was used. The temporary `.crosschat` state existed only under the owned fixture HOME and was removed by its owner.
- The Linux PTY suite passes all eight cases, including detached descendant cleanup, event-channel disconnect, resize and partial writes. The driver keeps the existing macOS POSIX host separate from the Linux pidfd/subreaper host.

## Full-check verification

- Windows with Node `22.23.4`: `npm run check` exited 0. Lint, build and the runtime import graph passed (207 modules, 703 edges); Vitest passed 2940 tests and skipped 12 existing cases across 249 passing and 4 skipped files.
- WSL `npm run check` was attempted from the `/mnt/d` worktree but did not produce a final summary or exit status. The [partial output](evidence/opencode-native-linux-candidate-20261111/full-check-wsl-partial-output.txt) is retained; it contains parallel timeout failures. The isolated C14 same-tool collision test subsequently passed, as did the Linux PTY suite 8/8. This partial run is not counted as a full-check result.
- C21 added three public-operation regressions in `test/opencode-adapter.test.ts`: equal native references under different service registration IDs have different confirmation revisions; changing only the registration ID rejects the old revision while a fresh describe restores availability; and a committed PATCH followed by cancellation returns `uncertain`, with read-only recovery and no replay of the old confirmation. The existing production behavior passed these tests without source changes. The adapter suite passed 34/34.
- In the C21 Windows PowerShell worktree, Node `24.22.1` ran the complete Vitest suite with `--no-cache --maxWorkers=2 --minWorkers=1`: 249 files passed, 4 skipped; 2943 tests passed, 12 skipped. Lint, import graph and TypeScript build also passed. A temporary `node_modules` junction to the main worktree was removed afterward; the raw test output was retained in the tool session, not a file.
- A separate WSL Ubuntu `22.04` run with Node `22.14.0` completed lint, import graph (207 modules, 703 edges) and build, but Vitest failed 7 tests (2932 passed, 16 skipped). Failures included two pre-existing C14 broker assertions and unrelated process/TUI timeout or initialization assertions. A single-worker focused rerun still reproduced the C14 failures; its [raw output](evidence/opencode-c21-20261111/wsl-c14-focused.txt) is retained. This WSL result is not counted as a pass and did not lead to production changes.
- The ordinary check jobs on draft [PR #11](https://github.com/Oatelauser/crosschat/pull/11) run [42978270144](https://github.com/Oatelauser/crosschat/actions/runs/42978270144) completed successfully on Windows, Ubuntu and macOS. They are ordinary repository checks, not hosted OpenCode lifecycle tests.

The native runs used loopback TCP management on the same machine. They do not establish physical cross-machine connectivity, Linux Desktop behavior, hosted native CI, or support for other OpenCode versions and platforms.

## Documentation and hosted Desktop boundary

- The OpenCode CLI and Desktop guides now cover the verified `--tool opencode` recipient syntax, explicit TUI membership and recovery, and native rename availability only for the verified V2 `2.1.3` shared service. The crosschat stars reference records that v2.1.3 has no reliable window-level selection signal; C16 automatic following remains unimplemented.
- The C21 fixture regressions cover registration owner confirmation isolation, stale confirmation rejection after registration replacement, and uncertain write recovery without replay.
- Draft PR #11 remains unmerged. Ordinary Windows, Ubuntu and macOS checks passed in run `42978270144`; this does not establish Desktop lifecycle compatibility.
- PR #10 hosted run `42989178056` still failed Desktop lifecycle: process ownership inspection timed out after the v2.1.3 baseline launched, the packaged updater downloaded 2.2.7, and a new protocol registration could not be safely restored. The user chose to record this as blocked while preserving the strict guard. No additional hosted run was started; O06c remains open.
