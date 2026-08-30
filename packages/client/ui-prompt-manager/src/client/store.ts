/**
 * Browser-side store for the prompt library. Owns the prompt CRUD actions
 * (create/update/delete/tag-filter), the search/filter state, and the
 * pre-rendered preview cache. The data source is the bound `prompts`
 * settings scope; every mutation funnels through `scope.set(id, record)`
 * so file-backed persistence stays in lockstep with the in-memory view.
 *
 * The store is deliberately split from React: components read state through
 * `useStore`, mutate through `actions.*`, and never touch the underlying
 * snapshot store. The factory function builds one store per registration;
 * module-level handles are forbidden (`packages/client/AGENTS.md`).
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { collectVariables, interpolate, PROMPT_ID_PATTERN, type PromptRecord } from '../schema.ts'

/** Mirror-side section shape: prompt-id → record. */
export type PromptSection = Record<string, PromptRecord>

/** State surfaced to UI components. */
export interface PromptsState {
  /** Wire snapshot status from the settings scope. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the underlying settings document accepts writes. */
  writable: boolean
  /** Current section (already deserialized). */
  section: PromptSection
  /** Free-text search query, lower-cased for case-insensitive matching. */
  query: string
  /** Active tag filter; empty array means no tag filter. */
  activeTags: string[]
  /** Last error reported by an action, if any; cleared by the next success. */
  error: string | null
  /** Transient flag: true while a write is in flight. */
  saving: boolean
}

/** All known tags across the library, sorted; computed on every state change. */
function allTags(section: PromptSection): string[] {
  const set = new Set<string>()
  for (const record of Object.values(section)) {
    for (const tag of record.tags) set.add(tag)
  }
  return [...set].sort()
}

/** Whether a record matches the active search query and tag filter. */
function recordMatches(record: PromptRecord, query: string, activeTags: readonly string[]): boolean {
  if (activeTags.length > 0 && !activeTags.every(tag => record.tags.includes(tag))) {
    return false
  }
  if (query.length === 0) return true
  const needle = query.toLowerCase()
  return record.title.toLowerCase().includes(needle)
    || record.body.toLowerCase().includes(needle)
    || record.description.toLowerCase().includes(needle)
    || record.tags.some(tag => tag.toLowerCase().includes(needle))
}

/** One list entry paired with its stable id for React keys. */
export interface PromptListItem {
  /** Stable id used as the storage key and React key. */
  id: string
  /** The stored record. */
  record: PromptRecord
  /** Distinct variable names referenced by the body, in first-appearance order. */
  variables: string[]
}

/**
 * Result of a CRUD validation. Validation runs BEFORE the write so the UI
 * can surface an error message without persisting half-typed input. A failure
 * here produces a state.error entry and leaves the section untouched.
 */
export interface PromptValidation {
  ok: boolean
  error: string | null
}

/** Settings scope as supplied by `ctx.settingsScope.bind(...)`. */
type PromptsScope = SettingsScope<PromptSection>

/**
 * Mutable store backing the Prompts section and composer accessory.
 *
 * Constructor inputs are framework-owned (settingsScope + a translator
 * handle); one store instance per `apply()` call. Components access the
 * store through `useStore` and write through `actions.*`.
 */
export class PromptsStore {
  /** uSES-safe state source shared by every registered component. */
  readonly store: SnapshotStore<PromptsState> = createSnapshotStore<PromptsState>({
    status: 'loading',
    writable: false,
    section: {},
    query: '',
    activeTags: [],
    error: null,
    saving: false,
  })

  /** Wire subscription handle. */
  private unsubscribe: (() => void) | undefined

  /**
   * @param scope - the `prompts` settings scope; persists every write through
   * the file-backed settings provider.
   */
  constructor(private readonly scope: PromptsScope) {}

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

  /** All prompts after search/tag filters, sorted by title. */
  filtered(state: PromptsState = this.store.getSnapshot()): PromptListItem[] {
    const q = state.query.trim().toLowerCase()
    const items: PromptListItem[] = []
    for (const [id, record] of Object.entries(state.section)) {
      if (!recordMatches(record, q, state.activeTags)) continue
      items.push({ id, record, variables: collectVariables(record.body) })
    }
    items.sort((a, b) => a.record.title.localeCompare(b.record.title) || a.id.localeCompare(b.id))
    return items
  }

  /** Distinct tags across every stored prompt, sorted. */
  tags(state: PromptsState = this.store.getSnapshot()): string[] {
    return allTags(state.section)
  }

  /** One record by id, or undefined when absent. */
  findById(id: string, state: PromptsState = this.store.getSnapshot()): PromptListItem | undefined {
    const record = state.section[id]
    if (record === undefined) return undefined
    return { id, record, variables: collectVariables(record.body) }
  }

  /** Render a record with caller-supplied variable values. */
  render(id: string, values: Record<string, string>, state: PromptsState = this.store.getSnapshot()): string | undefined {
    const record = state.section[id]
    if (record === undefined) return undefined
    return interpolate(record.body, values)
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /**
   * Update the free-text search query. Purely client-side; no wire round-trip.
   * @param query - raw input.
   */
  setQuery(query: string): void {
    this.store.update((draft) => {
      draft.query = query
    })
  }

  /**
   * Toggle one tag in the active filter set.
   * @param tag - tag name to add or remove.
   */
  toggleTag(tag: string): void {
    this.store.update((draft) => {
      const index = draft.activeTags.indexOf(tag)
      if (index >= 0) draft.activeTags.splice(index, 1)
      else draft.activeTags.push(tag)
    })
  }

  /** Clear search and tag filters. */
  clearFilters(): void {
    this.store.update((draft) => {
      draft.query = ''
      draft.activeTags = []
    })
  }

  /**
   * Validate a candidate prompt without writing. The list-of-errors check
   * runs before persistence so the user sees a single, specific reason.
   * @param input - candidate id + record.
   * @param existing - existing section to check for id collisions.
   * @returns validation result.
   */
  validate(input: { id: string; record: PromptRecord }, existing: PromptSection = this.store.getSnapshot().section): PromptValidation {
    const id = input.id.trim()
    if (!PROMPT_ID_PATTERN.test(id)) {
      return { ok: false, error: 'id' }
    }
    const record = input.record
    if (record.title.trim().length === 0) {
      return { ok: false, error: 'title' }
    }
    if (record.body.trim().length === 0) {
      return { ok: false, error: 'body' }
    }
    // Id collisions only matter on create; an update reuses its own id.
    if (existing[id] === undefined) {
      return { ok: true, error: null }
    }
    return { ok: true, error: null }
  }

  /**
   * Validate id collision against existing records (returning the localized
   * label for the UI). The CRUD entry points call {@link validate} above for
   * structural checks and this for the user-facing duplicate message.
   * @param id - candidate id.
   * @param existing - section to check; defaults to the current snapshot.
   * @returns true when the id already exists.
   */
  isIdTaken(id: string, existing: PromptSection = this.store.getSnapshot().section): boolean {
    return Object.prototype.hasOwnProperty.call(existing, id)
  }

  /**
   * Insert a new prompt. Refuses when the id collides; trims whitespace and
   * dedupes tags before persisting.
   * @param id - storage key (kebab-case).
   * @param record - the candidate record.
   */
  async create(id: string, record: PromptRecord): Promise<void> {
    const state = this.store.getSnapshot()
    const normalized = this.normalize(id, record, state.section, /*overwrite=*/ false)
    if (normalized === undefined) return
    this.markSaving(true)
    try {
      await this.scope.set(normalized.id, normalized.record)
      this.store.update((draft) => { draft.error = null })
    } catch (error) {
      this.store.update((draft) => { draft.error = String(error) })
    } finally {
      this.markSaving(false)
    }
  }

  /**
   * Update an existing prompt. Refuses when the id does not exist; bumps
   * `updatedAt` and preserves `createdAt`.
   * @param id - existing storage key.
   * @param record - the replacement record body.
   */
  async update(id: string, record: PromptRecord): Promise<void> {
    const state = this.store.getSnapshot()
    const normalized = this.normalize(id, record, state.section, /*overwrite=*/ true)
    if (normalized === undefined) return
    this.markSaving(true)
    try {
      await this.scope.set(normalized.id, normalized.record)
      this.store.update((draft) => { draft.error = null })
    } catch (error) {
      this.store.update((draft) => { draft.error = String(error) })
    } finally {
      this.markSaving(false)
    }
  }

  /**
   * Remove a prompt from the section. Refuses when the id does not exist.
   * @param id - storage key to remove.
   */
  async remove(id: string): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.section[id] === undefined) return
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

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Normalize a candidate record and resolve the final id+record tuple, or
   * undefined if the operation should be refused. The `overwrite` flag
   * distinguishes create/update.
   */
  private normalize(
    id: string, record: PromptRecord, existing: PromptSection, overwrite: boolean,
  ): { id: string; record: PromptRecord } | undefined {
    const trimmedId = id.trim()
    if (!PROMPT_ID_PATTERN.test(trimmedId)) {
      this.store.update((draft) => { draft.error = 'id' })
      return undefined
    }
    const present = Object.prototype.hasOwnProperty.call(existing, trimmedId)
    if (overwrite && !present) {
      this.store.update((draft) => { draft.error = 'missing' })
      return undefined
    }
    if (!overwrite && present) {
      this.store.update((draft) => { draft.error = 'duplicate' })
      return undefined
    }
    const trimmedTitle = record.title.trim()
    const trimmedBody = record.body.trim()
    if (trimmedTitle.length === 0 || trimmedBody.length === 0) {
      this.store.update((draft) => { draft.error = 'required' })
      return undefined
    }
    // Deduped, trimmed tags.
    const seen = new Set<string>()
    const tags: string[] = []
    for (const raw of record.tags) {
      const t = raw.trim().toLowerCase()
      if (t.length === 0 || seen.has(t)) continue
      seen.add(t)
      tags.push(t)
    }
    const now = Date.now()
    const previous = existing[trimmedId]
    const createdAt = overwrite && previous !== undefined ? previous.createdAt : now
    return {
      id: trimmedId,
      record: {
        title: trimmedTitle,
        body: record.body,
        description: record.description.trim(),
        tags,
        createdAt,
        updatedAt: now,
      },
    }
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
