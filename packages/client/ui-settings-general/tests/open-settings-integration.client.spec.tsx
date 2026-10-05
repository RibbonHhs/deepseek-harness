// @vitest-environment jsdom
/**
 * End-to-end: ctx.settingsUI.openSettings() → SettingsRoot → SettingsPanel.
 * Verifies the cross-plugin intake works without DOM dispatch and without
 * the data-dsh-settings-seat attribute that the previous design relied on.
 */
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsRootComponentProps } from '../src/client/shell-contract.ts'
import { createOpenSettingsService } from '../src/client/open-settings-service.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { createSettingsShellStore } from '../src/client/shell-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const SEAT_CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

// Every fixture carries the global seat's standard hooks (panel info,
// session attention, session retention, resource) plus the per-face
// `hooks` compartment derived from `SettingsRootInjected.hooks`. The merge
// contract (`@dsh-client-resources/src/client/contract.ts` + `@dsh-client-session`,
// `@dsh-client-layout` via `@dsh-client-ui-slots`) requires the mount
// helper to provide them even when the test asserts no behaviour on them.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const useSessionRetainInfo: GlobalStandardProps['useSessionRetainInfo'] = () => undefined
const useSessionStatus: SettingsRootComponentProps['useSessionStatus'] = selector => selector(new Map())
const useShortcuts: SettingsRootComponentProps['useShortcuts'] = selector => selector([])
const useDesktopUpdate: SettingsRootComponentProps['useDesktopUpdate'] = selector => selector({ failed: false, opening: false })

function mountSettingsRoot() {
  const rows = [{ id: 'general', order: 0, label: 'General' }]
  const currentRows = rows
  const listeners = new Set<() => void>()
  const renderSlot = ((key: string, _owner: unknown, opts?: { only?: string }) => {
    if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
    return SEAT_CONTENT[key] ?? null
  }) as SettingsRootComponentProps['renderSlot']
  const useSections = ((select: (s: typeof rows) => unknown) => {
    const [, force] = useState(0)
    useEffect(() => {
      const listener = () => { force(n => n + 1) }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }, [])
    return select(currentRows)
  }) as never
  const useConnectionState = ((select: (s: string) => string) => select('connected')) as never
  const useOnboardingSteps = ((select: (s: never[]) => unknown) => select([] as never[])) as never
  const useSessions = ((select: (s: unknown) => unknown) => select({
    phase: 'ready' as const, current: 's', byId: { s: { blank: false } },
  })) as never
  const useWorkspaces = ((select: (s: never) => unknown) => select(undefined as never)) as never
  // Real settings-shell store instance — the sanctioned path for client
  // component tests (see `packages/client/AGENTS.md`). `bindSnapshotSelector`
  // wraps the engine store as the `useStore` selector hook.
  const shellStore = createSettingsShellStore().create()
  const props: SettingsRootComponentProps = {
    wide: true,
    reconnect: () => {},
    openDesktopUpdate: () => {},
    t: makeTranslate(en),
    useStore: bindSnapshotSelector(shellStore),
    actions: shellStore.actions,
    useConnectionState,
    useOnboardingSteps,
    useSessions,
    useWorkspaces,
    useSections,
    useShortcuts,
    useDesktopUpdate,
    usePanelInfo,
    useSessionStatus,
    useSessionRetainInfo,
    useResource,
    renderSlot,
    // The mount helper does not wire a real service; the caller passes its
    // own subscribeOpenSettings through when mounting SettingsRoot.
    subscribeOpenSettings: () => () => {},
  }
  return { props, renderSlot }
}

describe('settingsUI service → SettingsRoot', () => {
  it('opens the panel on openSettings() once SettingsRoot has subscribed', async () => {
    const service = createOpenSettingsService()
    const { props } = mountSettingsRoot()
    const view = render(
      <SettingsRoot {...props} subscribeOpenSettings={listener => service.subscribe(listener)} />,
    )

    // Trigger button present, panel not open yet.
    expect(view.queryByRole('dialog')).toBeNull()

    act(() => { service.openSettings() })

    await waitFor(() => {
      expect(view.queryByRole('dialog')).toBeTruthy()
    })
  })

  it('replays a request that fires before SettingsRoot subscribes', async () => {
    const service = createOpenSettingsService()
    // Click delivered before SettingsRoot mounts: the buffer holds it.
    service.openSettings()
    const { props } = mountSettingsRoot()
    const view = render(
      <SettingsRoot {...props} subscribeOpenSettings={listener => service.subscribe(listener)} />,
    )

    await waitFor(() => {
      expect(view.queryByRole('dialog')).toBeTruthy()
    })
  })

  it('closes the panel and reopens on a fresh request', async () => {
    const service = createOpenSettingsService()
    const { props } = mountSettingsRoot()
    const view = render(
      <SettingsRoot {...props} subscribeOpenSettings={listener => service.subscribe(listener)} />,
    )

    act(() => { service.openSettings() })
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeTruthy() })

    fireEvent.click(view.getByRole('button', { name: 'Close' }))
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })

    act(() => { service.openSettings() })
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeTruthy() })
  })
})
