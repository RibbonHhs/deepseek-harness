/**
 * Login copy translator. Identity translator used when the renderer did
 * not bind a real `t`. Keeps the keys visible in place of the missing
 * strings so a missing-injection bug shows up immediately in the UI
 * instead of silently swapping in blanks.
 *
 * The translator accepts the namespace's dictionary keys plus the
 * shared common vocabulary (`TranslateNS<'login'>`), keeping it
 * structurally compatible with the framework-injected `t`.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export type Translator = TranslateNS<'login'>

export const identityTranslator: Translator = key => key
