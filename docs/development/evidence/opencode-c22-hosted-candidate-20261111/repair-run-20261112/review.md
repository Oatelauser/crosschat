# OpenCode C22 hosted repair verification

2026-11-12 (Asia/Shanghai). The user explicitly approved pushing `3b96ce8` and `b94c17a` to existing draft PR #11 and dispatching `opencode-compat.yml` with `scope=c22-cli`. Those actions are complete. No merge, schedule change, Desktop run or production Issue write was performed.

## Hosted behavior results

Tested head: `b94c17a9c1193109a2d62ba2f77391960e35fee1`. [Native run 43134592145](https://github.com/Oatelauser/crosschat/actions/runs/43134592145) completed:

| Job | ID | Actual conclusion | Evidence |
| --- | --- | --- | --- |
| Ubuntu x64 probe | 130906761146 | success | Compatibility 2.1.3 and 2.2.7 each 8/8; C22 2.1.3 smoke 8/8 and multi-node 4/4 |
| Windows x64 probe | 130906761468 | success | Compatibility 2.1.3 and 2.2.7 each 8/8; C22 2.1.3 smoke 8/8 and multi-node 4/4 |
| Desktop | 130906762574 | skipped | Required by c22-cli scope |
| Issue report | 130907810526 | skipped | PR branch guard |

The two native artifacts independently establish exact node/provider/type/native-ID routing, star isolation and two real TUI observers. Each broker receipt fault has one fully correlated request, one accepted receipt, one dropped receipt and one native title PATCH. The result is `uncertain`; both operators see the authoritative result, and read-only recovery does not replay the write. Offline confirmation starts no mutation; recovery restores the action without submitting the held form.

Both operator exits are 0, with before/after raw mode, resize and listener state equal. Both fixtures and second profiles were removed, fault configurations restored, proxies closed and multi-node cleanup completed with no errors. Machine IDs are fixed fixture values. Native sessions, request IDs, stars and temporary roots differ across platforms. This is same-host logical-node evidence, not physical cross-machine acceptance. C22 2.2.7, macOS and Desktop are outside this result.

[Ordinary run 43134505721](https://github.com/Oatelauser/crosschat/actions/runs/43134505721) passed all actual jobs at the same head:

| Platform | Job | Tests passed / skipped | Files passed / skipped |
| --- | --- | --- | --- |
| Windows | 130906461519 | 2946 / 12 | 250 / 4 |
| Ubuntu | 130906461314 | 2942 / 16 | 251 / 3 |
| macOS | 130906461085 | 2941 / 17 | 250 / 4 |

Lint, build and the runtime import graph passed (207 modules, 703 edges). macOS retains its existing continue-on-error setting; its actual job conclusion was success.

## Artifact and cleanup verification

| Artifact | ID | ZIP bytes | SHA-256 |
| --- | --- | ---: | --- |
| opencode-compat-ubuntu-latest | 13907111901 | 74303 | a8cf9161f066b3da7bc0e1c09c4f4307f008f6ee04135f426b7b42f7cbf73141 |
| opencode-compat-windows-latest | 13906871846 | 59136 | 3e86da9f7cc9f1baadc6b32d53b15164dcc3f6469850ddc1a8c7dac215deb410 |

Both ZIP byte sizes and digests matched API metadata. Each archive has 17 files; all 34 extracted evidence copies matched their source SHA-256. Five job logs, dispatch response, completed run/job status and artifact metadata are preserved beside this review. No signed download URL or credential is retained. Raw terminal/job logs retain original trailing spaces and blank lines; whitespace checks for authored documents are kept separate, without rewriting the raw evidence.

Automatic approval rejected removal of the local archive verification directory `C:\Users\YANGSH~1\AppData\Local\Temp\crosschat-c22-hosted-verify-KhVvTO` with `blocked by policy`. No alternative deletion was attempted. The user subsequently reported manual deletion; a read-only `Test-Path` returned false. This cleanup gap is closed. Native runner fixture cleanup had already completed independently.

## Review and fixture isolation follow-up

The independent hosted acceptance audit found no behavioral blocker. Subsequent Standards/Spec review of `cd47544997fe563b65ff3a12ea28e04ed2913dcf...b94c17a` found one isolation omission: the single-node `opencode-native-enhancement.mjs` fixture did not set `listenHost`, so its Broker inherited the production `0.0.0.0` default. The C22 multi-node Broker already bound `127.0.0.1`. The earlier green run therefore proves the recorded behaviors but does not establish that every fixture listener complied with the approved loopback boundary.

- RED checkpoint `19ee5eb`: a child process starts the actual enhancement fixture Broker, reads its listener address, then deliberately stops before creating a native node. [RED output](loopback-red.txt) reports expected `127.0.0.1`, received `0.0.0.0`. Helper `finally` closes the Broker and the temporary root is removed; no OpenCode executable runs.
- GREEN checkpoint `cd4963e`: the fixture now explicitly passes `listenHost: '127.0.0.1'`. [Four targeted tests](loopback-green.txt) pass, including the real listener assertion and existing Broker bind test. No production default, user configuration, workflow or schedule changed.
- Standards re-review: zero unresolved documented-standard violations or actionable smell findings after this fix.
- Spec re-review: the loopback omission is fixed locally; zero other missing, incorrect or expanded requirements found within the approved slice.
- The complete local check for `cd4963e` is recorded in [full-check raw](loopback-full-check.txt); its final result is indexed in the parent [validation record](../validation.json).

The new listener fix has not been pushed or run on hosted runners. Complete loopback-conforming hosted qualification remains pending a concrete push/rerun decision. Earlier green CI must not be attributed to this newer head. The parent tasks remain open. Final read-only GitHub/remote-ref verification confirmed PR #11 is open/draft/unmerged, its head is still `b94c17a`, and main is `cd47544997fe563b65ff3a12ea28e04ed2913dcf`.

## Historical failures retained

The initial native run `43048480770` failed before the multi-node sequence; its compatibility probes passed and fixtures were cleaned. Its raw logs remain unchanged. The repaired direct-module entry guard and full-value/visible-prefix assertions are in `3b96ce8`.

The earlier ordinary Ubuntu run `43048318000` failed reading an isolated conversation shard. A controlled contention probe reproduced a possible route and focused Linux tests passed, but the original root cause remains unconfirmed. The shared conversation implementation was not changed. One local full-check evidence-capture repeat also had a Windows Node inspector child exit `0xC0000005`; its focused 19-test recheck passed without establishing the cause. Later green results do not erase either observation.
