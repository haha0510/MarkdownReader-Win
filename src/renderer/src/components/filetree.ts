// 文件树面板 — 渲染 store.tree、展开/选择/键盘导航、右键菜单、内联新建/重命名
import '@/styles/panels.css'
import { store } from '@/state'
import type { AppState } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import type { FileNode, PopupItem } from '@shared/types'
import type { RendererApi } from '@shared/ipc'

const api = (window as unknown as { api: RendererApi }).api

// ── 内联 SVG 图标(颜色走 currentColor)──
const SVG_CHEVRON =
  '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5 10.5 8l-5 4.5"/></svg>'
const SVG_FOLDER =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.75 3.25c0-.83.67-1.5 1.5-1.5h2.88c.4 0 .78.16 1.06.44l1.06 1.06h4.5c.83 0 1.5.67 1.5 1.5v7.5c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z"/></svg>'
const SVG_FILE =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4 1.75h5.19L12.25 4.8V14a.25.25 0 0 1-.25.25H4a.25.25 0 0 1-.25-.25V2a.25.25 0 0 1 .25-.25z"/><path d="M9 1.75V5h3.25"/><path d="M5.75 8.5h4.5M5.75 11h4.5" stroke-linecap="round"/></svg>'
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

  /** 展开目录集合(session 恢复/持久化) */
  let expanded = new Set<string>(store.get().session.expandedDirs)
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

  // ── 渲染 ──
  function renderHeader(): void {
    headerEl.textContent = ''
    const root = store.get().rootDir
    const name = document.createElement('span')
    name.className = 'sb-root-name'
    name.textContent = root ? baseName(root) || root : ''
    name.title = root ?? ''
    headerEl.appendChild(name)
    if (root) {
      // 打开其他文件夹
      const btnOpen = document.createElement('button')
      btnOpen.className = 'sb-refresh'
      btnOpen.title = t('commandPaletteOpenFolder')
      btnOpen.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>'
      btnOpen.addEventListener('click', () => {
        void api.openDialog('folder').then((p) => {
          if (p) bus.emit('open-folder', p.replace(/\\/g, '/'))
        })
      })
      // 刷新
      const btn = document.createElement('button')
      btn.className = 'sb-refresh'
      btn.title = t('titleBarReload')
      btn.innerHTML = SVG_REFRESH
      btn.addEventListener('click', () => void refreshTree())
      // 关闭文件夹(返回欢迎页)
      const btnClose = document.createElement('button')
      btnClose.className = 'sb-refresh'
      btnClose.title = t('win.closeFolder')
      btnClose.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      btnClose.addEventListener('click', () => bus.emit('close-folder'))
      headerEl.append(btnOpen, btn, btnClose)
    }
  }

  async function refreshTree(): Promise<void> {
    const root = store.get().rootDir
    if (!root) return
    try {
      const tree = await api.readTree(root)
      store.set({ tree })
    } catch {
      toastErr(t('win.loadError'))
    }
  }

  function makeRow(n: FileNode, depth: number): HTMLElement {
    const row = document.createElement('div')
    row.className = 'ft-row' + (n.isDir && expanded.has(n.path) ? ' expanded' : '')
    row.dataset.path = n.path
    row.dataset.dir = String(n.isDir)
    row.style.setProperty('--depth', String(depth))
    const twist = document.createElement('span')
    twist.className = 'ft-twist'
    if (n.isDir) twist.innerHTML = SVG_CHEVRON
    const icon = document.createElement('span')
    icon.className = 'ft-icon'
    icon.innerHTML = n.isDir ? SVG_FOLDER : SVG_FILE
    const name = document.createElement('span')
    name.className = 'ft-name'
    name.textContent = n.name
    name.title = n.name
    row.append(twist, icon, name)
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
    const tree = st.tree
    if (!tree || !tree.children || tree.children.length === 0) {
      if (st.rootDir && tree) {
        const empty = document.createElement('div')
        empty.className = 'panel-empty muted'
        empty.textContent = t('win.emptyTree')
        treeEl.appendChild(empty)
      }
      return
    }
    const frag = document.createDocumentFragment()
    buildNodes(tree.children, 0, frag)
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
    const root = store.get().rootDir
    if (root && path.startsWith(rootPrefix(root))) {
      let changed = false
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
    const root = store.get().rootDir
    if (!root) return
    let container: HTMLElement = treeEl
    let depth = 0
    if (dirPath !== root) {
      const dirRow = rows.get(dirPath)
      if (dirRow) {
        setExpanded(dirPath, true)
        const kids = dirRow.nextElementSibling
        if (kids instanceof HTMLElement && kids.classList.contains('ft-children')) {
          container = kids
          depth = Number(dirRow.style.getPropertyValue('--depth') || '0') + 1
        }
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
    const root = store.get().rootDir
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
    if (row && path) void showRowMenu(path, row.dataset.dir === 'true')
    else void showBlankMenu()
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

  /** 外部删除目录后清理 expanded 中已不存在的路径(与新树目录集合求交集) */
  function pruneExpanded(tree: FileNode | null): void {
    if (!tree || expanded.size === 0) return
    const dirs = new Set<string>()
    const walk = (nodes: FileNode[] | undefined): void => {
      if (!nodes) return
      for (const n of nodes) {
        if (n.isDir) {
          dirs.add(n.path)
          walk(n.children)
        }
      }
    }
    walk(tree.children)
    let changed = false
    for (const p of [...expanded]) {
      if (!dirs.has(p)) {
        expanded.delete(p)
        changed = true
      }
    }
    if (changed) persistExpanded()
  }

  // ── store / bus 订阅 ──
  store.on('tree', (tree) => {
    pruneExpanded(tree)
    renderTree()
    renderHeader()
  })
  store.on('rootDir', (root, prev) => {
    renderHeader()
    if (!root) {
      cancelEdit?.() // 直接清空 DOM 前先结束内联编辑,避免 cancelEdit 悬挂导致后续渲染永远暂缓
      pendingTree = false
      rows.clear()
      treeEl.textContent = ''
      return
    }
    // 切换到不同根目录时丢弃旧的展开项
    if (prev && prev !== root) {
      const pre = rootPrefix(root)
      const next = new Set([...expanded].filter((p) => p.startsWith(pre)))
      if (next.size !== expanded.size) {
        expanded = next
        persistExpanded()
      }
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
    if (!store.get().tree && expanded.size === 0 && s.expandedDirs.length) expanded = new Set(s.expandedDirs)
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
