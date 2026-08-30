/**
 * Client-side entry for the dsh-client-store package.
 *
 * The host cordis loader treats every browser-roster entry as a plugin and
 * calls `apply` once on startup; pure-data modules that get externalized by
 * other bundles still need an `apply` so the loader accepts them. The actual
 * runtime value exports (defineStore, createSnapshotStore, ...) are read by
 * other bundles through the browser module table via this same artifact.
 */
import type { Context } from '@deepseek-ai/cordis'

export { defineStore, createSnapshotStore, shallowEqual, notifySubscribers } from '../index.ts'
export type {
  ActionsDecl, BakedActions, BoundActions, DefineStore, HandleOf, MaybeSnapshotSelectorHook,
  ObservableSnapshot, PropsStore, SnapshotSelectorHook, StoreDecl, StoreFactory,
  StoreHandle, StoreInstance, StoreSpec,
  EngineStoreHandle, EngineStoreInstance,
} from '../index.ts'

/** No-op plugin body; the store carries no host-side behavior. */
export function apply(_ctx: Context): void {}
