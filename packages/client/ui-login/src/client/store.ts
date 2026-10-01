/**
 * Login state store.
 *
 * Auth is currently a placeholder: any non-empty trimmed input flips the
 * status to 'authenticated'. Persistence keys on localStorage `login-account`
 * so the indicator reflects the previous session on reload.
 *
 * The store is the source of truth shared by the sidebar indicator and the
 * shell-overlay modal — both registrations in `apply()` receive the same
 * controller handle via inject (rule 6 of `packages/client/AGENTS.md`).
 */

import { defineStore } from '@deepseek-ai/dsh-client-store'

/** Account status surfaced by the store. */
export type LoginStatus = 'anonymous' | 'authenticated'

/** Reactive state published by {@link loginStore}. */
export interface LoginState {
  /** Current status. */
  status: LoginStatus
  /** Logged-in username; undefined while anonymous. */
  username: string | undefined
  /** ms-since-epoch the user was last authenticated; undefined while anonymous. */
  loggedInAt: number | undefined
}

/**
 * Bound store handle. The factory is the only sanctioned way to obtain
 * an instance — module-level handles are forbidden (`packages/client/AGENTS.md`
 * rule 6). The `apply()` body calls `loginStore.create()` once and passes the
 * returned controller to both slot registrations.
 *
 * The explicit type parameters anchor the actions table to the contract;
 * `ActionsDecl<T>` is `Record<string, (draft: T, ...params: any[]) => void>`,
 * so each action carries the draft plus its own parameters.
 */
export const loginStore = defineStore<LoginState, {
  setAnonymous: (draft: LoginState, ...args: unknown[]) => void
  setAuthenticated: (draft: LoginState, username: string, ...args: unknown[]) => void
}>({
  init: () => ({ status: 'anonymous', username: undefined, loggedInAt: undefined }),
  persist: 'login-account',
  actions: {
    setAnonymous(draft) {
      draft.status = 'anonymous'
      draft.username = undefined
      draft.loggedInAt = undefined
    },
    setAuthenticated(draft, username) {
      const trimmed = username.trim()
      if (trimmed.length === 0) {
        draft.status = 'anonymous'
        draft.username = undefined
        draft.loggedInAt = undefined
        return
      }
      draft.status = 'authenticated'
      draft.username = trimmed
      draft.loggedInAt = Date.now()
    },
  },
})
