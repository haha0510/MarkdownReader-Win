// 大纲面板 — 渲染 store.outline,点击跳转,滚动联动高亮
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'

export function initOutlinePanel(): void {
  const header = document.getElementById('outline-header') as HTMLElement
  const list = document.getElementById('outline-list') as HTMLElement
  header.textContent = t('outlineTitle')

  function render(): void {
    list.textContent = ''
    const items = store.get().outline
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'panel-empty muted'
      empty.textContent = t('win.emptyOutline')
      list.appendChild(empty)
      return
    }
    const frag = document.createDocumentFragment()
    for (const it of items) {
      const el = document.createElement('div')
      el.className = 'ol-item'
      el.dataset.id = it.id
      el.dataset.level = String(it.level)
      // 缩进按层级递进
      el.style.paddingLeft = `${(it.level - 1) * 14 + 12}px`
      el.textContent = it.text
      el.title = it.text
      frag.appendChild(el)
    }
    list.appendChild(frag)
    applyActive()
  }

  function applyActive(): void {
    const id = store.get().activeHeadingId
    list.querySelectorAll('.ol-item.active').forEach((el) => el.classList.remove('active'))
    if (id == null) return
    // id 可能含特殊字符,遍历比对而非拼选择器
    for (const el of list.querySelectorAll<HTMLElement>('.ol-item')) {
      if (el.dataset.id === id) {
        el.classList.add('active')
        el.scrollIntoView({ block: 'nearest' })
        break
      }
    }
  }

  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.ol-item') as HTMLElement | null
    const id = item?.dataset.id
    if (id) {
      store.set({ activeHeadingId: id })
      bus.emit('scroll-to-heading', id)
    }
  })

  store.on('outline', render)
  store.on('activeHeadingId', applyActive)
  render()
}

// 兼容 CONTRACTS.md 第 2 节的 initOutline() 命名
export { initOutlinePanel as initOutline }
