/**
 * Wire schemas for the prompt library. The `prompts` settings namespace is
 * a map of stable prompt-id to {@link PromptRecord}; ids are user-chosen
 * kebab-case identifiers (the storage key), separate from the human-readable
 * title used for list rendering.
 *
 * A `PromptRecord` carries the human title, body template, tag list, optional
 * description, and timestamps. The body template may contain `{{var}}`
 * placeholders; the manager UI surfaces detected variables in a preview pane
 * and the picker expands a chosen prompt with caller-supplied values.
 *
 * The schema is deliberately additive: every field except `id`/`body` has a
 * schema default, so an older settings document reads back through the
 * current schema without losing entries.
 * @module @deepseek-ai/dsh-client-ui-prompt-manager
 */

import z from '@deepseek-ai/schemastery'

/** Schema for one prompt record stored under the `prompts` namespace. */
export const PromptRecord: z<PromptRecord> = z.object({
  /** Human-readable title rendered in the prompt list and picker. */
  title: z.string().default(''),
  /** Template body. May contain `{{var}}` placeholders. Required. */
  body: z.string(),
  /** Optional long-form description shown in the picker detail. */
  description: z.string().default(''),
  /** Tags for grouping and filtering. Each tag is a non-empty trimmed string. */
  tags: z.array(z.string()).default([]),
  /** Creation timestamp in ms since epoch. Set by the manager; not user-edited. */
  createdAt: z.number().default(0),
  /** Last-modified timestamp in ms since epoch. Bumped by every mutating action. */
  updatedAt: z.number().default(0),
})

/** Wire shape of one stored prompt. */
export interface PromptRecord {
  title: string
  body: string
  description: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** Schema for the full `prompts` settings namespace: prompt-id → record. */
export const PromptSection: z<PromptSection> = z.object({})

/** Wire shape of the `prompts` settings namespace section. */
export interface PromptSection {
  [promptId: string]: PromptRecord
}

/**
 * Brand a user-supplied prompt id. Lowercase kebab-case, must start with a
 * letter, and 1..64 chars long. The same constraints apply to settings
 * namespaces but here the brand is local to the plugin — namespace
 * conventions are stricter than what a prompt id actually needs.
 * @param value - candidate id.
 * @returns the branded id.
 */
export function promptId(value: string): string {
  const trimmed = value.trim()
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(trimmed)) {
    throw new TypeError(`prompt id "${value}" must be lowercase kebab-case, 1..64 chars, starting with a letter`)
  }
  return trimmed
}

/** A prompt id pattern — used by the UI for inline validation messages. */
export const PROMPT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/**
 * A variable name referenced by a prompt body. The manager extracts every
 * `{{var}}` placeholder from a body and surfaces them so the picker can
 * prompt for values before insertion.
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g

/**
 * Collect the distinct variable names referenced by a template body, in the
 * order they first appear. The list is the input to the picker dialog when
 * the chosen prompt has unfilled placeholders.
 * @param body - the prompt template body.
 * @returns ordered, distinct placeholder names.
 */
export function collectVariables(body: string): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    ordered.push(name)
  }
  return ordered
}

/**
 * Render a prompt template body by substituting `{{var}}` placeholders. An
 * absent variable renders as the empty string (the caller may want to keep
 * a vestigial `{{var}}` to highlight an unfilled slot — the picker shows
 * which variables were not provided). Unknown placeholder names are left
 * verbatim so the user can spot typos.
 * @param body - the prompt template body.
 * @param values - variable values keyed by placeholder.
 * @returns the rendered text.
 */
export function interpolate(body: string, values: Record<string, string>): string {
  return body.replace(VARIABLE_PATTERN, (match, rawName: string) => {
    const name = rawName.trim()
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name] ?? ''
    return match
  })
}
