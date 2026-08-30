/**
 * Browser half of the prompt library plugin. Registers:
 *
 *  - the `settings.section` row "Prompts" — the CRUD surface;
 *  - the `conversation.input.right` row — the composer accessory that
 *    opens the picker popover and writes the chosen prompt into the draft.
 *
 * The store binds to the `prompts` settings scope through `settingsScope`
 * so file-backed persistence is automatic. Pushed invalidations refresh the
 * in-memory view: an admin editing prompts in the Settings tab while a
 * composer accessory is mounted sees no drift.
 *
 * Settings-section copy lives in `locales.ts`; the composer accessory shares
 * the same `prompts` namespace so a locale switch keeps the picker and the
 * manager in sync.
 *
 * Export discipline: packages/client/AGENTS.md. Only `apply`, `inject`,
 * `Config`, store factory, and shared types leave the package; the UI
 * components, dialog bodies, and store instance stay internal.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only imports pull the slot declarations into this program; runtime
// values for these packages live with the loader and reach this plugin through
// `ctx.*` services, so no value imports are needed.
//   - settings.section + ctx.settingsScope merge
//   - conversation.input.right + InputActions standard kit
//   - locale binding (`ctx.locale`)
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PromptsStore } from './store.ts'
import type { PromptsStore as PromptsStoreType } from './store.ts'
import { PROMPTS_NAMESPACE } from '../namespace.ts'
import { PromptsSection } from './PromptsSection.tsx'
import type { PromptsSectionInjected } from './PromptsSection.tsx'
import { PromptInsertButton } from './PromptInsertButton.tsx'
import type { PromptInsertButtonInjected } from './PromptInsertButton.tsx'
import { en, zh, type PromptsKey } from './locales.ts'

export type { PromptsStore as PromptsStore } from './store.ts'
export type { PromptsState, PromptListItem } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Prompts section + composer accessory copy. */
    'prompts': PromptsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'prompts'

/**
 * Required services. The target slots are declared by ui-settings and
 * ui-conversation; both use `ctx.slots.inject(...)` to wait on the
 * declaration so apply-order between features is unconstrained.
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Create one PromptsStore per apply invocation. Module-level handles are
 * forbidden (`packages/client/AGENTS.md` rule 6) — the factory is the only
 * sanctioned path.
 * @param ctx - client root context.
 * @returns the bound store; the caller's fiber owns its lifecycle.
 */
export function createPromptsStore(ctx: ClientContext): PromptsStoreType {
  const connection = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind({
    namespace: PROMPTS_NAMESPACE,
    decode: (section) => {
      if (typeof section !== 'object' || section === null || Array.isArray(section)) return {}
      return section as Record<string, never>
    },
  })
  const controller = new PromptsStore(scope)
  // Load eagerly so the first render reads a ready state.
  void controller.load()
  ctx.effect(() => () => { void controller.dispose() }, 'ui-prompt-manager: store lifecycle')
  // Settings updates propagate through the describe mirror; the store already
  // subscribes internally, so no extra subscription is needed here.
  void connection
  return controller
}

/**
 * Browser plugin body. Registers the Prompts section and the composer
 * accessory, sharing one store and one locale binding across both surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Register the prompts dictionary once (idempotent).
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-prompt-manager: dictionaries')

  const controller = createPromptsStore(ctx)
  const t = ctx.locale.bind(NS) as
    PromptsSectionInjected['t'] & PromptInsertButtonInjected['t']

  // Bind each entry into its target slot. Both targets are declared by other
  // packages; the slots.inject indirection waits on the declaration without
  // constraining apply order.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'prompts',
    order: 30,
    label: () => t('nav'),
    inject: (): PromptsSectionInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      t,
    }),
  }, PromptsSection))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'prompts',
    order: 20,
    inject: (): PromptInsertButtonInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      // InputActions arrives through the SessionStandardProps merge on the
      // session-scope slot standard kit. Pass it through to the accessory via
      // the renderer-bound standard props; the inject face carries the
      // controller while the standard kit supplies inputActions.
      t,
    }),
  }, PromptInsertButton))
}
