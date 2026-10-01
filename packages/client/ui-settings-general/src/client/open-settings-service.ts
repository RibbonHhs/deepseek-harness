/**
 * Settings panel open-request service.
 *
 * Sidebar occupants reach the settings panel without DOM dispatch: ui-login
 * emits a request through `ctx.settingsUI.openSettings()` when the user picks
 * "Settings" from its popover, and the SettingsRoot subscriber flips the panel
 * open. A subscriber may not be mounted at the moment a request fires — the
 * service buffers a single pending request and notifies the next subscriber
 * synchronously on `subscribe`, so a click delivered before the shell mounts
 * is not lost. The buffer is one-slot: every successful open replays into the
 * subscriber, and a second request after that goes straight through.
 *
 * The service is intentionally minimal — it owns no state beyond the pending
 * flag and the live subscriber set, since the open panel itself is component
 * state inside SettingsRoot.
 */

/** Subscriber invoked when an open request is delivered. */
export type OpenSettingsListener = () => void

/** Service exposed on the Cordis context as `ctx.settingsUI`. */
export interface OpenSettingsService {
  /** Request the settings panel to open. Buffered if no subscriber is mounted. */
  openSettings(): void
  /** Register a listener. Returns a disposer. Fires immediately if a request is buffered. */
  subscribe(listener: OpenSettingsListener): () => void
}

export function createOpenSettingsService(): OpenSettingsService {
  let pending = false
  const listeners = new Set<OpenSettingsListener>()

  return {
    openSettings(): void {
      if (listeners.size === 0) {
        pending = true
        return
      }
      for (const listener of listeners) listener()
    },
    subscribe(listener: OpenSettingsListener): () => void {
      listeners.add(listener)
      if (pending) {
        pending = false
        listener()
      }
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
