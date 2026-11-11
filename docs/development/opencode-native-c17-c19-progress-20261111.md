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
- The approved ordinary three-platform PR checks remain pending; this local evidence does not represent hosted CI.

The native runs used loopback TCP management on the same machine. They do not establish physical cross-machine connectivity, Linux Desktop behavior, hosted native CI, or support for other OpenCode versions and platforms.
