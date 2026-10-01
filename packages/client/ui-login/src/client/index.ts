/**
 * Login plugin, browser half.
 *
 * Registers:
 *   - `sidebar.footer.action` entry: a status chip beside Settings.
 *   - `shell.overlay` entry:        a frame-wide modal with the login
 *                                   form (anonymous) or the account view
 *                                   (authenticated).
 *
 * Both entries share one `loginStore.create()` controller and one
 * `open` snapshot source so a login in the modal is observed by the
 * sidebar chip and vice versa. Open state is ephemeral UI; the store is
 * the source of truth for status (AGENTS.md rule 6: "share by passing
 * one handle to several registers inside apply").
 *
 * Export discipline: `packages/client/AGENTS.md`. Only `apply`, `inject`,
 * the shared store factory handle, and the typed contract aliases leave
 * the package; components stay internal.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `ctx.settingsUI` Context merge so the menu's "Settings"
// entry can call the settings panel open through the service, with no DOM
// dispatch and no SettingsRoot seam.
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { loginStore } from './store.ts'
import { LoginIndicator, type LoginIndicatorInjected } from './LoginIndicator.tsx'
import { LoginOverlay, type LoginOverlayInjected, type LoginOpenSnapshot } from './LoginOverlay.tsx'
import { en, zh, type LoginKey } from './locales.ts'
import type { Translator } from './translator.ts'

// Re-export contract types and the store factory so consumers can `import type` them.
export type {
  LoginIndicatorInjected, LoginIndicatorProps, LoginStoreHandle,
} from './LoginIndicator.tsx'
export type {
  LoginOpenSnapshot, LoginOverlayInjected, LoginOverlayProps,
} from './LoginOverlay.tsx'
export type { LoginKey } from './locales.ts'
export type { Translator } from './translator.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Login overlay + indicator copy. */
    login: LoginKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'login'

/** Required services: slot registry, locale dictionary, settings open intake. */
export const inject = ['slots', 'locale', 'settingsUI']

/**
 * Register the login dictionaries, the sidebar indicator, and the shell-overlay
 * modal. One store instance, one open-flag snapshot source — both registrations
 * close over them.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'ui-login: dictionaries',
  )

  // One store instance shared by both registrations (AGENTS.md rule 6).
  const controller = loginStore.create()

  // Companion snapshot source for the modal's open/closed flag. shell.overlay
  // is a list slot with no hide semantics, so the indicator's click mutates
  // this source and the modal reads it through its hooks.open binding.
  const openStore: SnapshotStore<LoginOpenSnapshot> = createSnapshotStore<LoginOpenSnapshot>({
    open: false,
  })

  const setOpen = (next: boolean): void => { openStore.set({ open: next }) }
  const t = ctx.locale.bind(NS) as Translator

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'login.indicator',
    inject: (): LoginIndicatorInjected => ({
      controller,
      hooks: { snapshot: controller.store },
      onOpen: () => { setOpen(true) },
      // Reach the settings panel through the OpenSettingsService owned by
      // ui-settings-general. The service buffers the request if SettingsRoot
      // has not yet mounted; SettingsRoot then opens on subscribe. No DOM
      // dispatch, no shared data attribute, no race against React's
      // event-delegation timing.
      onOpenSettings: () => { ctx.settingsUI.openSettings() },
      t,
    }),
  }, LoginIndicator))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'login.overlay',
    inject: (): LoginOverlayInjected => ({
      controller,
      hooks: { snapshot: controller.store, open: openStore },
      close: () => { setOpen(false) },
      t,
    }),
  }, LoginOverlay))
}
