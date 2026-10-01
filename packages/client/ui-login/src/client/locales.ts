/**
 * Login overlay + sidebar indicator copy. The namespace `login` is owned by
 * this plugin; consumers reach it through `ctx.locale.bind('login')`.
 */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  indicatorAnonymous: 'anonymous',
  indicatorAnonymousHint: 'Click to log in',
  indicatorAuthenticated: '{name}',
  indicatorTooltipAnonymous: 'Click to log in',
  indicatorTooltipAuthenticated: 'Open account menu',
  menuSettings: 'Settings',
  menuLogin: 'Log in',
  menuLogout: 'Log out',
  menuAccount: 'Account',
  overlayTitleAnonymous: 'Log in',
  overlayTitleAuthenticated: 'Account',
  usernameField: 'Username',
  usernamePlaceholder: 'any name (placeholder)',
  submitLogin: 'Log in',
  loggedInAs: 'Logged in as {name}',
  loggedInSince: 'Since {time}',
  logout: 'Log out',
  cancel: 'Cancel',
  close: 'Close',
} as const

/** The login namespace key union. */
export type LoginKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [K in keyof typeof en]: string } = {
  indicatorAnonymous: '未登录',
  indicatorAnonymousHint: '点击登录',
  indicatorAuthenticated: '{name}',
  indicatorTooltipAnonymous: '点击登录',
  indicatorTooltipAuthenticated: '打开账号菜单',
  menuSettings: '设置',
  menuLogin: '登录',
  menuLogout: '退出登录',
  menuAccount: '账号',
  overlayTitleAnonymous: '登录',
  overlayTitleAuthenticated: '账号',
  usernameField: '用户名',
  usernamePlaceholder: '任意名称（占位）',
  submitLogin: '登录',
  loggedInAs: '当前登录：{name}',
  loggedInSince: '登录时间：{time}',
  logout: '退出登录',
  cancel: '取消',
  close: '关闭',
}
