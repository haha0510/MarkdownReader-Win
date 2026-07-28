// IPC 通道契约 — 名称与载荷。invoke 通道用 ipcRenderer.invoke;ev: 前缀为主进程 → 渲染器单向推送。
import type {
  FileContent,
  FileNode,
  MenuAction,
  PopupItem,
  SessionState,
  Settings
} from './types'

export const IPC = {
  /** invoke ('file'|'folder') → string | null(取消) */
  DialogOpen: 'dialog:open',
  /** invoke (rootDir: string) → FileNode(递归全树,只含 md 文件与目录) */
  FsReadTree: 'fs:readTree',
  /** invoke (path: string) → FileContent */
  FsReadFile: 'fs:readFile',
  /** invoke (path: string, content: string) → { mtimeMs: number } */
  FsWriteFile: 'fs:writeFile',
  /** invoke (dirPath: string, name: string, kind: 'file'|'folder') → { path: string } */
  FsCreate: 'fs:create',
  /** invoke (path: string, newName: string) → { path: string } */
  FsRename: 'fs:rename',
  /** invoke (path: string) → void(移入回收站) */
  FsDelete: 'fs:delete',
  /** invoke (path: string) → boolean */
  FsExists: 'fs:exists',
  /** invoke (rootDir: string | null) → void(null 停止监控) */
  FsWatch: 'fs:watch',
  /** invoke (path: string) → void(资源管理器中显示) */
  FsReveal: 'fs:reveal',

  /** invoke () → Settings */
  SettingsGet: 'settings:get',
  /** invoke (patch: Partial<Settings>) → Settings(合并后持久化) */
  SettingsSet: 'settings:set',
  /** invoke () → SessionState */
  SessionGet: 'session:get',
  /** invoke (patch: Partial<SessionState>) → void */
  SessionSet: 'session:set',

  /** invoke (suggestedName: string) → { ok: boolean; path?: string; error?: string } */
  ExportPdf: 'export:pdf',

  /** invoke (text, opts) → void;结果经 EvFindResult 推送 */
  FindStart: 'find:start',
  /** invoke ('clearSelection'|'keepSelection') → void */
  FindStop: 'find:stop',

  /** invoke (items: PopupItem[]) → string | null(点击项 id) */
  MenuPopup: 'menu:popup',
  /** invoke (url: string) → void(默认浏览器打开) */
  OpenExternal: 'shell:openExternal',
  /** invoke (title: string) → void(原生窗口标题) */
  WinSetTitle: 'win:setTitle',
  /** invoke (colors: { color: string; symbolColor: string }) → void(标题栏 overlay 配色) */
  WinSetOverlay: 'win:setOverlay',
  /** invoke () → string(系统 locale,如 zh-CN) */
  AppGetLocale: 'app:getLocale',
  /** invoke () → { version: string; platform: string } */
  AppGetInfo: 'app:getInfo',
  /** invoke (dir: string) → void(允许 mdr:// 读取的根目录,打开文件/目录时调用) */
  ProtocolAllowRoot: 'protocol:allowRoot',
  /** send-only:渲染器初始化完毕,可接收 EvOpenPath 等推送 */
  RendererReady: 'renderer:ready',

  // ── 主进程 → 渲染器 推送 ──
  /** (tree: FileNode) 监控目录结构变化后的全量新树 */
  EvTreeChanged: 'ev:fs:treeChanged',
  /** (path: string) 当前打开文件被外部修改 */
  EvFileChanged: 'ev:fs:fileChanged',
  /** (path: string) 二次实例 / 文件关联 / argv 要求打开 */
  EvOpenPath: 'ev:openPath',
  /** (action: MenuAction) 原生菜单加速键触发 */
  EvMenuAction: 'ev:menu',
  /** ({ activeMatchOrdinal, matches }: FindResult) */
  EvFindResult: 'ev:find:result',
  /** (dark: boolean) 系统明暗切换(theme='auto' 时用) */
  EvSystemThemeChanged: 'ev:systemTheme'
} as const

export interface FindOptions {
  forward?: boolean
  findNext?: boolean
  matchCase?: boolean
}

export interface FindResult {
  activeMatchOrdinal: number
  matches: number
}

/** preload 暴露到 window.api 的接口 */
export interface RendererApi {
  openDialog(kind: 'file' | 'folder'): Promise<string | null>
  readTree(rootDir: string): Promise<FileNode>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, content: string): Promise<{ mtimeMs: number }>
  createEntry(dirPath: string, name: string, kind: 'file' | 'folder'): Promise<{ path: string }>
  renameEntry(path: string, newName: string): Promise<{ path: string }>
  deleteEntry(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  watch(rootDir: string | null): Promise<void>
  reveal(path: string): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getSession(): Promise<SessionState>
  setSession(patch: Partial<SessionState>): Promise<void>
  exportPdf(suggestedName: string): Promise<{ ok: boolean; path?: string; error?: string }>
  findStart(text: string, opts?: FindOptions): Promise<void>
  findStop(action: 'clearSelection' | 'keepSelection'): Promise<void>
  popupMenu(items: PopupItem[]): Promise<string | null>
  openExternal(url: string): Promise<void>
  setTitle(title: string): Promise<void>
  setOverlay(colors: { color: string; symbolColor: string }): Promise<void>
  getLocale(): Promise<string>
  getInfo(): Promise<{ version: string; platform: string }>
  allowRoot(dir: string): Promise<void>
  /** 渲染器初始化完毕(send,不等待);主进程收到后才 flush 排队的 EvOpenPath */
  ready(): void

  onTreeChanged(cb: (tree: FileNode) => void): void
  onFileChanged(cb: (path: string) => void): void
  onOpenPath(cb: (path: string) => void): void
  onMenuAction(cb: (action: MenuAction) => void): void
  onFindResult(cb: (r: FindResult) => void): void
  onSystemThemeChanged(cb: (dark: boolean) => void): void
}
