/**
 * Frame-wide login/account modal mounted into `shell.overlay`.
 *
 * Two views share one component:
 *   - anonymous: a username input + Cancel/Log in buttons.
 *   - authenticated: a "Logged in as {user}" line + the login timestamp +
 *     a Log out button.
 *
 * The Modal primitive handles the viewport mask, Escape-to-close, and
 * aria-labelledby; this component owns only the body and the action row.
 * `shell.overlay` is a list slot with no open/close semantics, so the
 * component reads `hooks.open` to know whether to mount at all (returns
 * `null` when closed) and exposes `close` for the actions and the close
 * button.
 */

import { useState } from 'react'
import {
  Button, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { EngineStoreHandle, ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import clsx from 'clsx'
import { loginStore, type LoginState } from './store.ts'
import type { Translator } from './translator.ts'
import css from './LoginOverlay.module.css'

/** Engine instance type for the login store. */
export type LoginEngineInstance = ReturnType<EngineStoreHandle<LoginState, {
  setAnonymous: (draft: LoginState, ...args: unknown[]) => void
  setAuthenticated: (draft: LoginState, username: string, ...args: unknown[]) => void
}>['create']>

/** Reactive open/closed flag. Owned by the apply closure. */
export interface LoginOpenSnapshot {
  open: boolean
}

/** Inject face: actions + observable sources + close callback + locale seat. */
export interface LoginOverlayInjected {
  /** The bound login store instance (shared with the indicator registration). */
  controller: LoginEngineInstance
  /** Observable sources the slot renderer binds to `useSnapshot`. */
  hooks: {
    /** Login state snapshot. */
    snapshot: LoginEngineInstance['store']
    /** Open/closed flag snapshot. */
    open: ObservableSnapshot<LoginOpenSnapshot>
  }
  /** Close the modal. */
  close: () => void
  /** Section copy. */
  t: Translator
}

/** Props delivered by the slot outlet: the four shares, plus the inject face spread flat. */
export type LoginOverlayProps =
  & PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<never>
  & PropsLocale<'login'>
  & Partial<InjectFace<LoginOverlayInjected>>

/**
 * Format a ms-since-epoch timestamp as a localized string. Falls back to
 * a fixed format under SSR / non-browser hosts where `Date#toLocaleString`
 * is unavailable.
 * @param ts - timestamp.
 * @returns formatted string.
 */
function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return new Date(ts).toISOString()
  }
}

/**
 * The login/account modal. Reads both `hooks.snapshot` and `hooks.open`
 * via `useSnapshot` (bound by the slot renderer) and writes through
 * `controller.actions`.
 * @param props - composed slot props.
 * @returns the React tree (or null when closed).
 */
export function LoginOverlay(props: LoginOverlayProps) {
  const controller = props.controller
  const close = props.close ?? (() => {})
  // oxlint-disable-next-line no-unnecessary-type-assertion
  const t = props.t as Translator
  // oxlint-disable-next-line no-unnecessary-type-assertion
  const useOpen = props.useOpen as (<S>(selector: (s: LoginOpenSnapshot) => S) => S) | undefined
  // oxlint-disable-next-line no-unnecessary-type-assertion
  const useSnapshot = props.useSnapshot as (<S>(selector: (s: LoginState) => S) => S) | undefined

  // Call every hook on every render (Rules of Hooks). The selectors
  // are no-ops when their source returns the cached snapshot, so an
  // open=false render is cheap.
  const openState: LoginOpenSnapshot = useOpen !== undefined
    ? useOpen(snapshot => snapshot)
    : { open: false }
  const state: LoginState = useSnapshot !== undefined
    ? useSnapshot(snapshot => snapshot)
    : { status: 'anonymous', username: undefined, loggedInAt: undefined }
  // Component-internal input draft. Per AGENTS.md rule 5: local state
  // only, never shared, never survives remount.
  const [draft, setDraft] = useState('')

  if (controller === undefined || !openState.open) return null

  const authenticated = state.status === 'authenticated'
  const actions = controller.actions

  const submit = (): void => {
    actions.setAuthenticated(draft)
    setDraft('')
    close()
  }

  const logout = (): void => {
    actions.setAnonymous()
    close()
  }

  return (
    <Modal
      open
      onClose={close}
      title={authenticated ? t('overlayTitleAuthenticated') : t('overlayTitleAnonymous')}
      closeLabel={t('close')}
      footer={
        authenticated
          ? (
            <Button variant="primary" onClick={logout}>
              {t('logout')}
            </Button>
          )
          : (
            <>
              <Button variant="ghost" onClick={close}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={submit}
                disabled={draft.trim().length === 0}
              >
                {t('submitLogin')}
              </Button>
            </>
          )
      }
    >
      {authenticated
        ? (
          <div className={clsx(css.account)}>
            <p className={css.accountName}>
              {t('loggedInAs', { name: state.username ?? '' })}
            </p>
            {state.loggedInAt !== undefined && (
              <p className={css.accountSince}>
                {t('loggedInSince', { time: formatTimestamp(state.loggedInAt) })}
              </p>
            )}
          </div>
        )
        : (
          <form
            className={css.form}
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <label className={css.label}>
              <span className={css.fieldName}>{t('usernameField')}</span>
              <Input
                value={draft}
                onChange={(event) => { setDraft(event.target.value) }}
                placeholder={t('usernamePlaceholder')}
                autoFocus
              />
            </label>
          </form>
        )}
    </Modal>
  )
}

// Re-export the store factory handle so consumers can `import type` it.
export type LoginStoreHandle = typeof loginStore
