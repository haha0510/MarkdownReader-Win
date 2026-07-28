// 标题栏 — 按钮接线 + 文档标题/脏标记回显。
// 侧栏/大纲/模式切换统一经 window 'app:menu-action' 交 app.ts 分发(与菜单同一入口,自动去重);
// 主题循环(auto → 浅色预设 → 深色预设 → auto)在本模块直接调 api.setSettings。
import type { MenuAction } from '@shared/types'
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'

// 16px 线性图标,stroke currentColor
const ICON_SIDEBAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>'
const ICON_OUTLINE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>'
const ICON_EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'
const ICON_CODE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
const ICON_THEME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>'
const ICON_GEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

const sendAction = (a: MenuAction): void => {
  window.dispatchEvent(new CustomEvent<MenuAction>('app:menu-action', { detail: a }))
}

/** mac 快捷键提示转 Windows 形式(⌘\ → Ctrl+\) */
const winShortcut = (s: string): string => s.replace(/⌘/g, 'Ctrl+')

export function initTitlebar(): void {
  const btnSidebar = document.getElementById('btn-toggle-sidebar')
  const btnOutline = document.getElementById('btn-toggle-outline')
  const btnMode = document.getElementById('btn-mode')
  const btnTheme = document.getElementById('btn-theme')
  const btnSettings = document.getElementById('btn-settings')
  const docTitle = document.getElementById('doc-title')
  const docDirty = document.getElementById('doc-dirty')
  if (!btnSidebar || !btnOutline || !btnMode || !btnTheme || !btnSettings || !docTitle || !docDirty) return

  btnSidebar.innerHTML = ICON_SIDEBAR
  btnSidebar.addEventListener('click', () => sendAction('toggle-sidebar'))
  btnOutline.innerHTML = ICON_OUTLINE
  btnOutline.addEventListener('click', () => sendAction('toggle-outline'))
  btnMode.addEventListener('click', () => sendAction('mode-toggle'))
  btnTheme.innerHTML = ICON_THEME
  btnTheme.addEventListener('click', () => {
    void cycleTheme()
  })
  btnSettings.innerHTML = ICON_GEAR
  btnSettings.addEventListener('click', () => bus.emit('show-settings'))

  // 静态提示文案(语言变化时重设)
  const syncTitles = (): void => {
    btnSidebar.title = winShortcut(t('titleBarToggleSidebar'))
    btnOutline.title = t('titleBarToggleOutline')
    btnTheme.title = t('settingsAppearanceThemeTitle')
    btnSettings.title = winShortcut(t('sidebarSettings'))
    syncMode()
  }

  // 侧栏/大纲开关的按下态
  const syncActive = (): void => {
    btnSidebar.classList.toggle('active', store.get().sidebarVisible)
    btnOutline.classList.toggle('active', store.get().outlineVisible)
  }
  store.on('sidebarVisible', syncActive)
  store.on('outlineVisible', syncActive)
  syncActive()

  // 模式按钮:渲染态显示 eye,原文态显示 code
  const syncMode = (): void => {
    const rendered = store.get().mode === 'rendered'
    btnMode.innerHTML = rendered ? ICON_EYE : ICON_CODE
    btnMode.title = rendered ? t('displayModeRendered') : t('displayModeRaw')
  }
  store.on('mode', syncMode)
  store.on('lang', syncTitles)
  syncTitles()

  // 文档标题 + 脏标记
  const syncDoc = (): void => {
    const cf = store.get().currentFile
    docTitle.textContent = cf ? cf.slice(cf.lastIndexOf('/') + 1) : t('appName')
  }
  store.on('currentFile', syncDoc)
  store.on('lang', syncDoc)
  syncDoc()
  store.on('dirty', (d) => {
    docDirty.hidden = !d
  })
  docDirty.hidden = !store.get().dirty
}

/** 主题循环:auto → 当前浅色预设 → 当前深色预设 → auto */
async function cycleTheme(): Promise<void> {
  const st = store.get().settings
  let next: string
  let msgKey: string
  if (st.theme === 'auto') {
    next = st.lightTheme
    msgKey = 'win.themeLight'
  } else if (st.theme === st.lightTheme) {
    next = st.darkTheme
    msgKey = 'win.themeDark'
  } else {
    next = 'auto'
    msgKey = 'win.themeFollowSystem'
  }
  const merged = await window.api.setSettings({ theme: next })
  store.set({ settings: merged }) // F 监听 store.settings 重应用主题
  bus.emit('toast', { message: t(msgKey), kind: 'info' })
}
