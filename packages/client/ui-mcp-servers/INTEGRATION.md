# Integration Steps

This document explains how to drop the `ui-mcp-servers` package into
the dsh web monorepo. The package is split into two halves (a
`settings.section` UI plus a host-side `mcp-servers-activator` plugin
that bridges into `@deepseek-ai/dsh-mcp-client`); both halves plus the
schema type are wired together at three touchpoints. The steps mirror
`packages/client/ui-prompt-manager` and add the extra twist of an
activator bundle patch.

## 1. Copy the packages

Two new packages land:

```
<monorepo>/packages/client/ui-mcp-servers/        # client UI half
<monorepo>/packages/mcp/mcp-servers-activator/  # host activator
```

Each follows the `@deepseek-ai/dsh-client-*` (UI) and
`@deepseek-ai/dsh-*` (host) naming conventions respectively; both
have the package-name convention enforced by the client/host
linters.

The package metadata — name, dependencies, peerDependencies,
`dsh.client` / no `dsh.host` declarations, bundle patch row ids —
must match exactly across both packages; the activator depends on the
client package's wire schema via a workspace import.

## 2. Verify tsconfig references

**No aggregate config to touch** — `pnpm-workspace.yaml`'s
`packages/*/*` glob already picks up both new directories;
`pnpm install` wires the workspace links.

`packages/client/ui-mcp-servers/tsconfig.json` already declares every
upstream workspace dependency it pulls in. The activator's
`tsconfig.json` references `../client/ui-mcp-servers` (for the schema
type), `../../settings/settings` (for `settingsNamespace`),
`../../../vendor/cordis` (for `Context`), `../../core/tools` (for the
`tools` inject hint), and `../../runtime-diagnostics/invariants`.

## 3. Register in the client and host aggregates

The client UI is referenced by the browser-side `tsc -b`; the
activator by the host-side one. Either is missing from the aggregate
and the package silently fails to compile — `tsdown` then fails with
`UNRESOLVED_ENTRY Cannot resolve entry module lib/types/...`.

In `tsconfig.client.json` `references` (alphabetical, between
`ui-layout` and `ui-sidebar`):

```jsonc
{ "path": "./packages/client/ui-mcp-servers" },
```

In `tsconfig.host.json` `references` (near `mcp-client`):

```jsonc
{ "path": "./packages/mcp/mcp-servers-activator" },
```

## 4. Patch the bundles

The client UI goes into the browser roster of
`packages/bundle/web-app/cordis.patch.yml`:

```yaml
- id: ui-mcp-servers
  name: '@deepseek-ai/dsh-client-ui-mcp-servers'
```

The host activator goes into the host roster of
`packages/bundle/base/cordis.patch.yml`, in the section after `tools`:

```yaml
# Activator for the `mcp-servers` settings namespace owned by the
# browser Settings → MCP servers page (`@deepseek-ai/dsh-client-ui-mcp-servers`).
# Reads the section on startup and on every `settings/updated` emission;
# for each enabled entry, spawns a `@deepseek-ai/dsh-mcp-client` plugin
# in a child cordis context. Adding/removing/toggling/editing a
# server in the UI propagates live to the running mcp-client instances.
- id: mcp-servers-activator
  name: '@deepseek-ai/dsh-mcp-servers-activator'
```

## 5. Bundle dependencies

In `packages/bundle/web-app/package.json` `dependencies`:

```jsonc
{
  "dependencies": {
    // ... existing entries ...
    "@deepseek-ai/dsh-client-ui-mcp-servers": "workspace:^"
  }
}
```

In `packages/bundle/base/package.json` `dependencies`:

```jsonc
{
  "dependencies": {
    // ... existing entries ...
    "@deepseek-ai/dsh-mcp-servers-activator": "workspace:^"
  }
}
```

## 6. Optional: profile-level override

To disable the plugin in a profile overlay
(`packages/bundle/<profile>/cordis.patch.yml`):

```yaml
- id: ui-mcp-servers
  disabled: true
- id: mcp-servers-activator
  disabled: true
```

## 7. Build and verify

The `bundle` script only runs `tsdown`, which doesn't invoke `tsc -b`.
But `tsdown.config.ts` enters through `lib/types/index.js` and
`lib/types/invariant.js` — tsc outputs. So compile must come first:

```sh
# Compile client + activator (and every other referenced workspace package).
pnpm exec tsc -b tsconfig.client.json
pnpm exec tsc -b tsconfig.host.json

# Then bundle each.
pnpm --filter @deepseek-ai/dsh-client-ui-mcp-servers bundle
pnpm --filter @deepseek-ai/dsh-mcp-servers-activator bundle

# Or one-shot:
pnpm run build:lib:client
pnpm run build:lib:host
```

## 8. Smoke test

1. Start `dsh web`.
2. Open Settings → MCP servers → click "New MCP server" → fill id
   (e.g. `github`, kebab-case), display name, transport `streamable-http`,
   URL `https://api.githubcopilot.com/mcp/`, and `Authorization:
   Bearer <PAT>` header. Save.
3. Open a new session. Ask the agent "list my GitHub repos" — the
   `mcp__github__*` tool calls should appear in Network tab.
4. Click the green "Connected" badge on the row — the status block is
   `pending → connected` on successful apply, `failed` with the
   error message on a connection error.
5. Disable the row. The badge flips to "Disabled" and the activator
   tears the fiber down on the next reconcile.
6. Quit `dsh web`. Inspect `~/.dsh/settings.yaml` — `mcp-servers:` block
   contains the entries with their `status` field.

## Package internals

- `packages/client/ui-mcp-servers/src/schema.ts` owns the wire schema
  (`McpServerRecord`, `McpServerStatus`) and is imported as a type by
  the activator. The schema's `McpServerStatus` block is written by
  the activator; the UI reads but never writes it.
- `packages/client/ui-mcp-servers/src/index.ts` (host half) registers
  the `mcp-servers` settings namespace on `ctx.settings`. Browser
  side, `src/client/store.ts` provides a `McpServersStore` (CRUD over
  the bound scope) that the section consumes.
- `packages/client/ui-mcp-servers/src/client/McpServersSection.tsx`
  renders the settings page (lists records, toggles enabled, edits,
  deletes).
- `packages/client/ui-mcp-servers/src/client/McpServerEditor.tsx` is
  the create/update modal (id, name, transport, command/url/headers,
  enabled, description).
- `packages/client/ui-mcp-servers/src/client/McpServerRow.tsx` is the
  list-row UI: transport badge, summary line, status pill,
  enable/disable, edit, delete buttons.
- `packages/mcp/mcp-servers-activator/src/index.ts` is the host
  activator: subscribes to `settings/updated`, spawns
  `@deepseek-ai/dsh-mcp-client` instances for each enabled entry,
  writes back `status` on every lifecycle transition.

## Known implementation trade-offs (revisit after deployment)

1. **`fiber.await()` failure semantics**: cordis catches apply errors
   internally and stores them on `fiber._error`; `fiber.await()`
   then THROWS rather than rejecting the Thenable. The activator's
   `fiber.then(onFulfilled, onRejected)` therefore receives errors
   in the `onRejected` slot, not `onFulfilled`. The activator also
   branches on `fiber._error` in `onFulfilled` as defense in depth.
2. **`recordsEqual` strips `status`**: a config edit on a server
   (e.g. change `command`) triggers a respawn (recordsEqual differs
   once status is stripped). A status-only write (activator's own
   feedback) does not (recordsEqual equal after stripping). This
   breaks the loop-prevention cycle that would otherwise arise from
   the activator writing its own writes back.
3. **`ctx.settings.update` JSON round-trip workaround**: dsh-settings
   freezes the resolved value (`deepFreeze`) so reads remain immutable
   between user edits and component renders. Schemastery iterates
   `ownKeys` when validating, so frozen metadata leaks into the schema
   check and fails the union with an "expected ... but got ..." error.
   `JSON.parse(JSON.stringify(config))` strips the metadata while
   keeping the wire data intact. Until schemastery supports a
   "frozen-input skip" mode (or dsh-settings serves a non-frozen value
   to read-only consumers), this round-trip is the only path that keeps
   both invariants alive.
4. **Status persistence trade-off**: `status` lives in the settings
   doc and is persisted to disk. A user sees "connected at 14:02" on
   next boot until the activator re-establishes the connection on the
   new boot. We accept this as the simpler alternative to an in-memory
   transport for ephemeral state.
5. **Failed respawn loop**: a server that consistently fails to
   connect is respawned on every reconcile. The `status` field flips
   between `failed` and `pending` with the `error` text from the most
   recent attempt preserved across the loop. We consider this a
   reasonable default — a transient failure becomes persistent in the
   next attempt automatically without manual intervention.

