/**
 * Branded `prompts` settings namespace literal. Host and client both use the
 * same literal; this module exists so the client half can import the value
 * without dragging `@deepseek-ai/dsh-settings` into the browser bundle (the
 * purity gate rejects cross-plugin value imports; only the host half needs
 * the dsh-settings runtime).
 *
 * @module @deepseek-ai/dsh-client-ui-prompt-manager
 */

import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace identifier. Lowercase kebab-case per `SettingsNamespace`. */
export const PROMPTS_NAMESPACE = 'prompts' as SettingsNamespace
