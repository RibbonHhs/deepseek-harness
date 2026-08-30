/**
 * Host half of the prompt library plugin. The host process is the source of
 * truth for the `prompts` settings namespace: it registers the schema on
 * `ctx.settings` so the file-backed settings provider persists CRUD writes
 * to `settings.yaml`. Browser-side, the client half binds the namespace
 * through `ctx.settingsScope` and exposes a React store on top.
 *
 * The plugin is intentionally registration-only: the manager's CRUD, search,
 * interpolation, and composer insertion all live in the client half, which
 * already has the canonical sources (settingsScope, schema ops, locale).
 */

export { PROMPTS_NAMESPACE } from './namespace.ts'

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Side-effect: declaration-merges `ctx.settings` onto Context so the
// `apply` body can call `ctx.settings.register` under TS.
import type {} from '@deepseek-ai/dsh-settings'
import { PromptSection } from './schema.ts'

/** Cordis plugin name. */
export const name = 'ui-prompt-manager'

/** Plugin has no hard service dependency — `ctx.settings` is the injection point. */
export const inject = ['settings']

/**
 * Register the `prompts` settings namespace. The base layer's settings
 * provider (typically `dsh-settings-file`) persists every write to
 * `settings.yaml`; absent a provider, the schema is still registered and
 * reads return an empty section.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  // The schema accepts any object; per-entry records are validated on read.
  // Prompts are keyed by stable id, so the section root is a plain object.
  ctx.settings.register(settingsNamespace('prompts'), PromptSection as never)
}
