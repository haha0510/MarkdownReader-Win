// 文件树面板 — 渲染 store.trees(多根工作区)、展开/选择/键盘导航、右键菜单、内联新建/重命名
import '@/styles/panels.css'
import { store } from '@/state'
import type { AppState } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import type { FileNode, PopupItem } from '@shared/types'
import { isMarkdownPath } from '@shared/types'
import type { RendererApi } from '@shared/ipc'

const api = (window as unknown as { api: RendererApi }).api

// ── 内联 SVG 图标(颜色走 currentColor)──
const SVG_CHEVRON =
  '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5 10.5 8l-5 4.5"/></svg>'
const SVG_FOLDER =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.75 3.25c0-.83.67-1.5 1.5-1.5h2.88c.4 0 .78.16 1.06.44l1.06 1.06h4.5c.83 0 1.5.67 1.5 1.5v7.5c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z"/></svg>'
const SVG_FILE =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4 1.75h5.19L12.25 4.8V14a.25.25 0 0 1-.25.25H4a.25.25 0 0 1-.25-.25V2a.25.25 0 0 1 .25-.25z"/><path d="M9 1.75V5h3.25"/><path d="M5.75 8.5h4.5M5.75 11h4.5" stroke-linecap="round"/></svg>'
/** 代码/文本文件图标(代码括号) */
const SVG_CODE =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5 1.75 8 5 11.5"/><path d="M11 4.5 14.25 8 11 11.5"/><path d="M9.25 3 6.75 13"/></svg>'
const SVG_REFRESH =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 1.5v3h-3"/></svg>'

/** 取父目录(正斜杠路径) */
function parentOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : ''
}
/** 取末段名称 */
function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}
/** 根目录带斜杠前缀(处理盘符根 "D:/") */
function rootPrefix(root: string): string {
  return root.endsWith('/') ? root : root + '/'
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
function toastErr(message: string): void {
  bus.emit('toast', { message, kind: 'error' })
}

export function initFiletree(): void {
  const treeEl = document.getElementById('filetree') as HTMLElement
  const headerEl = document.getElementById('sidebar-header') as HTMLElement

  /** 展开目录集合(session 恢复/持久化;根目录路径也并入此集合) */
  let expanded = new Set<string>(store.get().session.expandedDirs)
  /** 已自动默认展开过的根(避免用户手动折叠后又被强制展开) */
  const seenRoots = new Set<string>()
  /** path → 行元素 */
  const rows = new Map<string, HTMLElement>()
  /** 当前内联编辑的取消函数(同一时刻至多一个) */
  let cancelEdit: (() => void) | null = null
  /** 内联编辑期间到达的树更新暂存标记(编辑结束后补渲染) */
  let pendingTree = false
  /** 上次滚动定位到的选中路径(仅变化时才 scrollIntoView,避免树刷新拉走视口) */
  let lastSelectedPath: string | null = null

  /** 编辑结束后补渲染暂存的树更新 */
  function flushPendingTree(): void {
    if (!pendingTree) return
    pendingTree = false
    renderTree()
  }

  function persistExpanded(): void {
    const list = [...expanded]
    store.set({ session: { ...store.get().session, expandedDirs: list } })
    void api.setSession({ expandedDirs: list }).catch(() => {})
  }

  /** path 属于哪个根(返回根路径;不属于任何根返回 null) */
  function rootOf(p: string): string | null {
    for (const r of store.get().rootDirs) {
      if (p === r || p.startsWith(rootPrefix(r))) return r
    }
    return null
  }

  // ── 渲染 ──
  function renderHeader(): void {
    headerEl.textContent = ''
    const roots = store.get().rootDirs
    const name = document.createElement('span')
    name.className = 'sb-root-name'
    // 标题:单根显示目录名;多根显示「n 个文件夹」
    if (roots.length === 1) {
      name.textContent = baseName(roots[0]) || roots[0]
      name.title = roots[0]
    } else if (roots.length > 1) {
      name.textContent = t('win.foldersTitle', { n: roots.length })
      name.title = roots.join('\n')
    }
    headerEl.appendChild(name)
    if (roots.length > 0) {
      // 添加文件夹(追加到工作区)
      const btnAdd = document.createElement('button')
      btnAdd.className = 'sb-refresh'
      btnAdd.title = t('win.addFolder')
      btnAdd.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>'
      btnAdd.addEventListener('click', () => {
        void api.openDialog('folder').then((p) => {
          if (p) bus.emit('open-folder', p.replace(/\\/g, '/'))
        })
      })
      // 刷新(全部根)
      const btn = document.createElement('button')
      btn.className = 'sb-refresh'
      btn.title = t('titleBarReload')
      btn.innerHTML = SVG_REFRESH
      btn.addEventListener('click', () => void refreshTree())
      // 全部关闭(返回欢迎页)
      const btnClose = document.createElement('button')
      btnClose.className = 'sb-refresh'
      btnClose.title = t('win.closeFolder')
      btnClose.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      btnClose.addEventListener('click', () => bus.emit('close-folder'))
      headerEl.append(btnAdd, btn, btnClose)
    }
  }

  /** 刷新全部根的树 */
  async function refreshTree(): Promise<void> {
    const roots = store.get().rootDirs
    if (roots.length === 0) return
    try {
      const trees = await Promise.all(roots.map((r) => api.readTree(r)))
      if (store.get().rootDirs === roots) store.set({ trees })
    } catch {
      toastErr(t('win.loadError'))
    }
  }

  function makeRow(n: FileNode, depth: number, isRoot = false): HTMLElement {
    const row = document.createElement('div')
    row.className =
      'ft-row' + (isRoot ? ' ft-root' : '') + (n.isDir && expanded.has(n.path) ? ' expanded' : '')
    row.dataset.path = n.path
    row.dataset.dir = String(n.isDir)
    row.style.setProperty('--depth', String(depth))
    const twist = document.createElement('span')
    twist.className = 'ft-twist'
    if (n.isDir) twist.innerHTML = SVG_CHEVRON
    const icon = document.createElement('span')
    // 代码/文本文件用代码图标 + .code 类(md 保持文档图标)
    const isCode = !n.isDir && !isMarkdownPath(n.path)
    icon.className = 'ft-icon' + (isCode ? ' code' : '')
    icon.innerHTML = n.isDir ? SVG_FOLDER : isCode ? SVG_CODE : SVG_FILE
    const name = document.createElement('span')
    name.className = 'ft-name'
    name.textContent = n.name
    name.title = isRoot ? n.path : n.name
    row.append(twist, icon, name)
    row.draggable = true // 树内拖拽移动
    rows.set(n.path, row)
    return row
  }

  function buildNodes(nodes: FileNode[], depth: number, into: HTMLElement | DocumentFragment): void {
    for (const n of nodes) {
      into.appendChild(makeRow(n, depth))
      if (n.isDir) {
        // 目录行后跟子容器,折叠 = display:none(保留 DOM,展开有过渡)
        const kids = document.createElement('div')
        kids.className = 'ft-children' + (expanded.has(n.path) ? '' : ' collapsed')
        if (n.children) buildNodes(n.children, depth + 1, kids)
        into.appendChild(kids)
      }
    }
  }

  function renderTree(): void {
    // 内联编辑进行中:暂缓重建,避免销毁输入框丢失已输入文字(编辑结束后补渲染)
    if (cancelEdit) {
      pendingTree = true
      return
    }
    // 重建 DOM 会把滚动位置归零,先保存后恢复
    const savedScroll = treeEl.scrollTop
    rows.clear()
    treeEl.textContent = ''
    const st = store.get()
    if (st.rootDirs.length === 0) return
    // 首次见到的根默认展开并持久化
    let expandedChanged = false
    for (const r of st.rootDirs) {
      if (!seenRoots.has(r)) {
        seenRoots.add(r)
        if (!expanded.has(r)) {
          expanded.add(r)
          expandedChanged = true
        }
      }
    }
    if (expandedChanged) persistExpanded()
    const frag = document.createDocumentFragment()
    // 每个根渲染一个顶层区块行(.ft-root,深度 0),其子节点整体缩进 +1
    st.rootDirs.forEach((root, i) => {
      const tree = st.trees[i]
      const rootNode: FileNode = tree ?? { name: baseName(root) || root, path: root, isDir: true, children: [] }
      frag.appendChild(makeRow({ ...rootNode, name: rootNode.name || baseName(root) || root }, 0, true))
      const kids = document.createElement('div')
      kids.className = 'ft-children' + (expanded.has(rootNode.path) ? '' : ' collapsed')
      if (rootNode.children && rootNode.children.length > 0) {
        buildNodes(rootNode.children, 1, kids)
      } else {
        // 该根下没有 markdown 文件
        const empty = document.createElement('div')
        empty.className = 'panel-empty muted'
        empty.textContent = t('win.emptyTree')
        kids.appendChild(empty)
      }
      frag.appendChild(kids)
    })
    treeEl.appendChild(frag)
    syncDirty()
    updateSelection()
    treeEl.scrollTop = savedScroll
  }

  // ── 选择/展开 ──
  function updateSelection(): void {
    const sel = store.get().selectedPath
    treeEl.querySelectorAll('.ft-row.selected').forEach((el) => el.classList.remove('selected'))
    const changed = sel !== lastSelectedPath
    lastSelectedPath = sel
    if (!sel) return
    const row = rows.get(sel)
    if (row) {
      row.classList.add('selected')
      // 仅选中路径变化时滚动定位;树刷新重渲染不拉走视口
      if (changed) row.scrollIntoView({ block: 'nearest' })
    }
  }

  function syncDirty(): void {
    treeEl.querySelectorAll('.ft-row.dirty').forEach((el) => el.classList.remove('dirty'))
    const st = store.get()
    if (st.dirty && st.currentFile) rows.get(st.currentFile)?.classList.add('dirty')
  }

  function setExpanded(path: string, on: boolean, persist = true): void {
    if (on) expanded.add(path)
    else expanded.delete(path)
    const row = rows.get(path)
    if (row) {
      row.classList.toggle('expanded', on)
      const kids = row.nextElementSibling
      if (kids instanceof HTMLElement && kids.classList.contains('ft-children'))
        kids.classList.toggle('collapsed', !on)
    }
    if (persist) persistExpanded()
  }

  /** 展开祖先并选中(打开文件/reveal 时) */
  function revealPath(path: string): void {
    const root = rootOf(path)
    if (root && path.startsWith(rootPrefix(root))) {
      let changed = false
      // 根行自身也要展开
      if (!expanded.has(root)) {
        setExpanded(root, true, false)
        changed = true
      }
      let p = parentOf(path)
      while (p && p.length > root.length) {
        if (!expanded.has(p)) {
          setExpanded(p, true, false)
          changed = true
        }
        p = parentOf(p)
      }
      if (changed) persistExpanded()
    }
    store.set({ selectedPath: path })
    // selectedPath 未变化时 store 不触发事件,手动滚动一次
    rows.get(path)?.scrollIntoView({ block: 'nearest' })
  }

  function visibleRows(): HTMLElement[] {
    return [...treeEl.querySelectorAll<HTMLElement>('.ft-row')].filter(
      (r) => !r.classList.contains('ft-edit') && !r.closest('.ft-children.collapsed')
    )
  }

  // ── 内联编辑(新建/重命名)──
  function makeEditRow(depth: number, kind: 'file' | 'folder', initial: string): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div')
    row.className = 'ft-row ft-edit'
    row.style.setProperty('--depth', String(depth))
    const twist = document.createElement('span')
    twist.className = 'ft-twist'
    const icon = document.createElement('span')
    icon.className = 'ft-icon'
    icon.innerHTML = kind === 'folder' ? SVG_FOLDER : SVG_FILE
    const input = document.createElement('input')
    input.className = 'ft-input'
    input.type = 'text'
    input.value = initial
    input.spellcheck = false
    row.append(twist, icon, input)
    return { row, input }
  }

  /** 绑定内联输入的通用键盘/失焦行为 */
  function wireEditInput(input: HTMLInputElement, commit: () => Promise<void>, cleanup: () => void): void {
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        void commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cleanup()
      }
    })
    // 失焦取消(延迟避免与 Enter 提交后的移除竞争)
    input.addEventListener('blur', () => {
      setTimeout(cleanup, 120)
    })
  }

  function startCreate(dirPath: string, kind: 'file' | 'folder'): void {
    cancelEdit?.()
    if (store.get().rootDirs.length === 0) return
    // 根行现在也在 rows 里,目录行(含根)统一走展开+子容器逻辑
    let container: HTMLElement = treeEl
    let depth = 0
    const dirRow = rows.get(dirPath)
    if (dirRow) {
      setExpanded(dirPath, true)
      const kids = dirRow.nextElementSibling
      if (kids instanceof HTMLElement && kids.classList.contains('ft-children')) {
        container = kids
        depth = Number(dirRow.style.getPropertyValue('--depth') || '0') + 1
      }
    }
    const { row, input } = makeEditRow(depth, kind, kind === 'file' ? t('win.newFileDefaultName') : '')
    container.prepend(row)
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      row.remove()
      cancelEdit = null
      flushPendingTree()
    }
    cancelEdit = cleanup
    const commit = async (): Promise<void> => {
      const name = input.value.trim()
      if (!name) {
        toastErr(t('renameEmptyName'))
        input.focus()
        return
      }
      try {
        if (await api.exists(dirPath + '/' + name)) {
          toastErr(t('renameNameExists'))
          input.focus()
          return
        }
        const res = await api.createEntry(dirPath, name, kind)
        cleanup()
        await refreshTree()
        if (kind === 'file') bus.emit('open-file', res.path)
        else store.set({ selectedPath: res.path })
      } catch (err) {
        toastErr(errMsg(err))
        input.focus()
      }
    }
    wireEditInput(input, commit, cleanup)
    input.focus()
    if (kind === 'file') {
      const dot = input.value.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
    } else {
      input.select()
    }
  }

  function startRename(path: string, isDir: boolean): void {
    cancelEdit?.()
    const row = rows.get(path)
    if (!row) return
    const nameEl = row.querySelector<HTMLElement>('.ft-name')
    if (!nameEl) return
    const cur = baseName(path)
    const input = document.createElement('input')
    input.className = 'ft-input'
    input.type = 'text'
    input.value = cur
    input.spellcheck = false
    nameEl.style.display = 'none'
    row.appendChild(input)
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      input.remove()
      nameEl.style.display = ''
      cancelEdit = null
      flushPendingTree()
    }
    cancelEdit = cleanup
    const commit = async (): Promise<void> => {
      const newName = input.value.trim()
      if (!newName) {
        toastErr(t('renameEmptyName'))
        input.focus()
        return
      }
      if (newName === cur) {
        cleanup()
        return
      }
      try {
        // 仅大小写不同的改名在 NTFS 上 exists 会命中自身,跳过预检(主进程 sameFile 已放行)
        const caseOnly = newName.toLowerCase() === cur.toLowerCase()
        if (!caseOnly && (await api.exists(parentOf(path) + '/' + newName))) {
          toastErr(t('renameNameExists'))
          input.focus()
          return
        }
        const res = await api.renameEntry(path, newName)
        cleanup()
        remapAfterRename(path, res.path, isDir)
        await refreshTree()
      } catch (err) {
        toastErr(errMsg(err))
        input.focus()
      }
    }
    wireEditInput(input, commit, cleanup)
    input.focus()
    const dot = cur.lastIndexOf('.')
    if (!isDir && dot > 0) input.setSelectionRange(0, dot)
    else input.select()
  }

  /** 重命名后重映射 currentFile/selectedPath/展开集 */
  function remapAfterRename(oldPath: string, newPath: string, isDir: boolean): void {
    const st = store.get()
    const patch: Partial<AppState> = {}
    const remap = (p: string | null): string | null => {
      if (!p) return p
      if (p === oldPath) return newPath
      if (isDir && p.startsWith(oldPath + '/')) return newPath + p.slice(oldPath.length)
      return p
    }
    const cf = remap(st.currentFile)
    if (cf !== st.currentFile) patch.currentFile = cf
    const sp = remap(st.selectedPath)
    if (sp !== st.selectedPath) patch.selectedPath = sp
    if (isDir) {
      let changed = false
      const next = new Set<string>()
      for (const p of expanded) {
        const np = remap(p) as string
        if (np !== p) changed = true
        next.add(np)
      }
      if (changed) {
        expanded = next
        persistExpanded()
      }
    }
    if (Object.keys(patch).length) store.set(patch)
  }

  async function doDelete(path: string, isDir: boolean): Promise<void> {
    const name = baseName(path)
    if (!window.confirm(t(isDir ? 'deleteDirectoryMessage' : 'deleteMessage', { name }))) return
    try {
      await api.deleteEntry(path)
      const st = store.get()
      // 删除的是当前文件或其祖先 → 关闭当前文件
      if (st.currentFile && (st.currentFile === path || st.currentFile.startsWith(path + '/'))) {
        store.set({ currentFile: null, content: '', dirty: false, outline: [], activeHeadingId: null })
      }
      if (st.selectedPath && (st.selectedPath === path || st.selectedPath.startsWith(path + '/')))
        store.set({ selectedPath: null })
      let changed = false
      for (const p of [...expanded]) {
        if (p === path || p.startsWith(path + '/')) {
          expanded.delete(p)
          changed = true
        }
      }
      if (changed) persistExpanded()
      await refreshTree()
    } catch (err) {
      toastErr(errMsg(err))
    }
  }

  // ── 右键菜单 ──

  /** 根行专属菜单:显示 / 新建 / 从侧栏移除(不提供重命名/删除,根目录本身不在应用内改动) */
  async function showRootMenu(root: string): Promise<void> {
    const items: PopupItem[] = [
      { id: 'reveal', label: t('contextMenuOpenInFinder') },
      { type: 'separator' },
      { id: 'new-file', label: t('contextMenuNewFile') },
      { id: 'new-folder', label: t('contextMenuNewSubdirectory') },
      { type: 'separator' },
      { id: 'remove-root', label: t('win.removeFolder') }
    ]
    const id = await api.popupMenu(items)
    if (!id) return
    switch (id) {
      case 'reveal':
        void api.reveal(root)
        break
      case 'new-file':
        startCreate(root, 'file')
        break
      case 'new-folder':
        startCreate(root, 'folder')
        break
      case 'remove-root':
        bus.emit('remove-folder', root)
        break
    }
  }

  async function showRowMenu(path: string, isDir: boolean): Promise<void> {
    const items: PopupItem[] = []
    if (!isDir) items.push({ id: 'open', label: t('open') })
    items.push({ id: 'reveal', label: t('contextMenuOpenInFinder') })
    items.push({ type: 'separator' })
    items.push({ id: 'new-file', label: t('contextMenuNewFile') })
    items.push({ id: 'new-folder', label: t('contextMenuNewSubdirectory') })
    items.push({ type: 'separator' })
    items.push({ id: 'rename', label: t('contextMenuRename') })
    items.push({ id: 'delete', label: t('contextMenuDelete'), danger: true })
    const id = await api.popupMenu(items)
    if (!id) return
    const targetDir = isDir ? path : parentOf(path)
    switch (id) {
      case 'open':
        bus.emit('open-file', path)
        break
      case 'reveal':
        void api.reveal(path)
        break
      case 'new-file':
        startCreate(targetDir, 'file')
        break
      case 'new-folder':
        startCreate(targetDir, 'folder')
        break
      case 'rename':
        startRename(path, isDir)
        break
      case 'delete':
        void doDelete(path, isDir)
        break
    }
  }

  async function showBlankMenu(): Promise<void> {
    // 空白区菜单作用于第一个根
    const root = store.get().rootDirs[0]
    if (!root) return
    const items: PopupItem[] = [
      { id: 'new-file', label: t('contextMenuNewFile') },
      { id: 'new-folder', label: t('contextMenuNewSubdirectory') },
      { type: 'separator' },
      { id: 'reveal', label: t('contextMenuOpenInFinder') }
    ]
    const id = await api.popupMenu(items)
    if (id === 'new-file') startCreate(root, 'file')
    else if (id === 'new-folder') startCreate(root, 'folder')
    else if (id === 'reveal') void api.reveal(root)
  }

  // ── 事件绑定 ──
  treeEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.ft-row') as HTMLElement | null
    const path = row?.dataset.path
    if (!row || !path) return
    store.set({ selectedPath: path })
    if (row.dataset.dir === 'true') setExpanded(path, !expanded.has(path))
    else bus.emit('open-file', path)
  })

  treeEl.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const row = (e.target as HTMLElement).closest('.ft-row') as HTMLElement | null
    const path = row?.dataset.path
    if (row && path) {
      if (row.classList.contains('ft-root')) void showRootMenu(path)
      else void showRowMenu(path, row.dataset.dir === 'true')
    } else {
      void showBlankMenu()
    }
  })

  treeEl.addEventListener('keydown', (e) => {
    if (cancelEdit) return // 编辑中不导航
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return
    const vis = visibleRows()
    if (vis.length === 0) return
    e.preventDefault()
    const sel = store.get().selectedPath
    const idx = sel ? vis.findIndex((r) => r.dataset.path === sel) : -1
    const cur = idx >= 0 ? vis[idx] : null
    const select = (r: HTMLElement | undefined): void => {
      if (r?.dataset.path) store.set({ selectedPath: r.dataset.path })
    }
    switch (e.key) {
      case 'ArrowDown':
        select(vis[Math.min(idx + 1, vis.length - 1)])
        break
      case 'ArrowUp':
        select(vis[idx <= 0 ? 0 : idx - 1])
        break
      case 'ArrowRight':
        if (cur?.dataset.path && cur.dataset.dir === 'true' && !expanded.has(cur.dataset.path))
          setExpanded(cur.dataset.path, true)
        break
      case 'ArrowLeft': {
        if (!cur?.dataset.path) break
        if (cur.dataset.dir === 'true' && expanded.has(cur.dataset.path)) {
          setExpanded(cur.dataset.path, false)
        } else {
          // 跳到父目录行
          const parent = parentOf(cur.dataset.path)
          if (rows.has(parent)) store.set({ selectedPath: parent })
        }
        break
      }
      case 'Enter': {
        const p = cur?.dataset.path
        if (!p) break
        if (cur?.dataset.dir === 'true') setExpanded(p, !expanded.has(p))
        else bus.emit('open-file', p)
        break
      }
    }
  })

  /** 外部删除目录后清理 expanded 中已不存在的路径(与全部新树目录集合求交集;根路径始终保留) */
  function pruneExpanded(trees: FileNode[]): void {
    if (trees.length === 0 || expanded.size === 0) return
    const dirs = new Set<string>(store.get().rootDirs)
    const walk = (nodes: FileNode[] | undefined): void => {
      if (!nodes) return
      for (const n of nodes) {
        if (n.isDir) {
          dirs.add(n.path)
          walk(n.children)
        }
      }
    }
    for (const tree of trees) {
      dirs.add(tree.path)
      walk(tree.children)
    }
    let changed = false
    for (const p of [...expanded]) {
      if (!dirs.has(p)) {
        expanded.delete(p)
        changed = true
      }
    }
    if (changed) persistExpanded()
  }

  // ── 树内拖拽移动 ──
  const DND_MIME = 'application/x-mdr-path'
  /** 当前拖拽源路径(dragover 里 getData 拿不到数据,靠此变量判定合法目标) */
  let dragSrc: string | null = null
  let dragSrcIsDir = false
  /** 当前高亮的目标行 */
  let dropRow: HTMLElement | null = null

  function clearDropTarget(): void {
    dropRow?.classList.remove('drop-target')
    dropRow = null
  }

  /** 拖拽目标目录是否合法:排除 自身 / 源的父目录(同目录无意义) / 源目录的子孙 */
  function validDropDir(destDir: string): boolean {
    if (!dragSrc) return false
    if (destDir === dragSrc) return false
    if (destDir === parentOf(dragSrc)) return false
    if (dragSrcIsDir && destDir.startsWith(dragSrc + '/')) return false
    return true
  }

  treeEl.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest('.ft-row') as HTMLElement | null
    const path = row?.dataset.path
    if (!row || !path || row.classList.contains('ft-edit') || !e.dataTransfer) return
    dragSrc = path
    dragSrcIsDir = row.dataset.dir === 'true'
    e.dataTransfer.setData(DND_MIME, path)
    e.dataTransfer.effectAllowed = 'move'
  })

  treeEl.addEventListener('dragover', (e) => {
    if (!dragSrc || !e.dataTransfer?.types.includes(DND_MIME)) return
    const row = (e.target as HTMLElement).closest('.ft-row') as HTMLElement | null
    const dir = row?.dataset.dir === 'true' ? row.dataset.path : undefined
    if (!row || !dir || !validDropDir(dir)) {
      clearDropTarget()
      return
    }
    e.preventDefault() // 接受放置
    e.dataTransfer.dropEffect = 'move'
    if (dropRow !== row) {
      clearDropTarget()
      dropRow = row
      row.classList.add('drop-target')
    }
  })

  treeEl.addEventListener('dragleave', (e) => {
    // 离开当前高亮行(进入其他行时 dragover 会重设)
    if (dropRow && e.target instanceof Node && dropRow.contains(e.target)) clearDropTarget()
  })

  treeEl.addEventListener('dragend', () => {
    dragSrc = null
    clearDropTarget()
  })

  treeEl.addEventListener('drop', (e) => {
    const src = e.dataTransfer?.getData(DND_MIME)
    clearDropTarget()
    if (!src) return
    e.preventDefault()
    e.stopPropagation() // 不冒泡到 window 级"外部拖入打开"
    const row = (e.target as HTMLElement).closest('.ft-row') as HTMLElement | null
    const destDir = row?.dataset.dir === 'true' ? row.dataset.path : undefined
    const isDir = rows.get(src)?.dataset.dir === 'true'
    dragSrc = src
    dragSrcIsDir = isDir
    const valid = !!destDir && validDropDir(destDir)
    dragSrc = null
    if (!destDir || !valid) return
    void (async () => {
      try {
        const res = await api.moveEntry(src, destDir)
        // 移动的是当前文件/其祖先目录 → 重映射 currentFile/selectedPath/展开集(树由 watcher 刷新)
        remapAfterRename(src, res.path, isDir)
      } catch (err) {
        toastErr(errMsg(err))
      }
    })()
  })

  // ── store / bus 订阅 ──
  store.on('trees', (trees) => {
    pruneExpanded(trees)
    renderTree()
    renderHeader()
  })
  store.on('rootDirs', (roots) => {
    renderHeader()
    if (roots.length === 0) {
      cancelEdit?.() // 直接清空 DOM 前先结束内联编辑,避免 cancelEdit 悬挂导致后续渲染永远暂缓
      pendingTree = false
      rows.clear()
      treeEl.textContent = ''
      seenRoots.clear()
      return
    }
    // 移除根后丢弃不属于任何现存根的展开项(根路径自身也算其根内)
    const next = new Set(
      [...expanded].filter((p) => roots.some((r) => p === r || p.startsWith(rootPrefix(r))))
    )
    if (next.size !== expanded.size) {
      expanded = next
      persistExpanded()
    }
  })
  store.on('selectedPath', updateSelection)
  store.on('currentFile', (p) => {
    if (p) revealPath(p)
    syncDirty()
  })
  store.on('dirty', syncDirty)
  store.on('session', (s) => {
    // 启动顺序兜底:树渲染前采纳会话恢复的展开集
    if (store.get().trees.length === 0 && expanded.size === 0 && s.expandedDirs.length)
      expanded = new Set(s.expandedDirs)
  })
  bus.on('reveal-in-tree', (p) => {
    if (typeof p === 'string' && p) {
      revealPath(p)
      treeEl.focus()
    }
  })

  renderHeader()
  renderTree()
}
