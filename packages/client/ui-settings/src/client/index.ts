/** Shared configuration forms and their Host describe mirror. */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the ctx.remote merge, the fixed Host facts, and the carrier's
// `connection/reset` lifecycle event, all through the assembly package.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only pair supplying `$on` and its key face without dragging a build
// artifact into the Host graph (rationale beside the same pair in
// config-form.ts).
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import { SettingsSchemaService } from './schema.ts'
import { ConfigForms } from './config-form.ts'
import { SettingsDescribeMirror } from './settings-mirror.ts'
import { SettingsScopeService } from './settings-scope.ts'

export type {
  SettingsLauncherOwnerProps, SettingsGeneralItemOwnerProps, SettingsHeaderOwnerProps, SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps, SettingsSectionOwnerProps, SettingsTriggerOwnerProps,
} from './contract/slots.ts'
export type { ConfigForms } from './config-form.ts'
export type { ConfigForm, ConfigFormSnapshot } from './config-form-types.ts'
export type { SettingsSchemaService } from './schema.ts'
export type { SchemaNode } from './schema.ts'
export type {
  SettingsDescribeFace, SettingsDescribeView, SettingsMirrorSnapshot,
} from './settings-mirror.ts'
export type {
  SettingsScope, SettingsScopeService, SettingsScopeSnapshot, SettingsScopeSpec, SettingsScopeStatus,
} from './settings-scope.ts'

/**
 * Required services: the Remote namespace the mirror reads through and the
 * forwarded settings invalidation it refreshes on.
 */
export const inject = ['remote', 'remote.settings']

/** Provide shared forms and refresh them on document changes and reconnects.
 * @param ctx Client provider context.
 */
export function apply(ctx: Context): void {
  const schema = new SettingsSchemaService(ctx)
  // Every form uses the persistence mode resolved from the connected Host.
  const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'
  const mirror = new SettingsDescribeMirror(ctx, persistence)
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { void mirror.load() }),
      ctx.on('connection/reset', () => { void mirror.load() }),
    ]
    // The first connection also emits connection/reset, so startup normally
    // costs two reads (budgeted in startup-rpc-budget.e2e.ts). The in-flight
    // fold does not merge them into one; it guarantees at most one pending
    // read at a time and that no invalidation arriving mid-read is lost.
    void mirror.ensure()
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings: describe mirror invalidations')
  // Mount `settingsScope` BEFORE `configForms` so the loader's concurrent
  // fiber mount sees the SettingsScopeService impl on `ctx.settingsScope`
  // for any sibling plugin that injects it (e.g. ui-mcp-servers). Without
  // this ordering, the sibling's `_checkImpl` runs while settingsScope is
  // still absent and parks in PENDING — a state cordis fiber inertia does
  // not recover from in this boot path.
  new SettingsScopeService(ctx, { mirror })
  new ConfigForms(ctx, { mirror, schema, persistence })
}
