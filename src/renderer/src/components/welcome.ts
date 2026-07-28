// 欢迎页 — 空态内容:无目录时显示打开引导 + 最近打开;有目录未选文件时显示选择提示。
// 显隐由 app.ts 按 store.currentFile 控制,这里只负责内容渲染。
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'

const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
const ICON_DOC =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'

const norm = (p: string): string => p.replace(/\\/g, '/')

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  if (text !== undefined) d.textContent = text
  return d
}

function mkBtn(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = primary ? 'welcome-btn welcome-btn-primary' : 'welcome-btn'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

async function pick(kind: 'file' | 'folder'): Promise<void> {
  const p = await window.api.openDialog(kind)
  if (!p) return
  bus.emit(kind === 'file' ? 'open-file' : 'open-folder', norm(p))
}

export function initWelcome(): void {
  const el = document.getElementById('welcome')
  if (!el) return
  const render = (): void => renderWelcome(el)
  // recentRoots / 目录态 / 语言变化时重渲染(元素隐藏时渲染开销可忽略)
  store.on('session', render)
  store.on('rootDir', render)
  store.on('lang', render)
  render()
}

function renderWelcome(el: HTMLElement): void {
  el.textContent = ''
  const s = store.get()
  const icon = div('welcome-icon')

  if (s.rootDir) {
    // 目录已打开但未选择文件
    icon.innerHTML = ICON_DOC
    el.append(icon, div('welcome-hint', t('selectFileHint')))
    return
  }

  icon.innerHTML = ICON_FOLDER
  el.append(
    icon,
    div('welcome-title', t('welcomeOpenFolder')),
    div('welcome-hint', t('welcomePressCmdO').replace(/Cmd/g, 'Ctrl')), // mac 提示转 Windows
    div('welcome-hint', t('welcomeDropHint'))
  )

  const actions = div('welcome-actions')
  actions.append(
    mkBtn(t('commandPaletteOpenFile'), true, () => {
      void pick('file')
    }),
    mkBtn(t('commandPaletteOpenFolder'), false, () => {
      void pick('folder')
    })
  )
  el.append(actions)

  // 最近打开的文件夹(session.recentRoots)
  const recent = div('welcome-recent')
  recent.append(div('welcome-recent-title', t('win.recentFolders')))
  const roots = s.session.recentRoots
  if (roots.length === 0) {
    recent.append(div('welcome-hint', t('win.noRecent')))
  } else {
    for (const r of roots) {
      const item = div('welcome-recent-item')
      item.title = r
      const name = document.createElement('span')
      name.textContent = r.slice(r.lastIndexOf('/') + 1) || r
      const path = document.createElement('span')
      path.className = 'welcome-recent-path muted'
      path.textContent = r
      item.append(name, path)
      item.addEventListener('click', () => bus.emit('open-folder', r))
      recent.append(item)
    }
  }
  el.append(recent)
}
