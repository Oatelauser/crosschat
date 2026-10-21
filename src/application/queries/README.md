# Read-only application queries

`queryStars({ tcpDir, readRoster?, signal?, now?, readText? })` composes the sanitized
metadata from `queryBroker` with an optional authoritative roster reader. It does
not perform network reads by default, repair configuration, or write static online
state. It reads configured stars sequentially; each failure has its own star source
and leaves other stars available. The sampling time belongs to the whole result.

Context adapters supply `readRoster(star, signal)` and own connection timeouts and
resource disposal on cancellation. An adapter can bind the existing roster
transport to the selected star; this module does not import that transport or add
remote discovery or wire capabilities. Cancelled queries discard all late data.

Missing roster capability yields `health: unknown`, `onlineNodes: null` and partial
completeness. Unreachable or malformed sources yield `health: unavailable`; an
authoritative empty roster is reachable with zero online machines. Old payloads
without `sessions` retain their machine data and an explicit partial-result issue.
Native session IDs, short machine IDs, names and unknown tool strings retain their
original values. Credential values and unrelated payload fields are excluded.
