/**
 * Host half of the MCP server registry plugin. Mounts the `mcp-servers`
 * namespace as a real cordis plugin entry so `@deepseek-ai/dsh-settings`
 * (`SettingsForms`) discovers the Config schema and indexes the entry
 * with `ns = 'mcp-servers'`. The host-side activator
 * (`@deepseek-ai/dsh-mcp-servers-activator`) reads the section through
 * `ctx.settings.describe()` and writes status updates via
 * `ctx.settings.mutate()`; the browser half lives under `src/client/`
 * and binds the same namespace through `ctx.settingsScope`.
 *
 * The plugin entry's Config is intentionally a permissive volatile root:
 * the section is a free-form `{ id → record }` map owned by the wire
 * schema (`./schema.ts`), and every nested path is volatile by
 * inheritance. `isVolatilePath(schema, ['<id>', 'status'])` returns true
 * for every id; `volatileForm(schema)` returns the schema unchanged so
 * `SettingsForms.describe()` admits this entry.
 *
 * Schema types are re-exported so the host-side activator and the
 * browser store can `import type` them from the package root without
 * reaching into `src/`.
 *
 * @module @deepseek-ai/dsh-client-ui-mcp-servers
 */

import type { Context } from '@deepseek-ai/cordis'
// Side-effect: declaration-merges `ctx.settings` onto Context.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export { MCP_SERVERS_NAMESPACE } from './namespace.ts'

/** Re-export the wire schema types so the host-side activator and the
 * browser store can `import type` them through the package root. The
 * status type is included so the activator can write status updates
 * without re-defining its own status shape. */
export type {
  McpServerRecord, McpServersSection, McpServerStatus, McpServerState,
} from './schema.ts'

/** Plugin entry Config schema. The dict lets `SettingsForms` index
 * arbitrary user-supplied record ids, and `.volatile()` makes every
 * nested path editable live. The `.default({})` keeps the section
 * initial value a plain object so the activator's first `describe()`
 * returns a JSON-compatible map even before the user adds any records. */
export const Config = z.dict(z.any()).default({}).volatile()

/** Cordis plugin name. Loader diagnostics use this string; the
 * SettingsNamespace index key (`'mcp-servers'`) is set separately by
 * the bundle patch row id. The two are intentionally identical here so
 * a missing row id surfaces as a missing namespace instead of a silent
 * misroute. */
export const name = 'mcp-servers'

/** The activator depends on `ctx.settings` being mounted before this
 * entry applies (the `configure({ auto: false }, ctx.fiber)` call below
 * must run on a live SettingsForms instance). */
export const inject = ['settings']

/**
 * Mount the `mcp-servers` namespace as a settings source of truth.
 *
 * The host entry opts out of auto-generated settings pages: the editor
 * surface is registered by the browser half (the dedicated
 * `McpServersSection` slot in the web settings list). This entry exists
 * only so `SettingsForms` indexes the namespace and the activator can
 * observe it.
 *
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
