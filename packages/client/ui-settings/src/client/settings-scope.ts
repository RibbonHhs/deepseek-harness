/**
 * Per-namespace `Record<string, T>` view over the shared describe mirror.
 *
 * Settings scope is a stripped-down `ConfigForm<T>`: the section is a flat
 * record keyed by an entry-defined id (an MCP server id, a prompt id, …) and
 * writes are full-record replaces rather than path-level ops. The underlying
 * mirror + remote are still owned by `ui-settings`; the scope only adds a
 * thin facade so features that target a single record map do not have to
 * hand-roll `ctx.configForms.get(ns).mutate([{op:'set', path:[id], value}])`.
 *
 * @module @deepseek-ai/dsh-client-ui-settings/client
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ConfigForms } from './config-form.ts'
import type { SettingsDescribeMirror } from './settings-mirror.ts'

/** Wire status shared by both `ConfigForm` and `SettingsScope`. */
export type SettingsScopeStatus = 'loading' | 'ready' | 'unavailable'

/** Snapshot of one settings scope. */
export interface SettingsScopeSnapshot<T extends Record<string, unknown>> {
  /** Mirror load state; `ready` once one accepted answer has landed. */
  status: SettingsScopeStatus
  /** Last accepted section, decoded for this scope; undefined before the first answer. */
  value: T | undefined
  /** Whether the Host document accepts writes; memory-mode pages never do. */
  writable: boolean
}

/**
 * Per-namespace read/write handle returned by
 * {@link SettingsScopeService.bind}. One scope per call; safe to share with
 * React components (every method returns a fresh derived snapshot and
 * the unsubscribe returned by `subscribe` is idempotent).
 */
export interface SettingsScope<T extends Record<string, unknown>> {
  /** @returns the current snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Replace one record by id. The Host validates the resulting section against
   * its namespace schema; a rejection surfaces as a thrown error from the
   * underlying `remote.settings.mutate` round-trip.
   * @param id - storage key.
   * @param record - the replacement record body.
   */
  set(id: string, record: T[string]): Promise<void>
  /** Remove one record by id. The Host replies with the next mirror fold. */
  unset(id: string): Promise<void>
}

/** Bind options for {@link SettingsScopeService.bind}. */
export interface SettingsScopeSpec<T extends Record<string, unknown>> {
  /** Profile entry id the host activator listens to. */
  namespace: string
  /** Optional narrowing decoder; receives the raw section and returns the typed value. */
  decode?: (section: unknown) => T | undefined
}

/**
 * Owns the per-scope controllers bound from this package. Mirrors the
 * `ConfigForms` registration model: one service instance, scope-per-namespace
 * controllers cached by `namespace` until the provider fiber disposes.
 */
export class SettingsScopeService extends Service {
  private readonly config: { mirror: SettingsDescribeMirror; configForms?: ConfigForms | undefined }

  constructor(ctx: Context, config: { mirror: SettingsDescribeMirror; configForms?: ConfigForms | undefined }) {
    super(ctx, 'settingsScope')
    this.config = { mirror: config.mirror, configForms: config.configForms }
    ctx.effect((): (() => Promise<void>) => {
      const dispose = (scope: SettingsScopeController<Record<string, unknown>>): Promise<void> => {
        scope.dispose()
        return Promise.resolve()
      }
      const disposals: Promise<void>[] = []
      this.scopes.forEach((scope) => {
        disposals.push(dispose(scope))
      })
      const cleanup = (): Promise<void> => Promise.all(disposals).then(() => { this.scopes.clear() })
      return cleanup
    }, 'ui-settings: settings scopes')
  }
  private readonly scopes = new Map<string, SettingsScopeController<Record<string, unknown>>>()

  /**
   * @param ctx - the providing plugin's context.
   * @param config - the shared describe mirror. `configForms` is resolved
   * lazily on first `bind()` so this service can be constructed BEFORE
   * ConfigForms mounts; the loader's concurrent mount means ui-mcp-servers
   * injects `settingsScope` and only sees a registered impl if the
   * SettingsScopeService ctor has already run.
   */
  bind<T extends Record<string, unknown>>(spec: SettingsScopeSpec<T>): SettingsScope<T> {
    const key = `${spec.namespace}::${spec.decode === undefined ? 'identity' : 'custom'}`
    const existing = this.scopes.get(key)
    if (existing !== undefined) return existing as unknown as SettingsScope<T>
    const configForms = this.config.configForms ?? this.ctx.configForms
    const controller = new SettingsScopeController<T>(spec, this.config.mirror, configForms)
    this.scopes.set(key, controller)
    return controller
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Per-namespace `Record<string, T>` view over the shared settings
     * mirror. Use this when the feature owns a record map (MCP servers,
     * prompt templates, …); use `ctx.configForms.get(ns)` for any other
     * shape.
     */
    settingsScope: SettingsScopeService
  }
}

/**
 * One per-namespace scope controller. Reads the shared mirror directly so
 * the in-memory mirror fold does not double-step through `ConfigForm`'s
 * narrowing; writes delegate to `ConfigForm.mutate([{op:'set', path:[id]}])`
 * so they ride the same revision fencing, ordering, and recovery path
 * as every other settings consumer.
 */
class SettingsScopeController<T extends Record<string, unknown>> implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private readonly unsubscribe: () => void

  constructor(
    private readonly spec: SettingsScopeSpec<T>,
    private readonly mirror: SettingsDescribeMirror,
    private readonly configForms: ConfigForms,
  ) {
    this.store = createSnapshotStore<SettingsScopeSnapshot<T>>({
      status: 'loading',
      value: undefined,
      writable: false,
    })
    this.unsubscribe = this.mirror.subscribe(() => { this.derive() })
    this.derive()
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  async set(id: string, record: T[string]): Promise<void> {
    await this.configForms.get<Record<string, T[string]>>(this.spec.namespace).set(id, record)
  }

  async unset(id: string): Promise<void> {
    await this.configForms.get<Record<string, T[string]>>(this.spec.namespace).unset(id)
  }

  dispose(): void {
    this.unsubscribe()
  }

  private derive(): void {
    const mirrored = this.mirror.getSnapshot()
    if (mirrored.view === undefined) return
    const { writable } = mirrored.view
    const namespace = mirrored.view.namespaces.find(candidate => candidate.ns === this.spec.namespace)
    if (namespace === undefined) {
      this.store.update((draft) => {
        draft.status = 'unavailable'
        draft.writable = writable
      })
      return
    }
    const raw = namespace.value
    const decoded = this.spec.decode === undefined
      ? (raw as T)
      : this.spec.decode(raw)
    if (decoded === undefined) {
      this.store.update((draft) => {
        draft.status = 'unavailable'
        draft.writable = writable
      })
      return
    }
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.writable = writable
      draft.value = decoded
    })
  }
}
