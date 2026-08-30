/**
 * Browser half of the MCP server registry plugin. Registers:
 *
 *  - the `settings.section` row "MCP servers" — the CRUD surface;
 *
 * The store binds to the `mcp-servers` settings scope through
 * `settingsScope` so file-backed persistence is automatic. Pushed
 * invalidations refresh the in-memory view; the host-side
 * `@deepseek-ai/dsh-mcp-servers-activator` reads the same namespace and
 * instantiates a `mcp-client` plugin per enabled entry.
 *
 * Export discipline: packages/client/AGENTS.md. Only `apply`, `inject`,
 * `Config`, store factory, and shared types leave the package; the UI
 * components, dialog bodies, and store instance stay internal.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only imports pull the slot declarations into this program; runtime
// values for these packages live with the loader and reach this plugin
// through `ctx.*` services, so no value imports are needed.
//   - settings.section + ctx.settingsScope merge
//   - locale binding (`ctx.locale`)
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { McpServersStore } from './store.ts'
import type { McpServersStore as McpServersStoreType } from './store.ts'
import { MCP_SERVERS_NAMESPACE } from '../namespace.ts'
import { McpServersSection } from './McpServersSection.tsx'
import type { McpServersSectionInjected } from './McpServersSection.tsx'
import { en, zh, type McpServersKey } from './locales.ts'

export type { McpServerRecord, McpServersSection, McpServerStatus, McpServerState } from '../schema.ts'
export type { McpServersState, McpServerListItem } from './store.ts'
export type Translator = import('./translator.ts').Translator

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP servers section copy. */
    'mcp-servers': McpServersKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'mcp-servers'

/**
 * Required services. The target slot is declared by ui-settings; the
 * `ctx.slots.inject(...)` indirection waits on the declaration without
 * constraining apply order.
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Create one store per apply invocation. Module-level handles are
 * forbidden (`packages/client/AGENTS.md` rule 6) — the factory is the
 * only sanctioned path.
 * @param ctx - client root context.
 * @returns the bound store; the caller's fiber owns its lifecycle.
 */
export function createMcpServersStore(ctx: ClientContext): McpServersStoreType {
  const connection = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind({
    namespace: MCP_SERVERS_NAMESPACE,
    decode: (section) => {
      if (typeof section !== 'object' || section === null || Array.isArray(section)) return {}
      return section as Record<string, never>
    },
  })
  const controller = new McpServersStore(scope)
  // Load eagerly so the first render reads a ready state.
  void controller.load()
  ctx.effect(() => () => { void controller.dispose() }, 'ui-mcp-servers: store lifecycle')
  // Settings updates propagate through the describe mirror; the store
  // already subscribes internally, so no extra subscription is needed
  // here. Kept as a reference so future edits don't accidentally drop
  // the connection dependency that wires the API client.
  void connection
  return controller
}

/**
 * Browser plugin body. Registers the MCP servers section, sharing one
 * store and one locale binding across the page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Register the prompts dictionary once (idempotent).
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp-servers: dictionaries')

  const controller = createMcpServersStore(ctx)
  const t = ctx.locale.bind(NS) as McpServersSectionInjected['t']

  // Bind the entry into its target slot. The target is declared by
  // ui-settings; slots.inject waits on the declaration.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-servers',
    // Order 25 sits between ui-settings-plugins (15) and ui-prompt-manager
    // (30) so MCP stays grouped with the "advanced configuration" entries
    // and stays out of the everyday cluster at the top.
    order: 25,
    label: () => t('nav'),
    inject: (): McpServersSectionInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      t,
    }),
  }, McpServersSection))
}
