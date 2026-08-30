// @vitest-environment jsdom
/**
 * McpServersStore behavior over a stubbed settings scope. The wire
 * face is a plain object that captures writes; the mirror is bypassed
 * to keep the test focused on store-level invariants.
 *
 * Coverage:
 * - schema validation (id pattern, transport-required fields, disabled
 *   records, enable conflict detection)
 * - CRUD over `settingsScope.set / unset` with the right field paths
 * - status field round-trips through the store unchanged
 * - `filtered` honors `enabled` and the search query
 */
import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { McpServersStore } from '../src/client/store.ts'
import type { McpServersSection, McpServerRecord } from '../src/schema.ts'

/** A scope that captures writes and mirrors them into a snapshot. */
function buildScope(initial: McpServersSection = {}): SettingsScope<McpServersSection> & {
  writes: { op: 'set' | 'unset'; field: string; value?: unknown }[]
} {
  const writes: { op: 'set' | 'unset'; field: string; value?: unknown }[] = []
  let section: McpServersSection = { ...initial }
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
      section = { ...section, [field]: value as McpServersSection[string] }
      for (const fn of [...listeners]) fn()
    },
    async unset(field: string) {
      writes.push({ op: 'unset', field })
      const next: McpServersSection = { ...section }
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

function stdioFixture(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'fs',
    name: 'Filesystem',
    transport: 'stdio',
    enabled: true,
    command: 'echo',
    args: ['hello'],
    env: {},
    ...overrides,
  }
}

function httpFixture(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'web',
    name: 'Web',
    transport: 'streamable-http',
    enabled: true,
    url: 'http://localhost:3000/mcp',
    headers: {},
    ...overrides,
  }
}

describe('McpServersStore', () => {
  it('loads an initial section through the bound scope', async () => {
    const scope = buildScope({ fs: stdioFixture(), web: httpFixture() })
    const store = new McpServersStore(scope)
    await store.load()

    expect(store.findById('fs')?.command).toBe('echo')
    expect(store.findById('web')?.url).toBe('http://localhost:3000/mcp')
    expect(store.findById('missing')).toBeUndefined()
  })

  it('create() writes one set() call with the full record', async () => {
    const scope = buildScope()
    const store = new McpServersStore(scope)
    await store.load()

    const rec = stdioFixture({ id: 'new-fs', name: 'New FS' })
    await store.create('new-fs', rec)

    expect(scope.writes).toHaveLength(1)
    expect(scope.writes[0]).toEqual({ op: 'set', field: 'new-fs', value: rec })
  })

  it('update() writes the same record shape as create()', async () => {
    const scope = buildScope({ fs: stdioFixture() })
    const store = new McpServersStore(scope)
    await store.load()

    const updated = stdioFixture({ command: 'different-binary' })
    await store.update('fs', updated)

    expect(scope.writes).toEqual([{ op: 'set', field: 'fs', value: updated }])
  })

  it('remove() writes one unset() call', async () => {
    const scope = buildScope({ fs: stdioFixture() })
    const store = new McpServersStore(scope)
    await store.load()

    await store.remove('fs')

    expect(scope.writes).toEqual([{ op: 'unset', field: 'fs' }])
    expect(store.findById('fs')).toBeUndefined()
  })

  it('setEnabled() only writes when the flag actually changes', async () => {
    const scope = buildScope({ fs: stdioFixture({ enabled: true }) })
    const store = new McpServersStore(scope)
    await store.load()

    // No-op when value already matches.
    await store.setEnabled('fs', true)
    expect(scope.writes).toEqual([])

    // Real change goes through update() with the merged record.
    await store.setEnabled('fs', false)
    expect(scope.writes).toHaveLength(1)
    expect(scope.writes[0]?.op).toBe('set')
    expect(scope.writes[0]?.field).toBe('fs')
    expect((scope.writes[0]?.value as McpServerRecord).enabled).toBe(false)
    // Original fields preserved on the merged record.
    expect((scope.writes[0]?.value as McpServerRecord).command).toBe('echo')
  })

  it('status field round-trips through the store unchanged', async () => {
    const scope = buildScope()
    const store = new McpServersStore(scope)
    await store.load()

    const record = httpFixture()
    const status = {
      state: 'connected' as const,
      lastChangedAt: 1234567890,
    }
    record.status = status
    await store.create('web', record)

    // Re-read what the activator (or anything else) wrote: status must
    // survive the round-trip without being dropped.
    const stored = (scope.writes[0]?.value as McpServerRecord).status
    expect(stored).toEqual(status)
  })

  it('update() preserves the existing status block if not overwritten', async () => {
    const scope = buildScope({
      web: { ...httpFixture(), status: { state: 'connected', lastChangedAt: 100 } },
    })
    const store = new McpServersStore(scope)
    await store.load()

    const updated: McpServerRecord = httpFixture({ url: 'http://other/mcp' })
    // Caller doesn't include status in the new payload — store
    // preserves the prior status block on the merged record.
    await store.update('web', updated)

    const stored = scope.writes[0]?.value as McpServerRecord
    expect(stored.url).toBe('http://other/mcp')
    expect(stored.status).toEqual({ state: 'connected', lastChangedAt: 100 })
  })

  it('filtered() drops disabled records from the visible list', async () => {
    const scope = buildScope({
      fs: stdioFixture({ enabled: true }),
      hidden: stdioFixture({ id: 'hidden', enabled: false }),
    })
    const store = new McpServersStore(scope)
    await store.load()

    const filtered = store.filtered()
    expect(filtered.map(i => i.id)).toEqual(['fs'])
  })

  it('filtered() honors the search query against id, name, description', async () => {
    const scope = buildScope({
      fs: stdioFixture(),
      web: httpFixture({ id: 'web' }),
    })
    const store = new McpServersStore(scope)
    await store.load()

    store.setQuery('FS')
    expect(store.filtered().map(i => i.id)).toEqual(['fs'])

    store.setQuery('localhost')
    expect(store.filtered().map(i => i.id)).toEqual(['web'])

    store.setQuery('zzz')
    expect(store.filtered()).toEqual([])
  })

  it('validate() rejects records with invalid id, name, or transport', async () => {
    const scope = buildScope()
    const store = new McpServersStore(scope)
    await store.load()

    // Bad id (uppercase).
    const r1 = httpFixture({ id: 'BadCase' })
    expect(store.validate({ id: r1.id, record: r1 })).toEqual({ ok: false, error: 'id' })

    // Empty name.
    const r2 = httpFixture({ name: '' })
    expect(store.validate({ id: r2.id, record: r2 })).toEqual({ ok: false, error: 'name' })

    // Missing command for stdio.
    const r3 = stdioFixture()
    delete (r3 as { command?: string }).command
    expect(store.validate({ id: r3.id, record: r3 })).toEqual({ ok: false, error: 'command' })

    // Missing url for streamable-http.
    const r4 = httpFixture()
    delete (r4 as { url?: string }).url
    expect(store.validate({ id: r4.id, record: r4 })).toEqual({ ok: false, error: 'url' })

    // Id collision on create.
    const scope2 = buildScope({ fs: stdioFixture() })
    const store2 = new McpServersStore(scope2)
    await store2.load()
    expect(store2.validate({ id: 'fs', record: httpFixture({ id: 'fs' }) }, false))
      .toEqual({ ok: false, error: 'id' })

    // Update flow does not flag id collisions.
    expect(store2.validate({ id: 'fs', record: httpFixture({ id: 'fs' }) }, true))
      .toEqual({ ok: true, error: null })

    // Valid record passes.
    expect(store.validate({ id: 'good', record: httpFixture({ id: 'good' }) }))
      .toEqual({ ok: true, error: null })
  })
})
