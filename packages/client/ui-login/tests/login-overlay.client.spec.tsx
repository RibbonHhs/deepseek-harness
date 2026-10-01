// @vitest-environment jsdom
import { useSyncExternalStore, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LoginOverlay, type LoginOpenSnapshot } from '../src/client/LoginOverlay.tsx'
import { loginStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

const t: (key: keyof typeof en | string, params?: Record<string, unknown>) => string =
  (key, params) => {
    const template = (en as Record<string, string>)[key] ?? key
    if (params === undefined) return template
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
      template,
    )
  }

afterEach(() => {
  cleanup()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

/**
 * Build a useSnapshot-shaped hook over a SnapshotStore that actually
 * subscribes (so React re-renders on snapshot changes). Matches the
 * shape of the framework-bound `use<Name>` hook for tests.
 */
function bindUseSnapshot<T>(source: SnapshotStore<T>) {
  return function useSnapshot<S>(selector: (s: T) => S): S {
    return useSyncExternalStore(
      notify => source.subscribe(notify),
      () => selector(source.getSnapshot()),
    )
  }
}

function mountOverlay(initial: LoginOpenSnapshot = { open: true }) {
  const controller = loginStore.create()
  const openStore: SnapshotStore<LoginOpenSnapshot> = createSnapshotStore<LoginOpenSnapshot>(initial)
  const close = vi.fn()
  const useSnapshot = bindUseSnapshot(controller.store)
  const useOpen = bindUseSnapshot(openStore)
  const neverHook = (() => { throw new Error('login overlay must not read global hooks') }) as never
  const view = render((
    <LoginOverlay
      controller={controller}
      useSnapshot={useSnapshot as never}
      useOpen={useOpen as never}
      close={close}
      t={t}
      useSessions={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
      usePanelInfo={neverHook}
      useResource={neverHook}
      useWorkspaces={neverHook}
      renderSlot={neverHook}
    />
  ) as ReactElement)
  return { controller, openStore, close, view }
}

describe('LoginOverlay', () => {
  it('submits a username, marks authenticated, and closes', () => {
    const { controller, close } = mountOverlay()
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'alice' } })
    const loginButton = Array.from(document.querySelectorAll('button')).find(
      button => button.textContent === 'Log in',
    ) as HTMLButtonElement
    fireEvent.click(loginButton)
    expect(close).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().status).toBe('authenticated')
    expect(controller.store.getSnapshot().username).toBe('alice')
  })

  it('logs out and closes when authenticated', () => {
    const { controller, close } = mountOverlay()
    act(() => { controller.actions.setAuthenticated('alice') })
    const logoutButton = Array.from(document.querySelectorAll('button')).find(
      button => button.textContent === 'Log out',
    ) as HTMLButtonElement
    expect(logoutButton).toBeTruthy()
    fireEvent.click(logoutButton)
    expect(close).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().status).toBe('anonymous')
  })

  it('renders nothing when open is false', () => {
    const { view } = mountOverlay({ open: false })
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })
})
