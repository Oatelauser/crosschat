# OpenCode Rename Capability Research

2026-11-09. Source-only review of official OpenCode CLI v2.1.3, tag commit [`bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`](https://github.com/anomalyco/opencode/tree/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1). No OpenCode process was run; no repository product, configuration, or workflow files were changed.

## Finding

The source-level C19 capability gate passes. OpenCode exposes title mutation through its public HTTP protocol and generated SDK, and the source has a live title-update path in both the CLI TUI and Desktop when their event streams are connected.

`PATCH /api/session/:sessionID` accepts `title`; the endpoint is location-scoped and returns no content. The official `@opencode/client` package exports its generated clients, including `session.update`. The server handler maps a non-empty title to `session.rename`, which publishes durable `session.renamed` with the session ID and title. An empty title invokes title generation instead of setting an explicit title.

Sources: [public protocol](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/protocol/src/groups/session.ts#L298), [location scope and no-content response](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/protocol/src/groups/session.ts#L308), [public client exports](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/client/package.json#L18), [generated SDK method](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/client/src/effect/generated/client.ts#L494), [server handler](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/server/src/handlers/session.ts#L226), [core rename operation](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/core/src/session/session.ts#L71), [rename event schema](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/schema/src/session-event.ts#L102).

Both frontends consume the shared client data layer. On `session.renamed`, it syncs session details and applies the event title to the live store. The CLI TUI wires its event stream into `createData` and renders the store's title; Desktop creates the same data layer from its server SDK and renders that title in its session view.

Sources: [event reducer](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/client/src/solid/data.ts#L730), [TUI data wiring](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/tui/src/context/data.tsx#L15), [TUI title render](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/tui/src/component/session-tabs.tsx#L1583), [Desktop data wiring](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/app/src/runtime/server/runtime.tsx#L174), [Desktop title render](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/app/src/session/timeline/controller.tsx#L282).

The event contract is volatile: events missed while disconnected are not replayed. The source establishes the connected update path, not actual behavior against a running owner/version or correct crosschat node/star targeting. See the [stream contract](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/protocol/src/groups/event.ts#L51).

## C19 Disposition

The update route is wrapped in `sessionLocationMiddleware`, so correct location context is part of the live node-targeting check: [protocol middleware](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/protocol/src/groups/session.ts#L311).

Implementation can proceed within the already-approved C19 scope; the pinned source gives no reason for another user decision. Live verification remains required before declaring rename supported: send a non-empty title through the intended node, re-read it with [`session.get`](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/protocol/src/groups/session.ts#L223) after the no-content update, verify the intended star/session addressing, and confirm an already-open CLI TUI and Desktop view both refresh. Retain the disconnected-stream limitation in the resulting capability contract.
