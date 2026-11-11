# C22 Retry 3: Interrupted After Offline Confirmation

This run is incomplete and is not an acceptance pass.

- Official OpenCode CLI `2.1.3` ran against the isolated fixture and loopback model stub. Two service-backed logical nodes and two operator TUI homes were created; this was same-host validation, not physical cross-machine validation.
- Both operator event logs show the authoritative renamed member and the unchanged second member. The TUI waited until the selected member's native rename action became enabled, opened the form, and recorded an enabled read-only preview.
- After node 0 stopped, submitting the held form recorded a fresh preview with `enabled: false` and reason `所选完整节点当前不在线或原生引用无效。` No `mutation-start` event was recorded. The blocked name was not written.
- The run did not produce a final report. It failed later in the reconnect/recovery path and entered cleanup while operator 0 remained in the form. The cleanup sent `q` and waited without a timeout, so the fixture owner could not finish cleanup itself.
- The operator event logs were copied from the owner-marked temporary root before stopping the stuck owner. Raw PTY logs remain alongside them. The owner process and its ConPTY hosts were then stopped by exact PID; the two owned OpenCode service PIDs and both TUI child PIDs were confirmed gone. Removal of the verified temporary profile root was blocked by automatic approval policy, so the root remains at `C:\Users\yangsheng\AppData\Local\Temp\crosschat-opencode-compat-HKFyJ2` for manual cleanup.

The recovery assertion remains open. The next run uses an enabled-action barrier, form-aware TUI cancellation, and bounded PTY exit cleanup so any further failure is reported and the fixture owner can continue cleanup.
