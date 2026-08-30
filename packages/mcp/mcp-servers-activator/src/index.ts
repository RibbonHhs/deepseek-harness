/**
 * Host-side activator for the `mcp-servers` settings namespace. Reads the
 * section on startup and again on every `settings/updated` emission, then
 * reconciles: for every enabled entry, spawn one
 * `@deepseek-ai/dsh-mcp-client` plugin instance, disposed on disable.
 *
 * The schema is owned by `@deepseek-ai/dsh-client-ui-mcp-servers` (the
 * UI half registers it with `ctx.settings`). The activator only
 * observes — it does not register, since the namespace can only be
 * registered once across the loaded tree.
 *
 * Schema types are imported as `import type` so the activator does not
 * pull the UI runtime into the host bundle; the compiled JS has zero
 * reference to the ui-mcp-servers package.
 *
 * @module @deepseek-ai/dsh-mcp-servers-activator
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Side-effect: declaration-merges `ctx.tools` onto Context for this file.
import type {} from '@deepseek-ai/dsh-tools'
// Side-effect: the mcp-client plugin's namespace import provides `name`,
// `inject`, and an async `apply(ctx, config)`; `ctx.plugin(plugin, cfg)`
// accepts it directly. The compiled bundle inlines the symbol references,
// the workspace dep keeps the resolver honest.
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { McpServerRecord, McpServersSection, McpServerStatus } from '@deepseek-ai/dsh-client-ui-mcp-servers'

/** Settings namespace identifier. Same literal as the UI half registers. */
const MCP_SERVERS_NAMESPACE = settingsNamespace('mcp-servers')

/** Local copy of the runtime status type — keeps the activator free of UI-side dependencies. */
type StatusState = McpServerStatus['state']

/** Cordis plugin name. */
export const name = 'mcp-servers-activator'

/** Services required before reconciliation. */
export const inject = ['settings']

/**
 * Test-only: clear the module-scope `activeChildren` map. Production
 * never calls this — the activator's `activeChildren` lives as long as
 * the host process and only loses entries via `reconcile()`'s removal
 * pass. Tests need it because each test instantiates a fresh `Context`
 * but the module state persists across the file's `it` blocks.
 */
export function _resetActiveChildrenForTests(): void {
  for (const entry of activeChildren.values()) {
    void entry.fiber.dispose()
  }
  activeChildren.clear()
}

/** Live records: serverId → the mcp-client fiber spawned for it. */
interface ActiveChild {
  /** The cordis Fiber returned by `ctx.plugin(mcpClient, config)`. Its
     `dispose` tears down the mcp-client instance and detaches every effect. */
  fiber: { dispose: () => Promise<void> }
  /** The record that drove activation. Used to detect config-only edits
     that must trigger a re-spawn (cordis plugins can't re-apply config
     in place). */
  record: McpServerRecord
}
const activeChildren = new Map<string, ActiveChild>()

/**
 * Direct stderr logging. cordis's logger service has no stdout exporter
 * wired in this composition, so `ctx.logger(name).info(...)` is silently
 * dropped — write straight to stderr for guaranteed visibility during
 * activator diagnostics. Prefixed with the plugin name so logs from
 * multiple plugins interleave cleanly.
 */
function logf(level: 'info' | 'error', parent: Context, format: string, ...args: unknown[]): void {
  try {
    const msg = `[mcp-servers-activator] ${format}`
    // Tiny printf-style shim so we can reuse the existing format strings
    // without pulling in a dependency. `%s` / `%d` / `%o` only.
    let i = 0
    const rendered = msg.replace(/%([sdo])/g, (_match, kind) => {
      const v = args[i++]
      if (v === undefined) return ''
      if (kind === 's') return String(v)
      if (kind === 'd') return String(Math.trunc(Number(v)))
      return JSON.stringify(v)
    })
    process.stderr.write(`[mcp-servers-activator:${level}] ${rendered}\n`)
    // Best-effort: also forward to the cordis logger so structured
    // exporters (when one exists) see the same event.
    try {
      const l = (parent.logger as unknown as (name: string) => unknown)
      const named = l?.('mcp-servers-activator') as unknown as Record<string, ((f: string, ...a: unknown[]) => void) | undefined> | undefined
      named?.[level]?.(msg, ...args)
    } catch {
      // ignore — no structured exporter wired
    }
  } catch {
    // never let logging itself crash the plugin
  }
}

const info = (parent: Context) => (format: string, ...args: unknown[]) => logf('info', parent, format, ...args)
const err = (parent: Context) => (format: string, ...args: unknown[]) => logf('error', parent, format, ...args)

/**
 * Write one record's `status` block back into the settings namespace.
 * The activator owns this field; the UI reads it but never edits it
 * directly. Settings persists the value to disk, so the UI sees the
 * last-seen status across restarts (acceptable — the activator overwrites
 * it on the next reconcile).
 *
 * The write is best-effort: any error is logged but does not crash the
 * activator or block the lifecycle transition that triggered it.
 * @param parent - the host root context.
 * @param id - server id whose status is being written.
 * @param state - new lifecycle state.
 * @param error - error message; only meaningful for `state === 'failed'`.
 */
async function writeStatus(parent: Context, id: string, state: StatusState, error?: string): Promise<void> {
  try {
    const current = parent.settings.get(MCP_SERVERS_NAMESPACE) as McpServersSection | undefined
    const record = current?.[id]
    if (record === undefined) return
    const status: McpServerStatus = error === undefined
      ? { state, lastChangedAt: Date.now() }
      : { state, error, lastChangedAt: Date.now() }
    const next: McpServersSection = { ...current, [id]: { ...record, status } }
    await parent.settings.update(MCP_SERVERS_NAMESPACE, next)
  } catch (e) {
    process.stderr.write(`[mcp-servers-activator:error] failed to write status for "${id}": ${String(e)}\n`)
  }
}

/**
 * Read the current `mcp-servers` section and reconcile to the desired set.
 * Called once at startup and again on every `settings/updated` emission for
 * this namespace.
 * @param parent - the host root context.
 */
export function apply(parent: Context): void {
  const log = info(parent)
  const logErr = err(parent)

  log('loaded; reconciling initial state')

  // 1) Initial reconciliation: covers the case where settings.yaml already
  //    lists enabled entries before the activator loads.
  const initial = parent.settings.get(MCP_SERVERS_NAMESPACE) as McpServersSection | undefined
  const initialIds = Object.keys(initial ?? {})
  log('settings namespace has %d record(s): %s', initialIds.length, initialIds.join(', ') || '(none)')
  reconcile(parent, initial ?? {}, log, logErr)

  // 2) Subscribe to per-namespace updates. The handler is a plain
  //    `ctx.on` listener — `ctx.effect` would also work, but the listener
  //    shape here is a single async no-op, so the simpler form keeps the
  //    apply body tight.
  parent.on('settings/updated', (ns, next) => {
    if (ns !== MCP_SERVERS_NAMESPACE) return
    const nextIds = Object.keys((next ?? {}) as McpServersSection)
    log('settings/updated for mcp-servers; %d record(s): %s', nextIds.length, nextIds.join(', ') || '(none)')
    reconcile(parent, (next ?? {}) as McpServersSection, log, logErr)
  })
}

/**
 * Compute the desired set, dispose children that are no longer desired,
 * and spawn children for newly desired ids. A config edit (command, url,
 * env, headers, args) forces a re-spawn because cordis plugins bind their
 * config at apply time and have no in-place reload.
 * @param parent - the host root context.
 * @param current - latest section snapshot.
 * @param log - info log helper bound to the parent context.
 * @param logErr - error log helper bound to the parent context.
 */
function reconcile(parent: Context, current: McpServersSection, log: (fmt: string, ...args: unknown[]) => void, logErr: (fmt: string, ...args: unknown[]) => void): void {
  const desired = new Map<string, McpServerRecord>()
  for (const [id, record] of Object.entries(current)) {
    if (record.enabled && isValid(record)) {
      desired.set(id, record)
    } else if (record.enabled) {
      logErr('skipping "%s" — record failed validation (transport=%s)', id, record.transport)
    } else {
      // Disabled records still need a status entry so the UI shows
      // the "Disabled" badge immediately, not "Not yet connected".
      void writeStatus(parent, id, 'disabled')
    }
  }
  log('reconcile: desired=%d, active=%d', desired.size, activeChildren.size)

  // Remove: id missing from desired, no longer enabled, or failed validation.
  for (const [id, entry] of activeChildren) {
    if (!desired.has(id)) {
      log('stopping "%s"', id)
      void entry.fiber.dispose()
      activeChildren.delete(id)
      // Mark disabled in the record so the UI badge flips immediately.
      // We only flip if the record still exists (a parallel delete may
      // have removed it); missing-record cases leave no status to
      // overwrite.
      if ((current as McpServersSection)[id] !== undefined) {
        void writeStatus(parent, id, 'disabled')
      }
    }
  }

  // Add or replace: spawn a fresh child for each desired id. If we already
  // host one with the same config, skip — child contexts are not recreated
  // on idempotent reconciles.
  for (const [id, record] of desired) {
    const existing = activeChildren.get(id)
    if (existing && recordsEqual(existing.record, record)) {
      log('"%s" already running with same config; skip', id)
      continue
    }
    if (existing) {
      log('"%s" config changed; respawning', id)
      void existing.fiber.dispose()
      activeChildren.delete(id)
    }
    spawnChild(parent, id, record, log, logErr)
  }
}

/**
 * Apply the mcp-client plugin to the parent context. Errors are
 * contained to that fiber — they never bubble into the parent or
 * affect siblings. Failed children are removed from the active map
 * so a future edit (or a settings-side fix) can retry without a
 * process restart.
 * @param parent - the host root context.
 * @param id - storage key; fiber identity is purely internal.
 * @param record - the configured MCP server registration.
 * @param log - info log helper bound to the parent context.
 * @param logErr - error log helper bound to the parent context.
 */
function spawnChild(parent: Context, id: string, record: McpServerRecord, log: (fmt: string, ...args: unknown[]) => void, logErr: (fmt: string, ...args: unknown[]) => void): void {
  const config = buildConfig(record)
  log('spawning "%s" (transport=%s, url=%s)', id, record.transport, record.url ?? record.command ?? '?')

  // The activator's parent context reads the `mcp-servers` settings
  // namespace through `dsh-settings`, which freezes the resolved value
  // (`deepFreeze`) to keep user edits and component renders from
  // mutating shared state. The mcp-client schema iterates ownKeys when
  // validating the config; frozen objects carry non-enumerable hidden
  // metadata that schemastery's iteration picks up but that doesn't
  // appear in the schema's expected fields, so the union validation
  // fails with a generic "expected ... but got ..." error. A JSON
  // round-trip drops the hidden metadata while keeping the wire data
  // identical (the resolved value is plain JSON-compatible), so the
  // mcp-client validator accepts the round-tripped copy. The same
  // applies to the `record` itself when it passes through deeper
  // framework layers.
  //
  // Until schemastery gains a frozen-input skip or the settings seam
  // hands out a non-frozen resolved value for read-only consumers,
  // this round-trip is the only path that keeps both the freeze
  // invariant and the schema invariant alive.
  const cleanConfig: McpClientConfig = JSON.parse(JSON.stringify(config))

  // Status lifecycle: `pending` while the fiber is in flight, `connected`
  // once the apply resolves, `failed` if it rejects. The activator writes
  // the status back into the same record via `ctx.settings.update`, so
  // the existing settings transport carries it to the UI half — no new
  // wire channel needed. `recordsEqual` strips `status` so the status
  // write doesn't trigger a self-induced reconcile loop.
  void writeStatus(parent, id, 'pending')

  try {
    const fiber = parent.plugin(mcpClient, cleanConfig)
    activeChildren.set(id, { fiber, record })
    // `fiber.await()` resolves the wrapped Thenable, but it THROWS
    // when the fiber settled with `_error` (cordis's
    // `if (this._error) throw this._error` in the await() loop).
    // That throw lands in the second `then` slot, so a failed apply
    // shows up here — not in the success path. The `_error` check
    // is defense in depth: some lifecycle paths land on the success
    // slot but still leave `_error` set, and we want those to write
    // 'failed' too.
    void fiber.then(
      () => {
        const fiberErr = (fiber as unknown as { _error: unknown })._error
        if (fiberErr !== undefined) {
          const msg = fiberErr instanceof Error ? fiberErr.message : String(fiberErr)
          logErr('"%s" failed to start: %s', id, msg)
          void writeStatus(parent, id, 'failed', msg)
          activeChildren.delete(id)
          return
        }
        log('"%s" connected and tools registered', id)
        void writeStatus(parent, id, 'connected')
      },
      (failure: unknown) => {
        const msg = failure instanceof Error ? failure.message : String(failure)
        logErr('"%s" failed to start: %s', id, msg)
        void writeStatus(parent, id, 'failed', msg)
        activeChildren.delete(id)
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    logErr('"%s" threw on plugin() call: %s', id, msg)
  }
}

/**
 * Translate one settings-side record into the mcp-client config shape. The
 * discriminator is `transport`; both stdio and streamable-http require
 * their respective payload (command / url). isValid() runs first so we
 * know `command` / `url` are present here.
 * @param record - the configured MCP server registration.
 * @returns the mcp-client plugin config.
 */
function buildConfig(record: McpServerRecord): McpClientConfig {
  const common = {
    serverName: record.name,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
  if (record.transport === 'stdio') {
    return {
      ...common,
      transport: 'stdio' as const,
      command: record.command!,
      args: record.args ?? [],
      env: record.env ?? {},
      cwd: process.cwd(),
    }
  }
  return {
    ...common,
    transport: 'streamable-http' as const,
    url: record.url!,
    headers: record.headers ?? {},
  }
}

/**
 * Structural validity check. Same checks the UI half runs, mirrored here
 * so an externally-edited settings.yaml (or a host-side programmatic
 * write) can't smuggle a half-configured entry into the activator.
 * @param record - the configured MCP server registration.
 * @returns whether the activator should start an mcp-client for it.
 */
function isValid(record: McpServerRecord): boolean {
  if (!record.id || !record.name) return false
  if (record.transport === 'stdio') {
    return typeof record.command === 'string' && record.command.length > 0
  }
  if (record.transport === 'streamable-http') {
    return typeof record.url === 'string' && record.url.length > 0
  }
  return false
}

/**
 * Deep-equal check on the parts of the record that drive mcp-client
 * config. The `status` block is excluded because the activator writes
 * it back into settings — including it would make the activator see
 * its own status writes as a config change and respawn the fiber on
 * every transition. The settings namespace has a `~standard` validator
 * (not the mcp-client schema) so this relaxed equality is only ever
 * consulted by the activator's reconcile path.
 * @param a - one record snapshot.
 * @param b - another record snapshot.
 * @returns whether mcp-client config would be byte-identical.
 */
function recordsEqual(a: McpServerRecord, b: McpServerRecord): boolean {
  // Strip the runtime status block from both sides before comparing;
  // the activator is the sole writer of `status`, and including it would
  // defeat the idempotent-reconcile guarantee below.
  const { status: _a, ...aRest } = a
  const { status: _b, ...bRest } = b
  void _a; void _b
  return JSON.stringify(aRest) === JSON.stringify(bRest)
}
