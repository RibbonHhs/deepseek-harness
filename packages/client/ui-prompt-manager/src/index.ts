/**
 * Host half of the prompt library plugin. Registers the `prompts` settings
 * namespace as a plugin entry so SettingsForms indexes it; the schema is
 * intentionally a permissive volatile root (the client half binds via
 * `ctx.settingsScope` and validates per-entry records on read). The activator
 * lives in `packages/mcp/prompt-manager-activator`; this package only owns
 * the schema shape and the persistence contract both sides agree on.
 */
import type { Context } from '@deepseek-ai/cordis'
// Side-effect: declaration-merges `ctx.settings` onto Context so the
// apply body can call SettingsForms methods under TS.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export { PROMPTS_NAMESPACE } from './namespace.ts'
export type { PromptRecord } from './schema.ts'

/** Plugin entry Config: a permissive object whose entire root is volatile. */
export const Config = z.dict(z.any()).default({}).volatile()

/** Cordis plugin name. */
export const name = 'ui-prompt-manager'

/** Inject settings so SettingsForms indexes this namespace. */
export const inject = ['settings']

/**
 * Mount the `prompts` namespace as a settings source of truth. The browser
 * half owns the editor UI; the host entry exists only so SettingsForms
 * indexes this namespace and the activator can read it.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
