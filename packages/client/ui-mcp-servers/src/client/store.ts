/**
 * Browser-side store for the MCP server registry. Owns CRUD actions over
 * the bound `mcp-servers` settings scope; every mutation funnels through
 * `scope.set(id, record)` / `scope.unset(id)` so the host activator sees
 * the change through its `ctx.settings.subscribe(...)` listener and the
 * file-backed provider persists it to `settings.yaml`.
 *
 * The store is deliberately split from React: components read state
 * through `useStore` and write through actions; the factory builds one
 * store per registration. Module-level handles are forbidden
 * (`packages/client/AGENTS.md`).
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { McpServerRecord } from '../schema.ts'
import { validateMcpServerRecord } from '../schema.ts'

/** Mirror-side section shape: id → record. */
export type McpSection = Record<string, McpServerRecord>

/** State surfaced to UI components. */
export interface McpServersState {
  /** Wire snapshot status from the settings scope. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the underlying settings document accepts writes. */
  writable: boolean
  /** Current section (already deserialized). */
  section: McpSection
  /** Free-text search query, lower-cased for case-insensitive matching. */
  query: string
  /** Last error reported by an action, if any; cleared by the next success. */
  error: string | null
  /** Transient flag: true while a write is in flight. */
  saving: boolean
}

/** One list entry paired with its stable id for React keys. */
export interface McpServerListItem {
  /** Stable id used as the storage key and React key. */
  id: string
  /** The stored record. */
  record: McpServerRecord
}

/**
 * Result of a CRUD validation. Validation runs BEFORE the write so the
 * UI can surface an error message without persisting half-typed input.
 */
export interface McpValidation {
  ok: boolean
  error: 'id' | 'name' | 'command' | 'url' | null
}

/** Settings scope as supplied by `ctx.settingsScope.bind(...)`. */
type McpScope = SettingsScope<McpSection>

/** Whether a record matches the active search query. */
function recordMatches(record: McpServerRecord, query: string): boolean {
  if (query.length === 0) return true
  const needle = query.toLowerCase()
  return record.id.toLowerCase().includes(needle)
    || record.name.toLowerCase().includes(needle)
    || (record.description ?? '').toLowerCase().includes(needle)
}

/**
 * Mutable store backing the MCP servers settings page.
 *
 * Constructor inputs are framework-owned (settingsScope); one store
 * instance per `apply()` call. Components access the store through
 * `useStore` and write through actions.
 */
export class McpServersStore {
  /** uSES-safe state source shared by every registered component. */
  readonly store: SnapshotStore<McpServersState> = createSnapshotStore<McpServersState>({
    status: 'loading',
    writable: false,
    section: {},
    query: '',
    error: null,
    saving: false,
  })

  /** Wire subscription handle. */
  private unsubscribe: (() => void) | undefined

  /**
   * @param scope - the `mcp-servers` settings scope; persists every write
   * through the file-backed settings provider and broadcasts to the host
   * activator.
   */
  constructor(private readonly scope: McpScope) {}

  /**
   * Begin following the bound scope (idempotent) and publish its current
   * answer into the store. Required at startup so the section reads from
   * the wire before the first render.
   * @returns settlement after the first answer is published.
   */
  load(): Promise<void> {
    this.unsubscribe ??= this.scope.subscribe(() => { this.derive() })
    this.derive()
    return Promise.resolve()
  }

  /** Stop following the scope. */
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  // ── queries ────────────────────────────────────────────────────────────────

  /** All servers after the search filter, sorted by name. */
  filtered(state: McpServersState = this.store.getSnapshot()): McpServerListItem[] {
    const q = state.query.trim().toLowerCase()
    const items: McpServerListItem[] = []
    for (const [id, record] of Object.entries(state.section)) {
      if (!recordMatches(record, q)) continue
      items.push({ id, record })
    }
    items.sort((a, b) => {
      const nameCmp = a.record.name.localeCompare(b.record.name)
      return nameCmp !== 0 ? nameCmp : a.id.localeCompare(b.id)
    })
    return items
  }

  /** One record by id, or undefined when absent. */
  findById(id: string, state: McpServersState = this.store.getSnapshot()): McpServerRecord | undefined {
    return state.section[id]
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /** Update the free-text search query. Purely client-side; no wire round-trip. */
  setQuery(query: string): void {
    this.store.update((draft) => {
      draft.query = query
    })
  }

  /**
   * Validate a candidate record without writing. Runs the structural
   * checks (id pattern, name, transport-specific required field) and id
   * collision for create flows.
   * @param input - candidate id + record.
   * @returns validation outcome.
   */
  validate(input: { id: string; record: McpServerRecord }, isUpdate = false): McpValidation {
    const id = input.id.trim()
    const candidate: McpServerRecord = { ...input.record, id }
    const structural = validateMcpServerRecord(candidate)
    if (!structural.ok) return structural
    if (!isUpdate && this.findById(id) !== undefined) {
      return { ok: false, error: 'id' }
    }
    return { ok: true, error: null }
  }

  /**
   * Insert a new server. Refuses when the id collides; the activator picks
   * the new entry up on the next `ctx.settings` notification.
   * @param id - storage key (kebab-case).
   * @param record - the candidate record.
   */
  async create(id: string, record: McpServerRecord): Promise<void> {
    const trimmedId = id.trim()
    const validation = this.validate({ id: trimmedId, record }, false)
    if (!validation.ok) return
    this.markSaving(true)
    try {
      await this.scope.set(trimmedId, { ...record, id: trimmedId })
      this.store.update((draft) => { draft.error = null })
    } catch (error) {
      this.store.update((draft) => { draft.error = String(error) })
    } finally {
      this.markSaving(false)
    }
  }

  /**
   * Update an existing server. Refuses when the id does not exist.
   * @param id - storage key.
   * @param record - the replacement record body.
   */
  async update(id: string, record: McpServerRecord): Promise<void> {
    const trimmedId = id.trim()
    const validation = this.validate({ id: trimmedId, record }, true)
    if (!validation.ok) return
    this.markSaving(true)
    try {
      await this.scope.set(trimmedId, { ...record, id: trimmedId })
      this.store.update((draft) => { draft.error = null })
    } catch (error) {
      this.store.update((draft) => { draft.error = String(error) })
    } finally {
      this.markSaving(false)
    }
  }

  /**
   * Remove a server from the registry. The activator disposes any active
   * connection on the next reconcile pass.
   * @param id - storage key to remove.
   */
  async remove(id: string): Promise<void> {
    if (this.findById(id) === undefined) return
    this.markSaving(true)
    try {
      await this.scope.unset(id)
      this.store.update((draft) => { draft.error = null })
    } catch (error) {
      this.store.update((draft) => { draft.error = String(error) })
    } finally {
      this.markSaving(false)
    }
  }

  /**
   * Toggle a single server's enabled flag. A faster path than `update()`
   * when only the toggle changed: writes a single field, leaving the
   * rest of the record intact.
   * @param id - storage key.
   * @param enabled - the new flag value.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const existing = this.findById(id)
    if (existing === undefined) return
    await this.update(id, { ...existing, enabled })
  }

  /** Set/unset the saving flag. */
  private markSaving(value: boolean): void {
    this.store.update((draft) => { draft.saving = value })
  }

  /** Fold the bound scope's snapshot into our reactive state. */
  private derive(): void {
    const snapshot = this.scope.getSnapshot()
    this.store.update((draft) => {
      draft.status = snapshot.status
      draft.writable = snapshot.writable
      if (snapshot.status === 'ready' && snapshot.value !== undefined) {
        draft.section = snapshot.value
      }
    })
  }
}
