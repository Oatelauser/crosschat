## Summary

OpenCode 2.1.3 sessions support explicit TUI membership and native rename through the shared operation flow. Confirmations recheck the exact service registration, version and native target; uncertain writes recover through reads without replay.

```text
TUI selected session
  → exact provider / endpoint / native ID confirmation
  → shared node operation
  → OpenCode public PATCH → native reread → node / star refresh
```

Adds Linux PTY lifecycle coverage and a manual Windows/Linux CLI C22 probe with two logical nodes and two real TUI observers. Automatic window following remains deferred; Desktop lifecycle remains separately blocked.

## Evidence

- **Before:** C22 run 43048480770 failed before the multi-node sequence because an imported helper consumed its parent's TUI-child argument. Full raw logs and cleanup results are retained.
  **After:** At `b94c17a`, [43134592145](https://github.com/Oatelauser/crosschat/actions/runs/43134592145) passed Windows/Linux CLI 2.1.3 C22 smoke 8/8 and multi-node 4/4 per platform. Compatibility baseline 2.1.3/candidate 2.2.7 each passed 8/8. Desktop/Issue jobs were skipped. [43134505721](https://github.com/Oatelauser/crosschat/actions/runs/43134505721) passed all three actual ordinary CI jobs.
- **Before:** Review regression `19ee5eb` observed the enhancement fixture listening on `0.0.0.0`.
  **After:** `cd4963e` binds it to `127.0.0.1`; four targeted tests pass. This local follow-up is not yet pushed or hosted-verified. Its complete local check is indexed in `docs/development/evidence/opencode-c22-hosted-candidate-20261111/validation.json`.
- One dropped broker receipt produces `uncertain`, one native PATCH and read-only recovery; both operators observe the result. Offline confirmation starts no write and recovery does not submit the held form. Owned resources and terminal state are restored.
- Prior Ubuntu conversation-shard and local Windows inspector failures remain documented with unconfirmed original causes. No claim covers physical cross-machine transport, macOS native C22, Desktop hosted lifecycle or 2.2.7 C22.

## Merge Danger

**Door:** two-way

No persistent schema migration. Product changes affect OpenCode native-operation availability and exact title updates; shared Broker behavior preserves its production bind default.

**Blast Radius:** OpenCode

This is a local description candidate. PR #11 remains draft and unmerged. Complete hosted qualification of the loopback fixture repair is still pending; no merge is proposed on the strength of the earlier head's green results.
