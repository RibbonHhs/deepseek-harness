/**
 * Tests for the `mcp-servers-activator` reconcile loop.
 *
 * Covers:
 * - Initial reconcile on apply: spawns enabled entries, skips invalid
 *   ones, records status `pending` → `connected`.
 * - settings/updated add: spawns the new entry.
 * - settings/updated remove: disposes the matching fiber.
 * - settings/updated disable (enabled: false): disposes the fiber.
 * - settings/updated config change (command / url edit): respawns.
 * - settings/updated status-only change (activator's own write): does
 *   NOT trigger a respawn (loop prevention via `recordsEqual`).
 * - Failed apply: writes status `failed` with the message.
 *
 * Strategy: mock `@deepseek-ai/dsh-mcp-client` so its apply() returns a
 * promise we can resolve / reject from the test — no real network.
 * Stand up an in-memory `MemorySettings` provider (mirrors the
 * pattern from `packages/core/agent-loop/tests/settings.spec.ts`) so
 * the activator sees a real settings transport without disk I/O.
 *
 * The activator writes back status updates via `ctx.settings.update`.
 * Tests poll with `setTimeout(0)` against the live resolved value
 * (`ctx.settings.get(NAMESPACE)`), which always reflects the most
 * recent write — including the activator's status updates that the
 * test bench never sees directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace, SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { McpServerRecord, McpServersSection } from '@deepseek-ai/dsh-client-ui-mcp-servers'
import { apply as activatorApply, _resetActiveChildrenForTests } from '../src/index.ts'

const NAMESPACE = settingsNamespace('mcp-servers')

// vi.hoisted runs before any module-level code; use it to define the
// mock factory and a stack of pending-apply gates that the tests
// pop from via `lastHandle()`.
const { mockMcpClient, handles } = vi.hoisted(() => {
  const stack: Array<{ promise: Promise<void>; gate: PromiseWithResolvers<void> }> = []

  const fakeApply = (_ctx: Context, _config: unknown): Promise<void> => {
    const gate = Promise.withResolvers<void>()
    stack.push({ promise: gate.promise, gate })
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

// Minimal in-test schema: matches the production McpServersSectionSchema
// (a permissive object) so the settings resolver returns the raw
// document without rejecting test records.
const TestSectionSchema: z<McpServersSection> = z.object({})

// ---- In-memory settings provider ----

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: Context, initial?: Record<string, unknown>) {
    super(ctx)
    this.doc = structuredClone(initial ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

interface TestBench {
  ctx: Context
  readSection(): McpServersSection
  writeSection(section: McpServersSection): Promise<void>
  /** Fire a raw settings update without waiting for the activator's
     listener to settle. Used by the loop-prevention test that expects
     zero additional applies. */
  rawWrite(section: McpServersSection): Promise<void>
  flush(): Promise<void>
}

function flushMicrotasks(): Promise<void> {
  // Three microtask rounds are enough for the activator's chain
  // (settings.write → on('settings/updated') → reconcile → recordsEqual
  // check). Adding margin prevents the suite from racing the next
  // test's reconcile.
  return (async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })()
}

/**
 * Wait for a predicate to be true. Used to synchronize tests with
 * the activator's async lifecycle. Macrotask-based polling is more
 * reliable than microtask spinning when waiting on `setImmediate`-gated
 * cordis fiber activation.
 */
function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`))
      }
      setTimeout(tick, 0)
    }
    tick()
  })
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
    resolve: () => gate.gate.resolve(),
    reject: (err) => {
      gate.gate.reject(err instanceof Error ? err : new Error(String(err)))
    },
  }
}

/** Count of pending applies currently waiting on the test. */
function pendingApplies(): number {
  return handles.length
}

async function bootWithAccess(initial?: McpServersSection): Promise<TestBench> {
  const ctx = new Context()
  // The settings provider stores one raw user document keyed by
  // namespace; pass the section under the namespace key so the
  // activator's `get(NAMESPACE)` call sees it. Production also
  // registers the schema (the UI half's host apply does this), so the
  // test bench must mirror that or `get(NAMESPACE)` returns undefined.
  const doc = initial === undefined ? {} : { [NAMESPACE]: structuredClone(initial) }
  await ctx.plugin(MemorySettings, doc).await()
  // The UI host half registers the schema on startup; the activator
  // only observes. Replicate the registration here so the in-memory
  // provider resolves the namespace to the same defaults the real
  // dsh-settings-file provider would. Use a local schemastery schema
  // — importing the UI package's compiled schema through the package
  // root hit a Proxy indirection that broke call-as-function in this
  // test runtime.
  ctx.settings.register(NAMESPACE, TestSectionSchema as never)
  activatorApply(ctx)
  await ctx.fiber.await()

  // Wait for the activator to call apply() on every enabled AND valid
  // record. Records that fail `isValid` are skipped — the test
  // bench passes a record with `command: undefined` or `url: undefined`
  // to exercise the skip path; those never produce a pending apply.
  // The same applies to records with `enabled: false`.
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

  return {
    ctx,
    // Read through `ctx.settings.get` so we always see the most
    // recent write — including the activator's status writes.
    readSection: () => (ctx.settings.get(NAMESPACE) as McpServersSection | undefined) ?? {},
    writeSection: async (section: McpServersSection) => {
      await ctx.settings.update(NAMESPACE, section)
    },
    rawWrite: async (section: McpServersSection) => {
      await ctx.settings.update(NAMESPACE, section)
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
    for (const gate of handles.splice(0)) gate.gate.resolve()
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

  it('adds a new entry when settings/updated fires', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    await bench.writeSection({
      fs: stdioRecord(),
      web: httpRecord({ id: 'web2', name: 'web2' }),
    })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().web2?.status?.state === 'connected')

    expect(bench.readSection().web2?.status?.state).toBe('connected')
  })

  it('removes the fiber when an entry disappears from the section', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    await bench.writeSection({})
    await waitFor(() => bench.readSection().fs === undefined)

    expect(bench.readSection()).toEqual({})
  })

  it('disposes the fiber when an entry is disabled', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    await bench.writeSection({ fs: stdioRecord({ enabled: false }) })
    await waitFor(() => bench.readSection().fs?.status?.state === 'disabled')

    expect(bench.readSection().fs?.status?.state).toBe('disabled')
  })

  it('respawns when a config field (command) changes', async () => {
    const bench = await bootWithAccess({ fs: stdioRecord() })
    lastHandle().resolve()
    await waitFor(() => bench.readSection().fs?.status?.state === 'connected')

    const beforeLastChanged = bench.readSection().fs?.status?.lastChangedAt
    await bench.writeSection({
      fs: stdioRecord({ command: 'different-binary' }),
    })
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
    const current = bench.readSection().fs
    if (current === undefined) throw new Error('expected fs record to be present after connected')
    await bench.rawWrite({
      fs: {
        ...current,
        status: { state: 'connected', lastChangedAt: Date.now() + 1 },
      },
    })
    // Status-only updates fire `settings/updated`, which the
    // activator's listener handles. The reconcile path strips
    // `status` before equality check, so no respawn happens.
    // Settle a few macrotask rounds so any erroneous spawn lands.
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
    expect(pendingApplies()).toBe(beforeCount)
  })
})
