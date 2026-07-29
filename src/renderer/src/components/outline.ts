// 大纲面板 — 按标题层级构建可折叠树:点击行跳转、点箭头折叠分支、
// 滚动联动高亮(活跃标题处于折叠分支内时自动展开其祖先)
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import type { OutlineItem } from '@shared/types'

/** 行首折叠箭头(展开时向下,折叠时 CSS 旋转为向右) */
const TWIST_SVG =
  '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>'
/** 全部折叠(双箭头向内) */
const COLLAPSE_ALL_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4.5 2.5 8 6 11.5 2.5"/><polyline points="4.5 13.5 8 10 11.5 13.5"/></svg>'
/** 全部展开(双箭头向外) */
const EXPAND_ALL_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4.5 5.5 8 2 11.5 5.5"/><polyline points="4.5 10.5 8 14 11.5 10.5"/></svg>'

/** 大纲树节点 */
interface OutlineNode {
  item: OutlineItem
  children: OutlineNode[]
}

/** 各文件已折叠的标题 id(仅会话内存,不持久化;文件首次打开默认全展开) */
const collapsedByFile = new Map<string, Set<string>>()

/** 取当前文件的折叠集合(懒创建) */
function collapsedSet(): Set<string> {
  const key = store.get().currentFile ?? ''
  let set = collapsedByFile.get(key)
  if (!set) {
    set = new Set()
    collapsedByFile.set(key, set)
  }
  return set
}

/** 扁平大纲按 level 堆栈构建嵌套树(h1→h3 之类的层级跳跃挂到最近的更浅祖先) */
function buildTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = [] // 栈内节点 level 严格递增
  for (const it of items) {
    const node: OutlineNode = { item: it, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].item.level >= it.level) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return roots
}

export function initOutlinePanel(): void {
  const header = document.getElementById('outline-header') as HTMLElement
  const list = document.getElementById('outline-list') as HTMLElement

  // ── 头部:标题 + 全部折叠/全部展开小按钮 ──
  const makeTool = (svg: string, tip: string): HTMLButtonElement => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ol-tool'
    btn.title = tip
    btn.innerHTML = svg
    return btn
  }
  const title = document.createElement('span')
  title.className = 'ol-htitle'
  title.textContent = t('outlineTitle')
  const btnCollapseAll = makeTool(COLLAPSE_ALL_SVG, t('win.outlineCollapseAll'))
  const btnExpandAll = makeTool(EXPAND_ALL_SVG, t('win.outlineExpandAll'))
  header.textContent = ''
  header.append(title, btnCollapseAll, btnExpandAll)

  /** 最近一次渲染的大纲树(供全部折叠遍历) */
  let tree: OutlineNode[] = []

  /** 递归渲染:行 + 紧随其后的子容器;行缩进按自身 level 内联设置,子容器不叠加缩进 */
  function renderNodes(nodes: OutlineNode[], parent: Node, collapsed: Set<string>): void {
    for (const node of nodes) {
      const it = node.item
      const row = document.createElement('div')
      row.className = 'ol-item'
      row.dataset.id = it.id
      row.dataset.level = String(it.level)
      row.style.paddingLeft = `${(it.level - 1) * 14 + 12}px`
      row.title = it.text

      const hasKids = node.children.length > 0
      const isCollapsed = hasKids && collapsed.has(it.id)
      if (hasKids) {
        const tw = document.createElement('span')
        tw.className = 'ol-twist'
        tw.innerHTML = TWIST_SVG
        row.appendChild(tw)
        if (isCollapsed) row.classList.add('collapsed')
      } else {
        // 无子节点:等宽占位保证同级文本对齐
        const pad = document.createElement('span')
        pad.className = 'ol-twist-pad'
        row.appendChild(pad)
      }
      const txt = document.createElement('span')
      txt.className = 'ol-text'
      txt.textContent = it.text
      row.appendChild(txt)
      parent.appendChild(row)

      if (hasKids) {
        const box = document.createElement('div')
        box.className = 'ol-children'
        if (isCollapsed) box.classList.add('collapsed')
        renderNodes(node.children, box, collapsed)
        parent.appendChild(box)
      }
    }
  }

  function render(): void {
    list.textContent = ''
    const items = store.get().outline
    tree = buildTree(items)
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'panel-empty muted'
      empty.textContent = t('win.emptyOutline')
      list.appendChild(empty)
      return
    }
    const frag = document.createDocumentFragment()
    renderNodes(tree, frag, collapsedSet())
    list.appendChild(frag)
    applyActive(false)
  }

  /** 目标行处于折叠分支内时,展开其全部祖先(同步折叠集合) */
  function expandAncestors(row: HTMLElement): void {
    const set = collapsedSet()
    let el: HTMLElement | null = row.parentElement
    while (el && el !== list) {
      if (el.classList.contains('ol-children')) {
        el.classList.remove('collapsed')
        const owner = el.previousElementSibling // 子容器紧跟其所属行
        if (owner instanceof HTMLElement && owner.classList.contains('ol-item')) {
          owner.classList.remove('collapsed')
          const oid = owner.dataset.id
          if (oid) set.delete(oid)
        }
      }
      el = el.parentElement
    }
  }

  /** 高亮活跃标题;expandCollapsed 时(activeHeadingId 变化)先展开其被折叠的祖先 */
  function applyActive(expandCollapsed: boolean): void {
    const id = store.get().activeHeadingId
    list.querySelectorAll('.ol-item.active').forEach((el) => el.classList.remove('active'))
    if (id == null) return
    // id 可能含特殊字符,遍历比对而非拼选择器
    for (const el of list.querySelectorAll<HTMLElement>('.ol-item')) {
      if (el.dataset.id === id) {
        if (expandCollapsed) expandAncestors(el)
        el.classList.add('active')
        el.scrollIntoView({ block: 'nearest' })
        break
      }
    }
  }

  /** 点箭头:只切换该分支折叠状态,不触发滚动跳转 */
  function toggleCollapse(row: HTMLElement): void {
    const id = row.dataset.id
    if (!id) return
    const set = collapsedSet()
    const willCollapse = !set.has(id)
    if (willCollapse) set.add(id)
    else set.delete(id)
    row.classList.toggle('collapsed', willCollapse)
    const box = row.nextElementSibling
    if (box instanceof HTMLElement && box.classList.contains('ol-children')) {
      box.classList.toggle('collapsed', willCollapse)
    }
  }

  /** 全部折叠(折叠所有有子节点的标题,顶层行保持可见)/ 全部展开 */
  function setAllCollapsed(collapse: boolean): void {
    const set = collapsedSet()
    set.clear()
    if (collapse) {
      const walk = (nodes: OutlineNode[]): void => {
        for (const n of nodes) {
          if (n.children.length > 0) {
            set.add(n.item.id)
            walk(n.children)
          }
        }
      }
      walk(tree)
    }
    render()
  }
  btnCollapseAll.addEventListener('click', () => setAllCollapsed(true))
  btnExpandAll.addEventListener('click', () => setAllCollapsed(false))

  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    // 点在折叠箭头上:只折叠/展开
    const twist = target.closest('.ol-twist')
    if (twist && list.contains(twist)) {
      const row = twist.closest('.ol-item')
      if (row instanceof HTMLElement) toggleCollapse(row)
      return
    }
    // 点在行文本上:跳转到对应标题
    const item = target.closest('.ol-item')
    if (item instanceof HTMLElement) {
      const id = item.dataset.id
      if (id) {
        store.set({ activeHeadingId: id })
        bus.emit('scroll-to-heading', id)
      }
    }
  })

  store.on('outline', render)
  store.on('activeHeadingId', () => applyActive(true))
  render()
}

// 兼容 CONTRACTS.md 第 2 节的 initOutline() 命名
export { initOutlinePanel as initOutline }
