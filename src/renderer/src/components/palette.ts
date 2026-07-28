// 命令面板 — Ctrl+P 按相对路径模糊搜索 md 文件
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import type { FileNode } from '@shared/types'

/** 候选文件 */
interface Cand {
  path: string
  rel: string
  relLower: string
  name: string
}
/** 命中结果(positions 为 rel 中的匹配下标) */
interface Hit extends Cand {
  score: number
  positions: number[]
}

const BOUND = new Set(['/', '-', '_', '.', ' '])

/** 子序列模糊匹配 + 计分:连续 +3,词首(/ - _ . 或开头)后 +2,其余 +1 */
function fuzzy(q: string, target: string): { score: number; positions: number[] } | null {
  let score = 0
  let prev = -2
  let from = 0
  const positions: number[] = []
  for (const ch of q) {
    const idx = target.indexOf(ch, from)
    if (idx < 0) return null
    if (idx === prev + 1) score += 3
    else if (idx === 0 || BOUND.has(target[idx - 1])) score += 2
    else score += 1
    positions.push(idx)
    prev = idx
    from = idx + 1
  }
  return { score, positions }
}

export function initPalette(): void {
  const overlay = document.getElementById('palette-overlay') as HTMLElement
  const panel = document.getElementById('palette') as HTMLElement

  const input = document.createElement('input')
  input.className = 'pal-input'
  input.type = 'text'
  input.placeholder = t('win.palettePlaceholder')
  input.spellcheck = false
  const listEl = document.createElement('div')
  listEl.className = 'pal-list'
  panel.append(input, listEl)

  let cands: Cand[] | null = null
  let results: Hit[] = []
  let active = 0

  function collect(): Cand[] {
    if (cands) return cands
    const out: Cand[] = []
    const root = store.get().rootDir
    const tree = store.get().tree
    if (tree && root) {
      const prefix = root.endsWith('/') ? root : root + '/'
      const walk = (n: FileNode): void => {
        if (!n.isDir) {
          const rel = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.name
          out.push({ path: n.path, rel, relLower: rel.toLowerCase(), name: n.name })
        }
        n.children?.forEach(walk)
      }
      walk(tree)
    }
    out.sort((a, b) => a.rel.localeCompare(b.rel))
    cands = out
    return out
  }

  function update(): void {
    const q = input.value.trim().toLowerCase().replace(/\s+/g, '')
    const all = collect()
    if (!q) {
      // 空查询:按字母序列出前 50 个
      results = all.slice(0, 50).map((c) => ({ ...c, score: 0, positions: [] }))
    } else {
      const hits: Hit[] = []
      for (const c of all) {
        const m = fuzzy(q, c.relLower)
        if (m) hits.push({ ...c, score: m.score, positions: m.positions })
      }
      // 分数降序;同分短路径优先;再按字母序保证稳定
      hits.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))
      results = hits.slice(0, 50)
    }
    active = 0
    renderList()
  }

  /** 文件名部分带 <b> 高亮 */
  function nameSpan(r: Hit): HTMLElement {
    const el = document.createElement('span')
    el.className = 'pal-name'
    const start = r.rel.length - r.name.length
    const matched = new Set<number>()
    for (const p of r.positions) if (p >= start) matched.add(p - start)
    if (matched.size === 0) {
      el.textContent = r.name
      return el
    }
    let buf = ''
    let bold = false
    const flush = (): void => {
      if (!buf) return
      if (bold) {
        const b = document.createElement('b')
        b.textContent = buf
        el.appendChild(b)
      } else {
        el.appendChild(document.createTextNode(buf))
      }
      buf = ''
    }
    for (let i = 0; i < r.name.length; i++) {
      const m = matched.has(i)
      if (m !== bold) {
        flush()
        bold = m
      }
      buf += r.name[i]
    }
    flush()
    return el
  }

  function renderList(): void {
    listEl.textContent = ''
    if (results.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'panel-empty muted'
      empty.textContent = t('win.paletteNoResults')
      listEl.appendChild(empty)
      return
    }
    const frag = document.createDocumentFragment()
    results.forEach((r, i) => {
      const item = document.createElement('div')
      item.className = 'pal-item' + (i === active ? ' active' : '')
      item.dataset.index = String(i)
      const dirEl = document.createElement('span')
      dirEl.className = 'pal-dir'
      dirEl.textContent = r.rel.slice(0, Math.max(0, r.rel.length - r.name.length - 1))
      item.append(nameSpan(r), dirEl)
      frag.appendChild(item)
    })
    listEl.appendChild(frag)
  }

  function setActive(i: number, scroll = true): void {
    if (results.length === 0) return
    active = ((i % results.length) + results.length) % results.length // 环绕
    listEl.querySelectorAll('.pal-item.active').forEach((el) => el.classList.remove('active'))
    const el = listEl.querySelector<HTMLElement>(`.pal-item[data-index="${active}"]`)
    if (el) {
      el.classList.add('active')
      if (scroll) el.scrollIntoView({ block: 'nearest' })
    }
  }

  function openPalette(): void {
    input.value = '' // 重新打开时清空查询
    update()
    overlay.hidden = false
    input.focus()
  }
  function close(): void {
    overlay.hidden = true
  }
  function pick(i: number): void {
    const r = results[i]
    if (!r) return
    close()
    bus.emit('open-file', r.path)
  }

  input.addEventListener('input', update)
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
    const item = (e.target as HTMLElement).closest('.pal-item') as HTMLElement | null
    if (item?.dataset.index != null) pick(Number(item.dataset.index))
  })
  listEl.addEventListener('mouseover', (e) => {
    const item = (e.target as HTMLElement).closest('.pal-item') as HTMLElement | null
    if (item?.dataset.index != null) setActive(Number(item.dataset.index), false)
  })
  // 点击遮罩关闭(mousedown 判定,避免从面板内拖出误关)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })

  store.on('tree', () => {
    cands = null
    if (!overlay.hidden) update()
  })
  store.on('rootDir', () => {
    cands = null
  })
  bus.on('show-palette', () => {
    if (overlay.hidden) openPalette()
    else close()
  })
  bus.on('close-overlays', close)
}
