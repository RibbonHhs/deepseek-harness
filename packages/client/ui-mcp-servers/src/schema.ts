/**
 * Wire schemas for the MCP server registry. The `mcp-servers` settings
 * namespace is a map of stable server-id to {@link McpServerRecord}; ids
 * are user-chosen kebab-case identifiers (used as the cordis plugin name
 * suffix by the host activator), separate from the human-readable display
 * name shown in the settings list and the tool prefix registered with
 * `ctx.tools`.
 *
 * One `McpServerRecord` carries the transport (stdio or streamable-http),
 * its transport-specific payload (command + args + env, or url + headers),
 * the enabled flag, and an optional description. The host-side
 * `@deepseek-ai/dsh-mcp-servers-activator` reads this namespace and
 * instantiates a `@deepseek-ai/dsh-mcp-client` plugin per enabled entry;
 * this schema is therefore the single source of truth both halves agree on.
 *
 * The schema is additive: every field except `id` / `transport` has a
 * schema default, so an older settings document reads back through the
 * current schema without losing entries.
 * @module @deepseek-ai/dsh-client-ui-mcp-servers
 */

import z from '@deepseek-ai/schemastery'

/** Wire-level enum: which MCP transport the server speaks. */
export type McpTransport = 'stdio' | 'streamable-http'

/**
 * Live runtime status of one MCP server registration. Written by the
 * activator (`@deepseek-ai/dsh-mcp-servers-activator`) on lifecycle
 * transitions; the UI half reads it back through the same scope.
 * Lives INSIDE the `mcp-servers` record so the existing settings
 * transport carries it without a new wire channel — the trade-off is
 * that the value survives a restart (showing "last seen: connected at
 * 14:02" until the new boot re-establishes).
 */
export type McpServerState = 'pending' | 'connected' | 'failed' | 'disabled'

/** Wire shape of one stored MCP server's runtime status block. */
export interface McpServerStatus {
  /** Lifecycle phase: `pending` while the activator's fiber is in flight;
     `connected` after the initial apply resolves; `failed` after the
     apply rejects (the optional `error` field carries the message);
     `disabled` when the settings record is set to `enabled: false` or
     removed (the activator torn down the fiber). */
  state: McpServerState
  /** Last activation error message; only present when `state === 'failed'`. */
  error?: string
  /** Wall-clock ms when the status was last written. */
  lastChangedAt: number
}

/** Wire shape of one stored MCP server registration. */
export interface McpServerRecord {
  /** Stable kebab-case id (the storage key). Immutable after create. */
  id: string
  /** Human-readable display name; surfaces in the settings list and the
     `mcp__<name>__<tool>` tool prefix the activator registers. */
  name: string
  /** Which MCP transport this server speaks. */
  transport: McpTransport
  /** Whether the activator should start this server on load and on edits. */
  enabled: boolean
  /** Optional long-form description shown in the editor and the row tooltip. */
  description?: string
  // stdio-only fields
  /** stdio: command executable (e.g. `npx`). Required when transport=stdio. */
  command?: string
  /** stdio: positional arguments passed to `command`. */
  args?: string[]
  /** stdio: environment variables injected into the child process. */
  env?: Record<string, string>
  // streamable-http-only fields
  /** streamable-http: endpoint URL. Required when transport=streamable-http. */
  url?: string
  /** streamable-http: HTTP headers sent on every request. */
  headers?: Record<string, string>
  /** Live runtime status; written by the activator, read by the UI. */
  status?: McpServerStatus
}

/** Wire shape of the full `mcp-servers` settings namespace: id → record. */
export interface McpServersSection {
  [serverId: string]: McpServerRecord
}

/** Schema for one MCP server record stored under the `mcp-servers` namespace. */
export const McpServerRecordSchema: z<McpServerRecord> = z.object({
  id: z.string(),
  name: z.string().default(''),
  transport: z.union([z.const('stdio'), z.const('streamable-http')]),
  enabled: z.boolean().default(true),
  description: z.string().default(''),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  env: z.object({}).default({}),
  url: z.string().default(''),
  headers: z.object({}).default({}),
  status: z.object({
    state: z.union([z.const('pending'), z.const('connected'), z.const('failed'), z.const('disabled')]),
    error: z.string().default(''),
    lastChangedAt: z.number().default(0),
  }).default({ state: 'pending', error: '', lastChangedAt: 0 }),
})

/** Schema for the full `mcp-servers` settings namespace: id → record. */
export const McpServersSectionSchema: z<McpServersSection> = z.object({})

/**
 * Brand a user-supplied server id. Lowercase kebab-case, must start with a
 * letter, 1..64 chars long. The activator uses the id as a cordis plugin
 * name suffix (`mcp-client:<id>`); reusing this brand keeps id collisions
 * off the host side.
 * @param value - candidate id.
 * @returns the branded id.
 */
export function mcpServerId(value: string): string {
  const trimmed = value.trim()
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(trimmed)) {
    throw new TypeError(`mcp server id "${value}" must be lowercase kebab-case, 1..64 chars, starting with a letter`)
  }
  return trimmed
}

/** An MCP server id pattern — used by the UI for inline validation messages. */
export const MCP_SERVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Validate a single record structurally. Pure function: returns `{ ok, error }`
 * where `error` is one of `'id' | 'name' | 'command' | 'url' | null`. The UI
 * surfaces the error inline next to the offending field; the store skips
 * writes for `ok === false`.
 * @param record - candidate record (already normalized by the schema).
 * @returns validation outcome.
 */
export function validateMcpServerRecord(record: McpServerRecord): { ok: boolean; error: 'id' | 'name' | 'command' | 'url' | null } {
  if (!MCP_SERVER_ID_PATTERN.test(record.id)) return { ok: false, error: 'id' }
  if (record.name.trim().length === 0) return { ok: false, error: 'name' }
  if (record.transport === 'stdio' && (record.command ?? '').trim().length === 0) {
    return { ok: false, error: 'command' }
  }
  if (record.transport === 'streamable-http' && (record.url ?? '').trim().length === 0) {
    return { ok: false, error: 'url' }
  }
  return { ok: true, error: null }
}
