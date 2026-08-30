# Integration Steps

> [中文](INTEGRATION.zh.md)

This document describes the exact steps required to drop the
`prompt-manager` package into a working dsh web monorepo. The package
was authored against the `packages/client/ui-settings-models` template;
the steps mirror that package's footprint.

## 1. Copy the package

Place the contents of `ui-prompt-manager/` at
`<monorepo>/packages/client/ui-prompt-manager/`.

The package name uses the `@deepseek-ai/dsh-client-*` convention that
the client-package linter checks.

## 2. Verify tsconfig references

**No aggregate config to touch** — `pnpm-workspace.yaml`'s
`packages/*/*` glob already picks up `packages/client/ui-prompt-manager/`
automatically; `pnpm install` will wire the links.

The package's own `tsconfig.json` already lists every workspace
dependency it pulls in (`runtime`, `ui-settings`, `ui-conversation`,
`ui-slots`, `ui-primitives`, `locale`, `runtime-diagnostics/invariants`,
plus `api/remotes`'s `tsconfig.client.json` sub-reference). After
copying the package in, this step is done.

> If you later add another upstream dependency, mirror it in
> `tsconfig.json`'s `references` array and run `pnpm install`.

## 3. Register in the client aggregate tsconfig

The new package must be listed in the root `tsconfig.client.json`
`references` array — otherwise `tsc -b tsconfig.client.json` never
compiles it, `lib/types/{index,invariant}.js` is never produced, and
the subsequent `tsdown` run fails with
`UNRESOLVED_ENTRY Cannot resolve entry module lib/types/...`.

Add the row to `tsconfig.client.json`'s `references` block (alphabetical
order — between `ui-plan` and `ui-settings-plugins`):

```jsonc
{ "path": "./packages/client/ui-prompt-manager" },
```

## 4. Bundle patch

Open `packages/bundle/web-app/cordis.patch.yml` and add the row inside
the `browser plugin roster` `insert:` block (right after the existing
`ui-settings-*` and `ui-conversation` rows):

```yaml
- id: ui-prompt-manager
  name: '@deepseek-ai/dsh-client-ui-prompt-manager'
```

The row's order is not load-sensitive — both target slots are reached
via `slots.inject`, so the loader resolves everything through declared
services, not file order.

## 5. Bundle dependency

Open `packages/bundle/web-app/package.json` and add the workspace dep:

```jsonc
{
  "dependencies": {
    // ... existing entries ...
    "@deepseek-ai/dsh-client-ui-prompt-manager": "workspace:^"
  }
}
```

## 6. Optional: profile-level override

If you ship a profile overlay
(`packages/bundle/<profile>/cordis.patch.yml`) and want to disable the
plugin, add:

```yaml
- id: ui-prompt-manager
  disabled: true
```

## 7. Build & verify

The `bundle` script only runs `tsdown`; it does **not** invoke `tsc -b`
first. Since `tsdown.config.ts` declares its entry as
`lib/types/index.js` and `lib/types/invariant.js` (the `tsc` output),
you must compile before bundling:

```sh
# First, run tsc to emit src/ → lib/types/
pnpm exec tsc -b tsconfig.client.json

# Then run tsdown to bundle lib/types/*.js into lib/{index,invariant,client}.js
pnpm --filter @deepseek-ai/dsh-client-ui-prompt-manager bundle

# Or in one shot (also rebuilds every other referenced client package):
pnpm run build:lib:client

# Run the GUI test lane (component specs).
pnpm run test:gui
```

The plugin expects `dsh-settings-file` (or an equivalent writable
`ctx.settings` provider) to be mounted. The shipped `dsh-web-app`
bundle already pulls it through `dsh-base`, so no extra wiring is
required.

## 7. Smoke

1. Start `dsh web` (or any deployment including the bundle).
2. Open Settings → Prompts. Create a prompt titled `Test` with body
   `Hello {{name}}` and tag `demo`.
3. Open any conversation. Click the new "Prompts" button on the
   composer right side. Select `Test`, type `Ada` in the `{{name}}`
   field, click `Insert into composer`.
4. The composer draft becomes `Hello Ada`. Send and verify.
5. Quit `dsh web`. Inspect `~/.dsh/settings.yaml` — the `prompts:`
   section holds the record.

## Notes on the package's internals

- `src/schema.ts` owns the wire schema and the `interpolate` /
  `collectVariables` helpers; both are pure and unit-tested.
- `src/index.ts` (host half) registers the `prompts` settings
  namespace on `ctx.settings`. It has no runtime work beyond
  registration; the rest of the plugin runs in the client half.
- `src/client/store.ts` owns CRUD over the bound scope and exposes
  the filtered/tagged/viewable helpers that components call.
- `src/client/PromptsSection.tsx` is the settings page; it uses the
  `settings.section` slot and the `PromptsStore` directly.
- `src/client/PromptInsertButton.tsx` is the composer accessory; it
  uses `conversation.input.right` and `inputActions` from the
  standard kit.
- `src/client/PromptPickerPopover.tsx` is the dropdown that the
  accessory opens, and `PromptEditor.tsx` is the create/update
  dialog.

## Known implementation trade-offs

1. **`inputActions` handoff**: components read it via the standard
   props that ui-renderer binds for `session-scope` slots. If at
   runtime `inputActions` arrives undefined, declare
   `inject: ['input']` on the entry and read it from
   `ctx.get('input')`.
2. **`useSnapshot` fallback**: when the renderer does not bind the
   hook, components fall back to `controller.store.getSnapshot()`
   (a one-shot snapshot, no subscription). Replace the fallback
   once the framework hook is available.