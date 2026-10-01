/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-servers-activator`.
 * @module @deepseek-ai/dsh-mcp-servers-activator/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-servers-activator'

/** Cordis companion plugin name. */
export const name = 'mcp-servers-activator-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the activator's reconciliation logic is pure
 * over the settings namespace it observes. The companion reserves the
 * package name so a future invariant can land without an install-list
 * churn.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
