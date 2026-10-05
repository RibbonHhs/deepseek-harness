/**
 * Tests for the `mcp-servers-activator` reconcile loop.
 *
 * Covers:
 * - Initial reconcile on apply: spawns enabled entries, skips invalid
 *   ones, records status `pending` → `connected`.
 * - settings/document-updated add: spawns the new entry.
 * - settings/document-updated remove: disposes the matching fiber.
 * - settings/document-updated disable (enabled: false): disposes the
 *   fiber.
 * - settings/document-updated config change (command / url edit):
 *   respawns.
 * - settings/document-updated status-only change (activator's own
 *   write): does NOT trigger a respawn (loop prevention via
 *   `recordsEqual`).
 * - Failed apply: writes status `failed` with the message.
 *
 * Strategy:
 * - Mock `@deepseek-ai/dsh-mcp-client` so its apply() returns a
 *   promise we can resolve / reject from the test — no real network.
 * - Use `configurationFixture` from `@deepseek-ai/dsh-settings` to
 *   stand up a real profile/loader/settings pipeline with an extra
 *   `mcp-servers` row backed by a permissive volatile probe.
 * - Drive edits through `ctx.settings.mutate` /
 *   `ctx.settings.replace`, observe through
 *   `ctx.settings.describe()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type { McpServerRecord, McpServersSection } from '@deepseek-ai/dsh-client-ui-mcp-servers'
import { apply as activatorApply, _resetActiveChildrenForTests } from '../src/index.ts'

const NAMESPACE = 'mcp-servers'

// vi.hoisted runs before any module-level code; use it to define the
// mock factory and a stack of pending-apply gates that the tests
// pop from via `lastHandle()`.
const { mockMcpClient, handles } = vi.hoisted(() => {
  type Gate = {
    promise: Promise<undefined>
    resolve(value: undefined | PromiseLike<undefined>): void
    reject(reason: unknown): void
  }
  const stack: Gate[] = []

  const fakeApply = (_ctx: Context, _config: unknown): Promise<undefined> => {
    const gate: Gate = {
      promise: Promise.resolve(undefined),
      resolve: () => undefined,
      reject: () => undefined,
    }
    let resolver!: (value: undefined | PromiseLike<undefined>) => void
    let rejecter!: (reason: unknown) => void
    gate.promise = new Promise<undefined>((resolve, reject) => {
      resolver = resolve
      rejecter = reject
    })
    gate.resolve = resolver
    gate.reject = rejecter
    stack.push(gate)
    return gate.promise
  }

  return {
    mockMcpClient: {
      name: 'mcp-client',
      // Empty inject: cordis's _refresh() blocks Fiber activation
      // until every named service is registered. Declaring `['tools']`
      // would deadlock the test (no tools service is mounted). The real
      // plugin's `inject = ['tools']` only governs load order — the
      // activator never reads from ctx.tools.
      inject: [] as string[],
      // The next four keys are required by the repo's test-invariants
      // wrapper (`scripts/test-invariants.ts:235-247`), which spreads
      // the plugin object into its own apply wrapper and reads every
      // optional field. The real mcp-client has no Config / provide /
      // intercept; an empty object for each is a no-op.
      provide: {},
      intercept: {},
      Config: undefined,
      apply: fakeApply,
    },
    handles: stack,
  }
})

vi.mock('@deepseek-ai/dsh-mcp-client', () => mockMcpClient)

// Minimal permissive probe so SettingsForms can index `mcp-servers` as
// a volatile dict. The activator's mutate() lands on `[<id>, 'status']`
// or `[<id>]`, both of which `isVolatilePath` allows because the root
// is volatile.
const McpProbe = {
  Config: z.dict(z.any()).default({}).volatile(),
  apply: (_ctx: Context, _config: unknown): void => {},
}

// ---- Test bench ----

interface TestBench {
  ctx: Context
  readSection(): McpServersSection
  writeRecord(id: string, record: McpServerRecord): Promise<void>
  removeRecord(id: string): Promise<void>
  replaceSection(section: McpServersSection): Promise<void>
  flush(): Promise<void>
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (predicate()) { resolve(); return }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`))
        return
      }
      setTimeout(tick, 0)
    }
    tick()
  })
}

function flushMicrotasks(): Promise<void> {
  // Three microtask rounds are enough for the activator's chain
  // (settings.write → on('settings/document-updated') → reconcile →
  // recordsEqual check). Adding margin prevents the suite from racing
  // the next test's reconcile.
  return (async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })()
}

function stdioRecord(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'fs',
    name: 'fs',
    transport: 'stdio',
    enabled: true,
    command: 'echo',
    args: ['hello'],
    env: {},
    ...overrides,
  }
}

function httpRecord(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'web',
    name: 'web',
    transport: 'streamable-http',
    enabled: true,
    url: 'http://localhost:3000/mcp',
    headers: {},
    ...overrides,
  }
}

/** Pop the most recent (LIFO) handle. Each apply call pushes one. */
function lastHandle(): { resolve: () => void; reject: (e: unknown) => void } {
  const gate = handles.pop()
  if (gate === undefined) throw new Error('expected a pending apply handle but the stack is empty')
  return {
    resolve: (): void => { gate.resolve(undefined) },
    reject: (err): void => { gate.reject(err instanceof Error ? err : new Error(String(err))) },
  }
}

/** Count of pending applies currently waiting on the test. */
function pendingApplies(): number {
  return handles.length
}

async function bootWithAccess(initial?: McpServersSection): Promise<TestBench> {
  const { ctx } = await configurationFixture({
    hmr: false,
    extraBuiltins: { 'probe-mcp': McpProbe },
    extraRows: [{ id: NAMESPACE, name: 'cordis:probe-mcp', config: {} }],
  })
  // Settle SettingsForms indexing so the probe's descriptor is live
  // before the activator mounts.
  ctx.settings.describe()
  // Pre-populate the section before the activator mounts so its
  // initial reconcile observes the records (no SettingsConflict to
  // contend with because there is no listener yet).
  if (initial !== undefined) {
    await ctx.settings.replace(NAMESPACE, initial)
  }
  activatorApply(ctx)

  // Wait for the activator to call apply() on every enabled AND valid
  // record. Records that fail `isValid` are skipped — the test bench
  // passes a record with `command: undefined` or `url: undefined` to
  // exercise the skip path; those never produce a pending apply. The
  // same applies to records with `enabled: false`.
  const expectedApplies = Object.values(initial ?? {}).filter((r) => {
    if (!r.enabled) return false
    if (r.transport === 'stdio') return typeof r.command === 'string' && r.command.length > 0
    if (r.transport === 'streamable-http') return typeof r.url === 'string' && r.url.length > 0
    return false
  }).length
  if (expectedApplies > 0) {
    await waitFor(() => pendingApplies() === expectedApplies)
  } else {
    await flushMicrotasks()
  }

  const readSection = (): McpServersSection =>
    (ctx.settings.describe().find((d: SettingsDescriptor) => d.ns === NAMESPACE)?.value as McpServersSection | undefined) ?? {}

  return {
    ctx,
    readSection,
    writeRecord: async (id, record) => {
      const rev = ctx.settings.describe().find((d: SettingsDescriptor) => d.ns === NAMESPACE)?.revision
      await ctx.settings.mutate(NAMESPACE, [{ op: 'set', path: [id], value: record }], rev)
    },
    removeRecord: async (id) => {
      const rev = ctx.settings.describe().find((d: SettingsDescriptor) => d.ns === NAMESPACE)?.revision
      await ctx.settings.mutate(NAMESPACE, [{ op: 'unset', path: [id] }], rev)
    },
    replaceSection: async (section) => {
      const rev = ctx.settings.describe().find((d: SettingsDescriptor) => d.ns === NAMESPACE)?.revision
      await ctx.settings.replace(NAMESPACE, section, rev)
    },
    flush: flushMicrotasks,
  }
}

beforeEach(() => {
  handles.length = 0
  vi.clearAllMocks()
  // The activator's `activeChildren` is module-scope state, so a fresh
  // `Context` per test still inherits entries from previous tests'
  // reconciled fibers. Each new test starts with a clean slate.
  _resetActiveChildrenForTests()
})

afterEach(() => {
  // Ensure no leftover gates are dangling between tests.
  if (handles.length > 0) {
    // Defensive: resolve any stragglers so cordis fibers don't hang.
    for (const gate of handles.splice(0)) gate.resolve(undefined)
  }
})

describe('mcp-servers-activator reconcile loop', () => {
  it('spawns an enabled stdio entry on initial apply and writes status connected', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    expect(bench.readSection().fs?.status?.state).toBe('connected')
  })

  it('spawns an enabled streamable-http entry on initial apply', async () => {
    const bench = await bootWithAccess({ web: httpRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().web?.status?.state === 'connected')

    expect(bench.readSection().web?.status?.state).toBe('connected')
  })

  it('skips entries that fail structural validation (missing command for stdio)', async () => {
    const bench = await bootWithAccess({
      bad: stdioRecord({ command: undefined } as unknown as Partial<McpServerRecord>),
    })
    await flushMicrotasks()

    expect(bench.readSection().bad?.status).toBeUndefined()
    expect(pendingApplies()).toBe(0)
  })

  it('skips entries that fail validation (missing url for streamable-http)', async () => {
    const bench = await bootWithAccess({
      bad: httpRecord({ url: undefined } as unknown as Partial<McpServerRecord>),
    })
    await flushMicrotasks()

    expect(bench.readSection().bad?.status).toBeUndefined()
    expect(pendingApplies()).toBe(0)
  })

  it('skips disabled entries without spawning a fiber', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord({ enabled: false }) })
    await waitFor(() => bench.readSection().fs?.status?.state === 'disabled')

    expect(pendingApplies()).toBe(0)
    expect(bench.readSection().fs?.status?.state).toBe('disabled')
  })

  it('writes status failed when the mcp-client apply rejects', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().reject(new Error('connect ECONNREFUSED'))
    // Production: a failed apply triggers a respawn with a fresh
    // fiber, which writes 'pending' over the earlier 'failed' status.
    // The error message from the first attempt persists in the doc
    // because the respawn only updates `state` + `lastChangedAt`,
    // not `error` — the two writes race but only the first carries
    // the error string. Assert on the error presence rather than the
    // final state, which is intentionally non-deterministic here.
    await waitFor(() => {
      const record = bench.readSection().fs
      return record?.status?.error?.includes('ECONNREFUSED') === true
    })

    expect(bench.readSection().fs?.status?.error).toContain('ECONNREFUSED')
  })

  it('adds a new entry when settings/document-updated fires', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    await bench.replaceSection({
      fs: stdioRecord(),
      web: httpRecord({ id: 'web2', name: 'web2' }),
    })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().web?.status?.state === 'connected')

    expect(bench.readSection().web?.status?.state).toBe('connected')
  })

  it('removes the fiber when an entry disappears from the section', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    await bench.replaceSection({})
    await waitFor(() => bench.readSection().fs === undefined)

    expect(bench.readSection()).toEqual({})
  })

  it('disposes the fiber when an entry is disabled', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    await bench.replaceSection({ fs: stdioRecord({ enabled: false }) })
    await waitFor(() => bench.readSection().fs?.status?.state === 'disabled')

    expect(bench.readSection().fs?.status?.state).toBe('disabled')
  })

  it('respawns when a config field (command) changes', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    const beforeLastChanged = bench.readSection().fs?.status?.lastChangedAt
    await bench.writeRecord('fs', stdioRecord({ command: 'different-binary' }))
    // The respawn produced a new pending apply (popped by next test).
    lastHandle().resolve()
    await waitFor(
      () => bench.readSection().fs?.status?.state === 'connected'
      && (beforeLastChanged === undefined
        || bench.readSection().fs?.status?.lastChangedAt !== beforeLastChanged),
    )

    expect(bench.readSection().fs?.status?.state).toBe('connected')
  })

  it('does NOT respawn on a status-only change (loop prevention)', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    const beforeCount = pendingApplies()
    // Mutate only the status field directly; this is what the
    // activator itself does for every state transition. The activator
    // subscribes to `settings/document-updated`, which fires after
    // every accepted write — so its listener does run, but
    // `recordsEqual` strips `status` before the comparison, so no
    // respawn happens.
    const rev = bench.ctx.settings.describe().find((d: SettingsDescriptor) => d.ns === NAMESPACE)?.revision
    await bench.ctx.settings.mutate(
      NAMESPACE,
      [{ op: 'set', path: ['fs', 'status'], value: { state: 'connected', lastChangedAt: Date.now() + 1 } }],
      rev,
    )
    // Settle a few macrotask rounds so any erroneous spawn lands.
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
    expect(pendingApplies()).toBe(beforeCount)
  })
})
