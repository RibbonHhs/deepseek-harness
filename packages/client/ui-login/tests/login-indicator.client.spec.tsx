// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { LoginIndicator } from '../src/client/LoginIndicator.tsx'
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

function bindUseSnapshot<T>(source: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSnapshot<S>(selector: (s: T) => S): S {
    return useSyncExternalStore(
      notify => source.subscribe(notify),
      () => selector(source.getSnapshot()),
    )
  }
}

function mount(props: {
  wide: boolean
  controller: ReturnType<typeof loginStore.create>
  onOpen?: () => void
  onOpenSettings?: () => void
}) {
  const neverHook = (() => { throw new Error('indicator must not read global hooks') }) as never
  const useSnapshot = bindUseSnapshot(props.controller.store)
  return render((
    <LoginIndicator
      wide={props.wide}
      controller={props.controller}
      useSnapshot={useSnapshot as never}
      onOpen={props.onOpen ?? (() => {})}
      onOpenSettings={props.onOpenSettings ?? (() => {})}
      t={t}
      useSessions={neverHook}
      useSessionPendingInteraction={neverHook}
      useWorkspaces={neverHook}
      renderSlot={neverHook}
    />
  ) as ReactElement)
}

describe('LoginIndicator', () => {
  it('toggles the menu and dispatches Settings / Log in when unauthenticated', () => {
    const controller = loginStore.create()
    const onOpen = vi.fn()
    const onOpenSettings = vi.fn()
    const view = mount({ wide: true, controller, onOpen, onOpenSettings })

    const button = view.getByRole('button', { name: 'Click to log in' })
    // Menu starts closed: Settings / Log in rows are not in the DOM.
    expect(view.queryByText('Settings')).toBeNull()
    expect(view.queryByText('Log in')).toBeNull()

    fireEvent.click(button)

    expect(view.getByText('Settings')).toBeTruthy()
    expect(view.getByText('Log in')).toBeTruthy()

    // Clicking Settings dispatches the openSettings callback and closes
    // the menu.
    fireEvent.click(view.getByText('Settings'))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(view.queryByText('Settings')).toBeNull()

    // Reopen, click Log in -> onOpen (the overlay modal) fires.
    fireEvent.click(button)
    fireEvent.click(view.getByText('Log in'))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows Settings + Log out when authenticated; Log out flips to anonymous', () => {
    const controller = loginStore.create()
    controller.actions.setAuthenticated('alice')
    const onOpen = vi.fn()
    const onOpenSettings = vi.fn()
    const view = mount({ wide: true, controller, onOpen, onOpenSettings })

    const button = view.getByRole('button', { name: 'alice' })
    expect(view.queryByText('Settings')).toBeNull()
    expect(view.queryByText('Log out')).toBeNull()

    fireEvent.click(button)
    expect(view.getByText('Settings')).toBeTruthy()
    expect(view.getByText('Log out')).toBeTruthy()

    fireEvent.click(view.getByText('Log out'))
    expect(controller.store.getSnapshot().status).toBe('anonymous')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it('renders as a rail icon when the sidebar is collapsed (no visible label)', () => {
    const controller = loginStore.create()
    const view = mount({ wide: false, controller })

    const button = view.getByRole('button', { name: 'Click to log in' })
    expect(button.textContent).toBe('')
  })
})
