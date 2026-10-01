# `@deepseek-ai/dsh-client-ui-prompt-manager`

English | [中文](README.zh.md)

A reusable prompt library plugin for the DeepSeek Harness web client. Stores prompts as a section of the `prompts` settings namespace (file-backed through `dsh-settings-file`), exposes a CRUD page under the Settings sidebar, and adds a one-click "Insert prompt" button next to every composer.

## Features

- **CRUD** — create, edit, delete prompts with title, body, description, and tags.
- **Search & tag filter** — full-text search across title/body/description/tags, plus an "All / tag / tag" pill row.
- **Variable interpolation** — bodies may include `{{variable}}` placeholders. The editor shows detected variables and previews the rendered output; the picker prompts for values before insertion.
- **One-click composer insert** — an accessory button on the composer opens a picker that writes the rendered prompt into the draft through `inputActions.setDraft`.

## Architecture

The plugin follows the standard two-half shape:

| Half | File | Responsibility |
|---|---|---|
| Host (Node) | `src/index.ts` | Registers the `prompts` settings namespace on `ctx.settings`. |
| Client (browser) | `src/client/index.ts` | Wires the `PromptsSection` (settings UI) and `PromptInsertButton` (composer accessory), sharing one `PromptsStore`. |

Persistence is automatic: every CRUD action calls `settingsScope.set(id, record)` / `settingsScope.unset(id)`, which `dsh-settings-file` writes through to `settings.yaml` on disk.

## Integration

Add the package to your profile's `cordis.yml` and rebuild the bundle:

```yaml
- id: ui-prompt-manager
  name: '@deepseek-ai/dsh-client-ui-prompt-manager'
```

Two surfaces activate automatically:

- **Settings → Prompts** — a new entry in the Settings sidebar.
- **Composer accessory** — a "Prompts" button on the right side of every composer row.

The plugin declares both slots through `ctx.slots.inject(...)`, so it loads after `ui-settings` and `ui-conversation` declare their respective seats. Apply order between sibling feature plugins is unconstrained.

## Storage shape

The `prompts` namespace section is a map of kebab-case id → record:

```yaml
prompts:
  code-review:
    title: Code review
    description: Concise review checklist
    body: |
      Review the following diff for {{language}}. Highlight:
      - correctness
      - error handling
      - test coverage
    tags: [review, lint]
    createdAt: 1718900000000
    updatedAt: 1718900123000
  summarize:
    title: Summarize
    body: Summarize the following text in {{length}} bullet points.
    description: ''
    tags: []
    createdAt: 1718900050000
    updatedAt: 1718900050000
```

## Variable interpolation

- Placeholders use the form `{{name}}`; whitespace around the name is allowed.
- `collectVariables(body)` returns the distinct names in first-appearance order.
- `interpolate(body, values)` substitutes; absent values render as empty string, unknown names are preserved verbatim so the user can spot typos.
- The picker refuses Insert while any required variable has an empty value.

## Local development

```sh
# Build the bundle (produces lib/client.js)
pnpm --filter @deepseek-ai/dsh-client-ui-prompt-manager bundle

# Run the GUI test lane (component specs)
pnpm run test:gui
```