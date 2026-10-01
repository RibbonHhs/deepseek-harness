# `@deepseek-ai/dsh-client-ui-login`

Browser-side Cordis plugin that surfaces the current account state in the web UI sidebar and provides a frame-wide modal for login/logout. **Placeholder only** — any non-empty input on the login form is accepted; the real auth integration lands separately.

## Model Experience

The plugin renders two seat occupants:

- A status chip in the sidebar footer (`sidebar.footer.action`). It shows the current username when authenticated or `未登录` / `anonymous` when not. Both states are clickable.
- A frame-wide modal in `shell.overlay`. Anonymous view shows a username input + Log in / Cancel buttons. Authenticated view shows `Logged in as <user>`, login time, and a Log out button.

State persists under `localStorage["login-account"]` via `@deepseek-ai/dsh-client-store`'s `defineStore({ persist: ... })`.

## Integration Surface

Three registration surfaces must agree (matching the precedent at `packages/client/ui-mcp-servers/INTEGRATION.md`):

1. `tsconfig.client.json` `references` entry (alphabetical).
2. `dsh.client` row in `packages/bundle/web-app/cordis.patch.yml`.
3. `packages/bundle/web-app/package.json` `dependencies` entry (`@deepseek-ai/dsh-client-ui-login: workspace:^`).

## Build

```sh
pnpm exec tsc -b tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-client-ui-login bundle
```

## Tests

```sh
pnpm run test:gui
```

The two specs under `tests/` cover the anonymous copy, the authenticated copy, the form submit path, the logout path, and the overlay open/close flow.