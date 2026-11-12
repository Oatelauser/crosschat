# Ordinary CI failure follow-up

2026-11-12. Draft PR #11 at `64f74f680b45e59d40a19d132cc7b867ea2d92b4` triggered ordinary CI run [43048318000](https://github.com/Oatelauser/crosschat/actions/runs/43048318000). Windows and macOS jobs passed. Ubuntu job `130618199808` failed in `test/conversations.test.ts:212` while reading the expected per-pair JSON shard (`ENOENT`). This run is separate from OpenCode native `c22-cli` run `43048480770`.

The public GitHub check annotation is preserved in `ubuntu-annotations.json`. The original raw job log was unavailable in the signed-out browser; the annotation establishes the missing file but does not identify a failed lock or filesystem operation. No authentication, user configuration or native tool was changed for this investigation.

## Focused Linux check

Command, run under WSL Ubuntu 22.04 with existing Node 22.14.0:

```text
wsl.exe -d Ubuntu-22.04 --cd /mnt/d/workspace/CC/cc-opencode-native-20261111 -- env VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 npm test -- test/conversations.test.ts
```

Both matching test files passed: `conversations.test.ts` 26/26 and `status-conversations.test.ts` 20/20. Raw output is in `linux-conversations-focused.txt`. This focused result does not reproduce the hosted failure, and its Linux environment is not the hosted runner environment.

## Controlled symptom probe

```text
wsl.exe -d Ubuntu-22.04 --cd /mnt/d/workspace/CC/cc-opencode-native-20261111 -- node docs/development/evidence/opencode-c22-hosted-candidate-20261111/ordinary-ci-43048318000/state-lock-probe.mjs
```

The probe holds the existing `conversation-state` lock for an isolated fixture directory, then calls the same public `handleForRef` and `recordConversation` operations as the failed test. With the lock held, the optional handle is unavailable and the best-effort post-delivery record leaves the shard absent: reading it produces `ENOENT`. After releasing the lock, allocation returns `cA000`, recording updates the full ref and its handle, and the owned fixture is removed. `state-lock-probe-linux.json` records both outcomes.

This demonstrates a deterministic route to the observed symptom under deliberately injected contention. The original CI cause is still unconfirmed: no original lock acquisition failure or filesystem failure was captured. The public shared conversation implementation remains unchanged and retains its existing ownership. The evidence does not support raising timeouts, retrying native sends, weakening the assertion, or marking the original CI run green.

## C22 repair review

The local repair `3b96ce8` only changes the C22 helper's direct-entry guard, a visible-title prefix assertion, and its import regression test. Ordinary OpenCode smoke tests already imported the fixture/helper graph before this repair. The fixture module adds no top-level filesystem or network work, and the two conversation test files use their own temporary root. No causal link between C22 and the missing conversation shard has been established.

Next reviewable action is to decide whether to push the verified C22 repair to the existing draft PR and dispatch `c22-cli` again. A push also triggers ordinary CI; both ordinary Ubuntu and native C22 results must be assessed separately. PR merge, schedule changes and Desktop lifecycle runs are outside that action.
