/**
 * Sidebar footer button: a status click beside Settings. Renders the
 * current username when authenticated or `未登录` / `anonymous` when not.
 * The click opens a popover Menu above the button containing:
 *   - Settings: calls the OpenSettingsService owned by ui-settings-general
 *     to open the settings panel. The service buffers the request if
 *     SettingsRoot has not mounted yet, so a click delivered during cold
 *     start is not lost. No DOM dispatch — the trigger button stays a plain
 *     visual element in the `.settingsArea` seat.
 *   - Log in (anonymous) / Log out (authenticated).
 *
 * Geometry mirrors the Settings trigger row at
 * `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`:
 * a 42px-tall, 12px-radius pill in the expanded column, and a 36×36
 * circle in the collapsed rail — same padding, gap, and hover ink.
 *
 * Props are the four shares only (`packages/client/AGENTS.md` rule 3):
 * the runtime share (`SidebarFooterActionOwnerProps` carries `wide`),
 * the render-slots share (none — this entry is a leaf), the inject face,
 * and the locale seat. The snapshot source reaches the component
 * through `hooks.snapshot`, which the slot renderer binds to `useSnapshot`.
 */

import {
  IconCloseOutlineRegular, IconSettingsOutlineRegular, IconUserOutlineRegular, Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import clsx from 'clsx'
import { useState } from 'react'
import { loginStore, type LoginState } from './store.ts'
import type { Translator } from './translator.ts'
import css from './LoginIndicator.module.css'

/** Engine instance type for the login store. */
export type LoginEngineInstance = ReturnType<EngineStoreHandle<LoginState, {
  setAnonymous: (draft: LoginState, ...args: unknown[]) => void
  setAuthenticated: (draft: LoginState, username: string, ...args: unknown[]) => void
}>['create']>

/** Inject face: actions + observable snapshot source + menu callbacks + locale seat. */
export interface LoginIndicatorInjected {
  /** The bound login store instance (shared with the overlay registration). */
  controller: LoginEngineInstance
  /** Observable source the slot renderer binds to `useSnapshot`. */
  hooks: {
    snapshot: LoginEngineInstance['store']
  }
  /** Open the shell-overlay modal (the login form / account view). */
  onOpen: () => void
  /** Open the settings panel through the OpenSettingsService. */
  onOpenSettings: () => void
  /** Section copy. */
  t: Translator
}

/** Props delivered by the slot outlet: the four shares, plus the inject face spread flat. */
export type LoginIndicatorProps =
  & PropsRuntime<'sidebar.footer.action'>
  & PropsRenderSlots<never>
  & PropsLocale<'login'>
  & Partial<InjectFace<LoginIndicatorInjected>>

/**
 * No-op default for `onOpenSettings`. The Cordis-driven inject face always
 * supplies the real implementation through `ctx.settingsUI.openSettings()`;
 * the fallback is here only for tests that mount the component without
 * wiring up the full Cordis graph, so a stray click never throws.
 */
function noopOpenSettings(): void {}

/**
 * The sidebar footer indicator. Reads the snapshot through `useSnapshot`
 * (bound from `hooks.snapshot` by the slot renderer) and toggles a
 * popover Menu that floats above the button.
 * @param props - composed slot props.
 * @returns the React tree.
 */
export function LoginIndicator(props: LoginIndicatorProps) {
  const controller = props.controller
  const onOpen = props.onOpen ?? (() => {})
  const onOpenSettings = props.onOpenSettings ?? noopOpenSettings
  // oxlint-disable-next-line no-unnecessary-type-assertion
  const t = props.t as Translator
  const useSnapshot = props.useSnapshot as ((selector: (s: LoginState) => LoginState) => LoginState) | undefined

  // Hooks first (Rules of Hooks); the early-return comes after.
  const state: LoginState = useSnapshot !== undefined
    ? useSnapshot(snapshot => snapshot)
    : { status: 'anonymous', username: undefined, loggedInAt: undefined }
  const [menuOpen, setMenuOpen] = useState(false)

  if (controller === undefined) return null

  const wide = props.wide
  const authenticated = state.status === 'authenticated'
  const label = authenticated ? (state.username ?? '') : t('indicatorAnonymous')
  const ariaLabel = authenticated ? label : t('indicatorAnonymousHint')

  // Menu entries: Settings is always present; the auth entry flips
  // between Log in (anonymous) and Log out (authenticated).
  const entries: readonly MenuEntry[] = authenticated
    ? [
      { id: 'settings', label: t('menuSettings'), icon: <IconSettingsOutlineRegular size={16} /> },
      { type: 'separator', id: 'sep' },
      { id: 'logout', label: t('menuLogout'), icon: <IconCloseOutlineRegular size={16} />, danger: true },
    ]
    : [
      { id: 'settings', label: t('menuSettings'), icon: <IconSettingsOutlineRegular size={16} /> },
      { type: 'separator', id: 'sep' },
      { id: 'login', label: t('menuLogin'), icon: <IconUserOutlineRegular size={16} /> },
    ]

  const button = (
    <button
      type="button"
      className={clsx(
        css.indicator,
        !wide && css.rail,
        authenticated && css.indicatorAuthenticated,
        menuOpen && css.indicatorOpen,
      )}
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={() => { setMenuOpen(open => !open) }}
    >
      <IconUserOutlineRegular className={css.icon} size={16} />
      {wide && <span className={css.label}>{label}</span>}
    </button>
  )

  return (
    <Menu
      open={menuOpen}
      anchor={button}
      items={entries}
      side="top"
      align="start"
      portal
      onSelect={(id) => {
        setMenuOpen(false)
        if (id === 'settings') {
          onOpenSettings()
          return
        }
        if (id === 'login') {
          onOpen()
          return
        }
        if (id === 'logout') {
          controller.actions.setAnonymous()
        }
      }}
      onClose={() => { setMenuOpen(false) }}
    />
  )
}

// Re-export the store factory handle so consumers can `import type` it.
export type LoginStoreHandle = typeof loginStore
