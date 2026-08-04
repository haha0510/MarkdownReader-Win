// 应用入口 — 启动时序(CONTRACTS §2)、open-file/open-folder 流程、菜单动作分发、
// 外部修改/系统事件接线。窗口标题、data-mode/data-sidebar/data-outline 属性也在此维护。
import './styles/base.css'
import './styles/layout.css'
import type { DisplayMode, MenuAction, SessionState } from '@shared/types'
import { MD_EXTENSIONS } from '@shared/types'
import { store } from '@/state'
import { bus } from '@/bus'
import { initI18n, t } from '@/i18n'
import { initTheme } from '@/theme/apply'
import { initTitlebar } from '@/components/titlebar'
import { initWelcome } from '@/components/welcome'
import { initResize } from '@/components/resize'
import { initToast } from '@/components/toast'
import { initFiletree } from '@/components/filetree'
import { initOutlinePanel } from '@/components/outline'
import { initPalette } from '@/components/palette'
import { initSettingsUI } from '@/components/settings'
import { initViewer } from '@/components/viewer'
import { initEditor } from '@/components/editor'
import { initFindbar } from '@/components/findbar'
import { initTabs } from '@/components/tabs'
import { initSearch } from '@/components/search'
import { initKeyboard } from '@/keyboard'
import { initMermaidModule } from '@/markdown/mermaid'

// window.api 的全局类型声明在 @/i18n(declare global,全编译单元生效)
const api = window.api

// ── 路径工具(契约:路径统一正斜杠)──
const norm = (p: string): string => p.replace(/\\/g, '/')
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const dirname = (p: string): string => {
  const i = p.lastIndexOf('/')
  const d = i > 0 ? p.slice(0, i) : p
  // 盘根:'D:' 是"驱动器相对路径"(指向进程 CWD),必须带斜杠
  return /^[A-Za-z]:$/.test(d) ? `${d}/` : d
}
const isMarkdownPath = (p: string): boolean => {
  const low = p.toLowerCase()
  return MD_EXTENSIONS.some((ext) => low.endsWith(ext))
}

/** 更新 store 内 session 镜像并把补丁持久化到主进程 */
function patchSession(patch: Partial<SessionState>): void {
  store.set({ session: { ...store.get().session, ...patch } })
  void api.setSession(patch)
}

// ── open-file / open-folder 流程 ──

// 打开请求令牌:慢速读盘落后于新一次打开时,旧结果必须作废(防跨文件内容覆盖)
let openSeq = 0

async function openFileFlow(path: string): Promise<void> {
  const p = norm(path)
  if (store.get().dirty) {
    if (store.get().settings.autoSave) {
      // 自动保存开启:不打断用户,先保存再继续切换
      // (doSave 同步捕获待写路径与内容,之后切换文件写盘仍落在原文件)
      bus.emit('save-request')
    } else if (!window.confirm(t('win.confirmDiscardChanges'))) {
      return
    }
  }
  const seq = ++openSeq
  try {
    const fc = await api.readFile(p)
    if (seq !== openSeq) return // 已有更新的打开请求,丢弃本次结果
    store.set({
      currentFile: p,
      content: fc.content,
      mtimeMs: fc.mtimeMs,
      dirty: false,
      outline: [],
      activeHeadingId: null,
      selectedPath: p
    })
    void api.allowRoot(dirname(p)) // 允许 mdr:// 读取该文件所在目录(相对图片等)
    bus.emit('file-loaded')
    patchSession({ openFile: p })
  } catch {
    if (seq !== openSeq) return // 过期的失败不得清掉已成功打开的文件
    bus.emit('toast', { message: t('win.loadError'), kind: 'error' })
    store.set({ currentFile: null, content: '', mtimeMs: 0, dirty: false, outline: [], activeHeadingId: null })
    patchSession({ openFile: null })
  }
}

/** 追加打开文件夹(多根工作区):已存在则忽略;成功后 append 到 rootDirs/trees 并重挂 watcher */
async function addFolderFlow(dir: string): Promise<void> {
  const d = norm(dir)
  const s = store.get()
  if (s.rootDirs.includes(d)) {
    // 已在工作区:仅前插 recentRoots,不重复追加
    const recent = [d, ...s.session.recentRoots.filter((r) => r !== d)].slice(0, 8)
    patchSession({ recentRoots: recent })
    return
  }
  try {
    const tree = await api.readTree(d)
    const rootDirs = [...store.get().rootDirs, d]
    const trees = [...store.get().trees, tree]
    store.set({ rootDirs, trees })
    void api.watch(rootDirs)
    void api.allowRoot(d)
    // recentRoots:前插去重,上限 8
    const recent = [d, ...store.get().session.recentRoots.filter((r) => r !== d)].slice(0, 8)
    patchSession({ rootDirs, recentRoots: recent })
  } catch {
    bus.emit('toast', { message: t('win.loadError'), kind: 'error' })
  }
}

/** 从工作区移除单个根目录;移到 0 个自然回欢迎页 */
function removeFolderFlow(dir: string): void {
  const d = norm(dir)
  const s = store.get()
  const idx = s.rootDirs.indexOf(d)
  if (idx < 0) return
  const prefix = d.endsWith('/') ? d : d + '/'
  // 当前文件在被移除根之下 → 关闭当前文件(dirty 时与 close-folder 同逻辑)
  if (s.currentFile && (s.currentFile === d || s.currentFile.startsWith(prefix))) {
    if (s.dirty) {
      if (s.settings.autoSave) bus.emit('save-request')
      else if (!window.confirm(t('win.confirmDiscardChanges'))) return
    }
    ++openSeq // 作废在途的打开请求
    store.set({
      currentFile: null,
      content: '',
      mtimeMs: 0,
      dirty: false,
      outline: [],
      activeHeadingId: null,
      selectedPath: null
    })
  }
  const rootDirs = s.rootDirs.filter((_, i) => i !== idx)
  const trees = store.get().trees.filter((_, i) => i !== idx)
  store.set({ rootDirs, trees })
  void api.watch(rootDirs.length ? rootDirs : null)
  patchSession({ rootDirs })
}

/** 重读当前文件(reload-file 菜单/确认后的外部修改重载) */
async function reloadCurrent(notify: boolean): Promise<void> {
  const cf = store.get().currentFile
  if (!cf) return
  try {
    const fc = await api.readFile(cf)
    if (store.get().currentFile !== cf) return // 期间已切换文件,过期读丢弃
    if (fc.content === store.get().content) {
      // 内容未变(例如自己保存触发的 watcher 事件):仅同步 mtime
      store.set({ mtimeMs: fc.mtimeMs, dirty: false })
      return
    }
    store.set({ content: fc.content, mtimeMs: fc.mtimeMs, dirty: false })
    bus.emit('file-loaded')
    if (notify) bus.emit('toast', { message: t('win.externalChangeReload'), kind: 'info' })
  } catch {
    bus.emit('toast', { message: t('win.loadError'), kind: 'error' })
  }
}

/** 当前文件被外部修改:自己保存的回声(mtime 相同)忽略;未编辑 → 静默重载;已编辑 → confirm */
async function onExternalFileChanged(path: string): Promise<void> {
  const p = norm(path)
  if (p !== store.get().currentFile) return
  try {
    const fc = await api.readFile(p)
    const s = store.get()
    if (s.currentFile !== p) return // 期间已切换文件
    if (fc.mtimeMs === s.mtimeMs) return // 自己保存触发的 watcher 回声
    if (fc.content === s.content) {
      store.set({ mtimeMs: fc.mtimeMs })
      return
    }
    if (s.dirty && !window.confirm(t('fileModifiedExternallyMessage'))) return
    if (store.get().currentFile !== p) return
    store.set({ content: fc.content, mtimeMs: fc.mtimeMs, dirty: false })
    bus.emit('file-loaded')
    bus.emit('toast', { message: t('win.externalChangeReload'), kind: 'info' })
  } catch {
    // 文件可能已被删除/占用;目录树刷新会呈现最终状态,这里不打扰
  }
}

// ── 菜单/快捷键动作分发(原生菜单 EvMenuAction 与本地 keydown 双入口,50ms 去重)──

let lastAction: MenuAction | '' = ''
let lastActionTs = 0

function dispatchAction(action: MenuAction): void {
  const now = Date.now()
  if (action === lastAction && now - lastActionTs < 50) return
  lastAction = action
  lastActionTs = now
  switch (action) {
    case 'open-file':
      void pickAndOpen('file')
      break
    case 'open-folder':
      void pickAndOpen('folder')
      break
    case 'new-file':
      void createNewFile()
      break
    case 'save':
      bus.emit('save-request')
      break
    case 'export-pdf':
      void exportPdfFlow()
      break
    case 'settings':
      bus.emit('show-settings')
      break
    case 'toggle-sidebar': {
      const v = !store.get().sidebarVisible
      store.set({ sidebarVisible: v })
      patchSession({ sidebarVisible: v })
      break
    }
    case 'toggle-outline': {
      const v = !store.get().outlineVisible
      store.set({ outlineVisible: v })
      patchSession({ outlineVisible: v })
      break
    }
    case 'mode-rendered':
      setMode('rendered')
      break
    case 'mode-raw':
      setMode('raw')
      break
    case 'mode-toggle':
      setMode(store.get().mode === 'rendered' ? 'raw' : 'rendered')
      break
    case 'zoom-in':
      setZoom(store.get().zoom + 0.1)
      break
    case 'zoom-out':
      setZoom(store.get().zoom - 0.1)
      break
    case 'zoom-reset':
      setZoom(1)
      break
    case 'find':
      bus.emit('show-find')
      break
    // findbar(D)监听 window 'app:find-next' / 'app:find-prev' 两个 CustomEvent
    case 'find-next':
      window.dispatchEvent(new CustomEvent('app:find-next'))
      break
    case 'find-prev':
      window.dispatchEvent(new CustomEvent('app:find-prev'))
      break
    case 'palette':
      bus.emit('show-palette')
      break
    case 'reload-file':
      void reloadCurrent(false)
      break
    case 'close-tab':
      bus.emit('close-active-tab')
      break
    case 'next-tab':
      bus.emit('cycle-tab')
      break
    case 'search':
      bus.emit('show-search')
      break
  }
}

async function pickAndOpen(kind: 'file' | 'folder'): Promise<void> {
  const p = await api.openDialog(kind)
  if (!p) return
  bus.emit(kind === 'file' ? 'open-file' : 'open-folder', norm(p))
}

/** 新建文件:第一个根目录下生成不重名的「未命名 N.md」并打开;树由 watcher 自动刷新 */
async function createNewFile(): Promise<void> {
  const root = store.get().rootDirs[0]
  if (!root) return
  const base = t('win.newFileDefaultName')
  let name = `${base}.md`
  for (let i = 2; i < 100 && (await api.exists(`${root}/${name}`)); i++) name = `${base} ${i}.md`
  try {
    const r = await api.createEntry(root, name, 'file')
    bus.emit('open-file', norm(r.path))
  } catch {
    bus.emit('toast', { message: t('win.saveFailed'), kind: 'error' })
  }
}

async function exportPdfFlow(): Promise<void> {
  const cf = store.get().currentFile
  const suggested = cf ? basename(cf).replace(/\.[^.]+$/, '') || 'document' : 'document'
  try {
    const r = await api.exportPdf(suggested)
    if (r.ok) {
      bus.emit('toast', { message: t('win.exportPdfSuccess', { path: r.path ?? '' }), kind: 'success' })
    } else if (r.error) {
      // 无 error 视为用户取消,不提示
      bus.emit('toast', { message: t('win.exportPdfFailed'), kind: 'error' })
    }
  } catch {
    bus.emit('toast', { message: t('win.exportPdfFailed'), kind: 'error' })
  }
}

function setMode(mode: DisplayMode): void {
  store.set({ mode })
  patchSession({ displayMode: mode })
}

function setZoom(z: number): void {
  const zoom = Math.min(3, Math.max(0.5, Math.round(z * 10) / 10))
  store.set({ zoom })
  patchSession({ zoom })
}

// ── store → DOM 绑定(模式属性/面板显隐/welcome 显隐/窗口标题)──

function bindStoreToDom(): void {
  const html = document.documentElement
  const welcomeEl = document.getElementById('welcome')
  const viewerScroll = document.getElementById('viewer-scroll')
  const editorEl = document.getElementById('editor')

  // data-mode + 三个内容区显隐:无文件时只显示 welcome
  const syncView = (): void => {
    const s = store.get()
    html.dataset.mode = s.mode
    const hasFile = !!s.currentFile
    if (welcomeEl) welcomeEl.hidden = hasFile
    if (viewerScroll) viewerScroll.hidden = !hasFile || s.mode !== 'rendered'
    if (editorEl) editorEl.hidden = !hasFile || s.mode !== 'raw'
  }
  store.on('mode', syncView)
  store.on('currentFile', syncView)
  syncView()

  // 侧栏/大纲显隐(layout.css 按 data-sidebar/data-outline 折叠)
  const syncPanels = (): void => {
    const s = store.get()
    html.dataset.sidebar = String(s.sidebarVisible)
    html.dataset.outline = String(s.outlineVisible)
  }
  store.on('sidebarVisible', syncPanels)
  store.on('outlineVisible', syncPanels)
  syncPanels()

  // 原生窗口标题
  const syncTitle = (): void => {
    const cf = store.get().currentFile
    void api.setTitle(cf ? `${basename(cf)} — ${t('appName')}` : t('appName'))
  }
  store.on('currentFile', syncTitle)
  syncTitle()
}

// ── 启动 ──

async function bootstrap(): Promise<void> {
  // 1. 语言解析
  await initI18n()

  // 2. settings/session 载入 store(zoom/mode/面板状态从 session 恢复)
  const [settings, session] = await Promise.all([api.getSettings(), api.getSession()])
  store.set({
    settings,
    session,
    zoom: session.zoom,
    mode: session.displayMode,
    sidebarVisible: session.sidebarVisible,
    outlineVisible: session.outlineVisible,
    sidebarWidth: session.sidebarWidth,
    outlineWidth: session.outlineWidth,
    systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // bus 流程注册(先于组件初始化与会话恢复)
  bus.on('open-file', (p) => {
    void openFileFlow(p as string)
  })
  bus.on('open-folder', (p) => {
    void addFolderFlow(p as string)
  })
  // 从工作区移除单个根目录
  bus.on('remove-folder', (p) => {
    if (typeof p === 'string' && p) removeFolderFlow(p)
  })
  // 关闭全部文件夹:清空树与当前文件,回到欢迎页
  bus.on('close-folder', () => {
    const s = store.get()
    if (s.dirty) {
      if (s.settings.autoSave) bus.emit('save-request')
      else if (!window.confirm(t('win.confirmDiscardChanges'))) return
    }
    ++openSeq // 作废在途的打开请求
    store.set({
      rootDirs: [],
      trees: [],
      currentFile: null,
      content: '',
      mtimeMs: 0,
      dirty: false,
      outline: [],
      activeHeadingId: null,
      selectedPath: null
    })
    void api.watch(null)
    patchSession({ rootDirs: [], openFile: null })
  })

  bindStoreToDom()

  // 3. 主题;4. 各组件
  initTheme()
  initTitlebar()
  initWelcome()
  initResize()
  initToast()
  initFiletree()
  initOutlinePanel()
  initPalette()
  initSettingsUI()
  initViewer()
  initEditor()
  initFindbar()
  initTabs()
  initSearch()
  initKeyboard()
  initMermaidModule()

  // 6. 主进程推送接线。菜单动作与 keyboard.ts 的本地 keydown 走同一 dispatchAction(50ms 去重)
  api.onMenuAction(dispatchAction)
  window.addEventListener('app:menu-action', (e) => dispatchAction((e as CustomEvent<MenuAction>).detail))

  api.onOpenPath((raw) => {
    const p = norm(raw)
    if (isMarkdownPath(p)) {
      // 尚无根目录时先打开其父目录,再打开文件(已有根时不追加,保持工作区不变)
      if (store.get().rootDirs.length === 0) bus.emit('open-folder', dirname(p))
      bus.emit('open-file', p)
    } else {
      bus.emit('open-folder', p)
    }
  })
  api.onFileChanged((p) => void onExternalFileChanged(p))
  api.onTreeChanged((trees) => store.set({ trees }))
  api.onSystemThemeChanged((dark) => store.set({ systemDark: dark }))

  // 5. 会话恢复:逐个 emit open-folder(addFolderFlow 天然去重追加;watch 会被多次覆盖,最后一次为准)
  for (const r of session.rootDirs) bus.emit('open-folder', r)
  if (session.openFile) bus.emit('open-file', session.openFile)

  // 脏状态镜像到主进程:关闭拦截在 main 做(beforeunload 里 confirm 被 Chromium 屏蔽,不可用)
  store.on('dirty', (d) => void api.setDirty(d))
  // currentFile 变化统一持久化(覆盖 filetree 重命名/删除直接改 store 的路径)
  store.on('currentFile', (cf) => {
    patchSession({ openFile: cf })
  })

  // 拖放打开:.md 文件或目录拖入窗口即打开(经 preload webUtils 取真实路径)
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => {
    e.preventDefault()
    // 树内拖拽移动(filetree 自带 MIME 标记)→ 不当作外部文件打开
    if (e.dataTransfer?.types.includes('application/x-mdr-path')) return
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    try {
      const raw = api.pathForFile(f)
      if (!raw) return
      const p = norm(raw)
      if (isMarkdownPath(p)) {
        // 与 onOpenPath 语义一致:尚无根目录时先带出该文件所在文件夹作上下文
        if (store.get().rootDirs.length === 0) bus.emit('open-folder', dirname(p))
        bus.emit('open-file', p)
      } else {
        // 无扩展名视为目录(File 对象拿不到 isDirectory;交给 open-folder 流程报错兜底);拖入文件夹 = 追加
        bus.emit('open-folder', p)
      }
    } catch {
      // 忽略取路径失败
    }
  })

  // 8. 就绪 — 主进程此后才推送 EvOpenPath
  api.ready()
}

void bootstrap().catch((err) => console.error('[app] bootstrap failed:', err))
