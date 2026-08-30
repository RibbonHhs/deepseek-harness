// @vitest-environment jsdom
/**
 * PromptsStore behavior over a stubbed settings scope. The wire face is a
 * plain object that captures writes; the mirror is bypassed to keep the
 * test focused on store-level invariants.
 */
import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PromptsStore, type PromptSection } from '../src/client/store.ts'
import { collectVariables, interpolate } from '../src/schema.ts'

/** A scope with synchronous set/unset that mirrors writes back into the snapshot. */
function buildScope(initial: PromptSection = {}): SettingsScope<PromptSection> & { writes: { op: 'set' | 'unset'; field: string; value?: unknown }[] } {
  const writes: { op: 'set' | 'unset'; field: string; value?: unknown }[] = []
  let section: PromptSection = { ...initial }
  const listeners = new Set<() => void>()
  const scope = {
    writes,
    getSnapshot: () => ({
      status: 'ready' as const,
      value: section,
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set(field: string, value: unknown) {
      writes.push({ op: 'set', field, value })
      section = { ...section, [field]: value as PromptSection[string] }
      for (const fn of [...listeners]) fn()
    },
    async unset(field: string) {
      writes.push({ op: 'unset', field })
      const next = { ...section }
      delete next[field]
      section = next
      for (const fn of [...listeners]) fn()
    },
    async mutate() {
      // SettingsScope.mutate is required by the type but the store exercises
      // set/unset directly; this stub keeps the scope satisfying the contract.
    },
  }
  return scope
}

describe('collectVariables', () => {
  it('returns distinct names in first-appearance order', () => {
    expect(collectVariables('Hi {{name}}, your id is {{id}} and re-confirm {{name}}.'))
      .toEqual(['name', 'id'])
  })

  it('ignores malformed placeholders and whitespace', () => {
    expect(collectVariables('{{ ok }} {{1bad}} {{good-one}}'))
      .toEqual(['ok', 'good-one'])
  })

  it('returns an empty list when no placeholders are present', () => {
    expect(collectVariables('plain text without anything')).toEqual([])
  })
})

describe('interpolate', () => {
  it('substitutes all provided values', () => {
    expect(interpolate('Hello {{name}}, welcome to {{place}}.', { name: 'Ada', place: 'DSH' }))
      .toBe('Hello Ada, welcome to DSH.')
  })

  it('renders absent values as empty strings and keeps unknown placeholders', () => {
    expect(interpolate('{{a}}-{{b}}-{{c}}', { a: 'x' }))
      .toBe('x--{{c}}')
  })
})

describe('PromptsStore', () => {
  it('loads an initial section through the bound scope', async () => {
    const scope = buildScope({
      existing: {
        title: 'Existing', body: 'Hello {{name}}', description: '',
        tags: ['greet'], createdAt: 1, updatedAt: 1,
      },
    })
    const store = new PromptsStore(scope)
    await store.load()
    expect(store.store.getSnapshot().section).toHaveProperty('existing')
    expect(store.tags()).toEqual(['greet'])
    expect(store.filtered()[0]?.variables).toEqual(['name'])
  })

  it('filters by query and active tags', async () => {
    const scope = buildScope({
      a: { title: 'Alpha', body: 'foo', description: '', tags: ['one'], createdAt: 0, updatedAt: 0 },
      b: { title: 'Beta', body: 'bar', description: '', tags: ['two'], createdAt: 0, updatedAt: 0 },
    })
    const store = new PromptsStore(scope)
    await store.load()
    store.setQuery('alp')
    expect(store.filtered().map(item => item.id)).toEqual(['a'])
    store.setQuery('')
    store.toggleTag('two')
    expect(store.filtered().map(item => item.id)).toEqual(['b'])
  })

  it('creates, updates, and removes prompts through the scope', async () => {
    const scope = buildScope()
    const store = new PromptsStore(scope)
    await store.load()
    await store.create('greet', {
      title: 'Greet', body: 'Hello {{name}}', description: '', tags: ['greet', 'Greet'],
      createdAt: 0, updatedAt: 0,
    })
    expect(scope.writes).toHaveLength(1)
    expect(scope.writes[0]).toMatchObject({ op: 'set', field: 'greet' })
    // tags are trimmed and lower-cased + deduped.
    expect((scope.writes[0] as { value: { tags: string[] } }).value.tags).toEqual(['greet'])

    await store.update('greet', {
      title: 'Greet v2', body: 'Hi {{name}}', description: '',
      tags: [], createdAt: 1, updatedAt: 1,
    })
    expect(scope.writes).toHaveLength(2)
    expect((scope.writes[1] as { value: { title: string } }).value.title).toBe('Greet v2')

    await store.remove('greet')
    expect(scope.writes[2]).toEqual({ op: 'unset', field: 'greet' })
  })

  it('rejects an invalid id without persisting', async () => {
    const scope = buildScope()
    const store = new PromptsStore(scope)
    await store.load()
    await store.create('Bad Id', {
      title: 'X', body: 'body', description: '', tags: [],
      createdAt: 0, updatedAt: 0,
    })
    expect(scope.writes).toHaveLength(0)
    expect(store.store.getSnapshot().error).toBe('id')
  })

  it('rejects an empty body without persisting', async () => {
    const scope = buildScope()
    const store = new PromptsStore(scope)
    await store.load()
    await store.create('good-id', {
      title: 'X', body: '   ', description: '', tags: [],
      createdAt: 0, updatedAt: 0,
    })
    expect(scope.writes).toHaveLength(0)
    expect(store.store.getSnapshot().error).toBe('required')
  })

  it('renders a stored body with caller-supplied values', async () => {
    const scope = buildScope({
      greet: {
        title: 'Greet', body: 'Hello {{name}}, today is {{day}}.',
        description: '', tags: [], createdAt: 0, updatedAt: 0,
      },
    })
    const store = new PromptsStore(scope)
    await store.load()
    expect(store.render('greet', { name: 'Ada', day: 'Monday' }))
      .toBe('Hello Ada, today is Monday.')
  })

  it('findById returns the stored record', async () => {
    const scope = buildScope({
      greet: {
        title: 'Greet', body: 'Hi', description: '', tags: [],
        createdAt: 0, updatedAt: 0,
      },
    })
    const store = new PromptsStore(scope)
    await store.load()
    const item = store.findById('greet')
    expect(item?.record.title).toBe('Greet')
    expect(store.findById('absent')).toBeUndefined()
  })
})
