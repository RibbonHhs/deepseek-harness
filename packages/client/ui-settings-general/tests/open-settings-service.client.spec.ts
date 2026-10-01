/**
 * OpenSettingsService: the cross-plugin intake that flips the settings panel
 * open. Subscribers come and go (SettingsRoot mounts and unmounts as the
 * sidebar render commits), and requests may fire while no subscriber is live
 * — ui-login's footer menu can pop before SettingsRoot has rendered, or while
 * the sidebar is collapsed mid-reconcile. The service must hold at most one
 * pending request, replay it on subscribe, and deliver all subsequent
 * requests synchronously to the live subscribers.
 */
import { describe, expect, it, vi } from 'vitest'
import { createOpenSettingsService } from '../src/client/open-settings-service.ts'

describe('createOpenSettingsService', () => {
  it('fires a buffered request immediately on the first subscribe', () => {
    const service = createOpenSettingsService()
    const listener = vi.fn()
    service.openSettings()
    expect(listener).not.toHaveBeenCalled()
    const dispose = service.subscribe(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('delivers a request to every live subscriber', () => {
    const service = createOpenSettingsService()
    const a = vi.fn()
    const b = vi.fn()
    service.subscribe(a)
    service.subscribe(b)
    service.openSettings()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('does not redeliver the buffered request once it has been consumed', () => {
    const service = createOpenSettingsService()
    service.openSettings()
    const first = vi.fn()
    service.subscribe(first)
    expect(first).toHaveBeenCalledTimes(1)
    const second = vi.fn()
    service.subscribe(second)
    // The buffer was consumed by the first subscriber; the second arrives at
    // an idle service and stays idle until the next openSettings call.
    expect(second).not.toHaveBeenCalled()
  })

  it('continues delivering requests after a subscriber disposes', () => {
    const service = createOpenSettingsService()
    const a = vi.fn()
    const disposeA = service.subscribe(a)
    disposeA()
    // No live subscribers; a request buffers into the pending slot.
    service.openSettings()
    expect(a).not.toHaveBeenCalled()
    const b = vi.fn()
    // Subscribe replays the buffered request, then the live request fires the
    // subscriber exactly once. The buffer does not double-count later calls.
    service.subscribe(b)
    expect(b).toHaveBeenCalledTimes(1)
    service.openSettings()
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('keeps the buffer single-slot: a request after subscribe buffers nothing extra', () => {
    const service = createOpenSettingsService()
    const listener = vi.fn()
    service.subscribe(listener)
    service.openSettings()
    service.openSettings()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
