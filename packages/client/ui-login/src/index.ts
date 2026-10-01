/**
 * Login/account UI plugin, node half.
 *
 * The plugin is browser-only: the host has no auth surface yet, so the
 * node half is an empty apply. Activation lives entirely in `./client/`.
 */

/** Cordis plugin name. */
export const name = 'ui-login'

/** No node-side apply — the browser half owns all behavior. */
export function apply(): void {}
