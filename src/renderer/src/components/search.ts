// 全文搜索浮层 — Ctrl+Shift+F 搜索所有已打开根目录下 md 文件的内容
import '@/styles/search.css'
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import type { SearchHit } from '@shared/ipc'

const api = window.api

export function initSearch(): void {
  // index.html 无预留容器,自建 overlay DOM
  const overlay = document.createElement('div')
  overlay.id = 'search-overlay'
  overlay.hidden = true
  const panel = document.createElement('div')
  panel.id = 'search-panel'
  const input = document.createElement('input')
  input.className = 'sr-input'
  input.type = 'text'
  input.placeholder = t('win.searchPlaceholder')
  input.spellcheck = false
  const listEl = document.createElement('div')
  listEl.className = 'sr-list'
  panel.append(input, listEl)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  let hits: SearchHit[] = []
  let active = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0 // 请求序号,丢弃过期结果

  /** 文件绝对路径 → 相对根路径(带根目录名前缀) */
  function relPath(p: string): string {
    for (const root of store.get().rootDirs) {
      const prefix = root.endsWith('/') ? root : root + '/'
      if (p.startsWith(prefix)) {
        const rootName = root.slice(root.lastIndexOf('/') + 1) || root
        return `${rootName}/${p.slice(prefix.length)}`
      }
    }
    return p
  }

  /** preview 中 query 部分用 <b> 高亮(DOM 拼接,天然 HTML 转义) */
  function previewSpan(text: string, q: string): HTMLElement {
    const el = document.createElement('span')
    el.className = 'sr-text'
    const lower = text.toLowerCase()
    const ql = q.toLowerCase()
    let pos = 0
    while (ql) {
      const idx = lower.indexOf(ql, pos)
      if (idx < 0) break
      if (idx > pos) el.appendChild(document.createTextNode(text.slice(pos, idx)))
      const b = document.createElement('b')
      b.textContent = text.slice(idx, idx + ql.length)
      el.appendChild(b)
      pos = idx + ql.length
    }
    if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)))
    return el
  }

  function renderList(q: string): void {
    listEl.textContent = ''
    active = 0
    if (hits.length === 0) {
      if (q.length >= 2) {
        const empty = document.createElement('div')
        empty.className = 'sr-empty'
        empty.textContent = t('win.searchNoResults')
        listEl.appendChild(empty)
      }
      return
    }
    const frag = document.createDocumentFragment()
    let lastFile = ''
    hits.forEach((h, i) => {
      if (h.path !== lastFile) {
        lastFile = h.path
        const fileEl = document.createElement('div')
        fileEl.className = 'sr-file'
        fileEl.textContent = relPath(h.path)
        frag.appendChild(fileEl)
      }
      const item = document.createElement('div')
      item.className = 'sr-item' + (i === 0 ? ' active' : '')
      item.dataset.index = String(i)
      const lineEl = document.createElement('span')
      lineEl.className = 'sr-line'
      lineEl.textContent = String(h.line + 1)
      item.append(lineEl, previewSpan(h.preview, q))
      frag.appendChild(item)
    })
    listEl.appendChild(frag)
  }

  function setActive(i: number, scroll = true): void {
    if (hits.length === 0) return
    active = ((i % hits.length) + hits.length) % hits.length // 环绕
    listEl.querySelectorAll('.sr-item.active').forEach((el) => el.classList.remove('active'))
    const el = listEl.querySelector<HTMLElement>(`.sr-item[data-index="${active}"]`)
    if (el) {
      el.classList.add('active')
      if (scroll) el.scrollIntoView({ block: 'nearest' })
    }
  }

  async function doSearch(): Promise<void> {
    const q = input.value.trim()
    const my = ++seq
    if (q.length < 2) {
      hits = []
      renderList(q)
      return
    }
    const r = await api.searchContent(store.get().rootDirs, q)
    if (my !== seq || overlay.hidden) return // 过期结果丢弃
    hits = r
    renderList(q)
  }

  function open(): void {
    overlay.hidden = false
    input.focus()
    input.select()
  }
  function close(): void {
    overlay.hidden = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 打开命中文件并滚动到命中行附近的标题 */
  function pick(i: number): void {
    const h = hits[i]
    if (!h) return
    close()
    bus.emit('open-file', h.path)
    // 延迟等待文件载入与渲染完成,再按大纲定位
    setTimeout(() => {
      const { currentFile, outline } = store.get()
      if (currentFile !== h.path) return // 打开被取消(如 dirty confirm)
      let target: string | null = null
      for (const item of outline) {
        if (item.line <= h.line) target = item.id
        else break
      }
      if (target) bus.emit('scroll-to-heading', target)
      else document.getElementById('viewer-scroll')?.scrollTo({ top: 0 })
    }, 600)
  }

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void doSearch()
    }, 300) // 300ms 去抖
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(active + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(active - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  })
  listEl.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.sr-item') as HTMLElement | null
    if (item?.dataset.index != null) pick(Number(item.dataset.index))
  })
  listEl.addEventListener('mouseover', (e) => {
    const item = (e.target as HTMLElement).closest('.sr-item') as HTMLElement | null
    if (item?.dataset.index != null) setActive(Number(item.dataset.index), false)
  })
  // 点击遮罩关闭(mousedown 判定,避免从面板内拖出误关)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })

  bus.on('show-search', () => {
    if (overlay.hidden) open()
    else close()
  })
  bus.on('close-overlays', close)
}
