/**
 * Host half of the MCP server registry plugin. The host process is the
 * source of truth for the `mcp-servers` settings namespace: it registers
 * the schema on `ctx.settings` so the file-backed settings provider
 * persists CRUD writes to `settings.yaml`. Browser-side, the client half
 * binds the namespace through `ctx.settingsScope` and exposes a React
 * store on top; the host-side `@deepseek-ai/dsh-mcp-servers-activator`
 * reads the same namespace and instantiates a `mcp-client` plugin per
 * enabled entry.
 *
 * The plugin is intentionally registration-only: the editor UI and
 * activator reconciliation all live elsewhere — this package owns the
 * schema shape and the persistence contract both sides agree on.
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Side-effect: declaration-merges `ctx.settings` onto Context so the
// `apply` body can call `ctx.settings.register` under TS.
import type {} from '@deepseek-ai/dsh-settings'
import { McpServersSectionSchema } from './schema.ts'
// Schema types re-exported below for activator / client consumption.

// The namespace is defined in `./namespace.ts` (so the client bundle
// can pull the value without dragging `@deepseek-ai/dsh-settings` into
// the browser). Host-side we additionally expose the branded
// SettingsNamespace for `ctx.settings.register`.
const _BRANDED = settingsNamespace('mcp-servers')
export { MCP_SERVERS_NAMESPACE } from './namespace.ts'

/** Cordis plugin name. */
export const name = 'ui-mcp-servers'

/** Plugin has no hard service dependency — `ctx.settings` is the injection point. */
export const inject = ['settings']

// Re-export the wire schema types so the host-side activator
// (`@deepseek-ai/dsh-mcp-servers-activator`) can `import type` them
// through the package root without having to reach into `src/`. The
// status type is included so the activator can write status updates
// without taking on its own schema definitions.
export type {
  McpServerRecord, McpServersSection, McpServerStatus, McpServerState,
} from './schema.ts'

// Reference the branded value so the unused-binding lint doesn't fire.
void _BRANDED

/**
 * Register the `mcp-servers` settings namespace. The base layer's
 * settings provider (typically `dsh-settings-file`) persists every
 * write to `settings.yaml`; absent a provider, the schema is still
 * registered and reads return an empty section.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  // The schema accepts any object; per-entry records are validated on
  // read by the schemastery coercion. The activator picks up changes
  // through `ctx.settings.subscribe(MCP_SERVERS_NAMESPACE, ...)`.
  ctx.settings.register(_BRANDED, McpServersSectionSchema as never)
}
