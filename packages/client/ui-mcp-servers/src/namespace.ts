/**
 * Branded `mcp-servers` settings namespace. Host and client both use the
 * same literal; this module exists so the client half can import the
 * value without dragging `@deepseek-ai/dsh-settings` into the browser
 * bundle (the purity gate rejects cross-plugin value imports; only
 * the host half needs the dsh-settings runtime).
 *
 * @module @deepseek-ai/dsh-client-ui-mcp-servers
 */

import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace identifier. Lowercase kebab-case per `SettingsNamespace`. */
export const MCP_SERVERS_NAMESPACE = 'mcp-servers' as SettingsNamespace
