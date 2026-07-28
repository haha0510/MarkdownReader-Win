// 查找条 — rendered 模式用主进程 webContents.findInPage(经 window.api);
// raw 模式转交 CodeMirror 自带搜索面板(与 editor.ts 同属 agent D,允许直连)。
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import { getEditorView } from './editor'

const UP_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>'
const DOWN_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>'
const CLOSE_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

export function initFindbar(): void {
  const bar = document.getElementById('findbar')
  if (!bar) return
  const api = window.api

  let matchCase = false
  let debounceTimer: number | undefined

  // ── 构建 DOM ──
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'find-input'
  input.placeholder = t('win.findPlaceholder')
  input.spellcheck = false

  const count = document.createElement('span')
  count.className = 'find-count'
  count.textContent = '0'

  const mkBtn = (cls: string, html: string, title?: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `find-btn ${cls}`
    b.innerHTML = html
    if (title) b.title = title
    return b
  }
  const caseBtn = mkBtn('find-case', 'Aa', t('win.matchCase'))
  const prevBtn = mkBtn('find-prev', UP_SVG, t('findBarFindPrevious'))
  const nextBtn = mkBtn('find-next', DOWN_SVG, t('findBarFindNext'))
  const closeBtn = mkBtn('find-close', CLOSE_SVG)
  bar.append(input, count, caseBtn, prevBtn, nextBtn, closeBtn)

  // ── 查找动作 ──
  /** findNextFlag=false 表示以当前文本重新开始搜索 */
  const startSearch = (findNextFlag: boolean, forward = true): void => {
    const text = input.value
    if (!text) {
      void api.findStop('clearSelection')
      count.textContent = '0'
      return
    }
    void api.findStart(text, { findNext: findNextFlag, forward, matchCase })
  }

  const show = (): void => {
    if (store.get().mode === 'raw') {
      // raw 模式:用 CodeMirror 搜索面板
      const v = getEditorView()
      if (v) openSearchPanel(v)
      return
    }
    bar.hidden = false
    input.focus()
    input.select()
  }

  const close = (): void => {
    if (bar.hidden) return // 幂等:全局 Esc 与输入框 Esc 都会触发
    bar.hidden = true
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    void api.findStop('clearSelection')
    count.textContent = '0'
  }

  // ── 事件 ──
  // 输入 250ms 防抖 → 重新查找;清空则停止
  input.addEventListener('input', () => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined
      startSearch(false)
    }, 250)
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      startSearch(true, !e.shiftKey)
    } else if (e.key === 'Escape') {
      close()
    }
  })

  caseBtn.addEventListener('click', () => {
    matchCase = !matchCase
    caseBtn.classList.toggle('active', matchCase)
    startSearch(false) // 切换后重新搜索
    input.focus()
  })
  prevBtn.addEventListener('click', () => startSearch(true, false))
  nextBtn.addEventListener('click', () => startSearch(true, true))
  closeBtn.addEventListener('click', close)

  // F3 / Shift+F3 / 菜单「查找下一个/上一个」(app.ts 转发为 CustomEvent)
  const step = (forward: boolean): void => {
    if (store.get().mode === 'raw') {
      const v = getEditorView()
      if (v) (forward ? findNext : findPrevious)(v)
      return
    }
    if (!bar.hidden && input.value) startSearch(true, forward)
  }
  window.addEventListener('app:find-next', () => step(true))
  window.addEventListener('app:find-prev', () => step(false))

  // 主进程查找结果 → 计数「i/n」
  api.onFindResult((r) => {
    if (bar.hidden) return
    count.textContent = r.matches > 0 ? `${r.activeMatchOrdinal}/${r.matches}` : '0'
  })

  bus.on('show-find', show)
  bus.on('close-overlays', close)
}
