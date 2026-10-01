/**
 * Section copy translator. Identity translator used when the renderer did
 * not bind a real `t`. Keeps the keys visible in place of the missing
 * strings so a missing-injection bug shows up immediately in the UI
 * instead of silently swapping in blanks.
 */

import type { en } from './locales.ts'

export type Translator = (key: keyof typeof en, params?: Record<string, unknown>) => string

export const identityTranslator: Translator = key => key
