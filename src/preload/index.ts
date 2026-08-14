// preload — contextBridge 暴露 window.api,1:1 实现 RendererApi(见 src/shared/ipc.ts)
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type { FindOptions, FindResult, RendererApi } from '@shared/ipc'
import type { FileNode, MenuAction, PopupItem, SessionState, Settings } from '@shared/types'

const api: RendererApi = {
  openDialog: (kind: 'file' | 'folder') => ipcRenderer.invoke(IPC.DialogOpen, kind),
  readTree: (rootDir: string) => ipcRenderer.invoke(IPC.FsReadTree, rootDir),
  readFile: (path: string) => ipcRenderer.invoke(IPC.FsReadFile, path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke(IPC.FsWriteFile, path, content),
  createEntry: (dirPath: string, name: string, kind: 'file' | 'folder') =>
    ipcRenderer.invoke(IPC.FsCreate, dirPath, name, kind),
  renameEntry: (path: string, newName: string) => ipcRenderer.invoke(IPC.FsRename, path, newName),
  moveEntry: (srcPath: string, destDir: string) => ipcRenderer.invoke(IPC.FsMove, srcPath, destDir),
  searchContent: (roots: string[], query: string) => ipcRenderer.invoke(IPC.FsSearch, roots, query),
  aiStream: (req) => ipcRenderer.invoke(IPC.AiStream, req),
  aiCancel: (id: string) => ipcRenderer.invoke(IPC.AiCancel, id),
  aiTest: (cfg) => ipcRenderer.invoke(IPC.AiTest, cfg),
  onAiDelta: (cb) => {
    ipcRenderer.on(IPC.EvAiDelta, (_e, d) => cb(d))
  },
  deleteEntry: (path: string) => ipcRenderer.invoke(IPC.FsDelete, path),
  exists: (path: string) => ipcRenderer.invoke(IPC.FsExists, path),
  watch: (roots: string[] | null) => ipcRenderer.invoke(IPC.FsWatch, roots),
  reveal: (path: string) => ipcRenderer.invoke(IPC.FsReveal, path),

  dataGet: (name: string) => ipcRenderer.invoke(IPC.DataGet, name),
  dataSet: (name: string, value: unknown) => ipcRenderer.invoke(IPC.DataSet, name, value),
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.SettingsSet, patch),
  getSession: () => ipcRenderer.invoke(IPC.SessionGet),
  setSession: (patch: Partial<SessionState>) => ipcRenderer.invoke(IPC.SessionSet, patch),

  exportPdf: (suggestedName: string) => ipcRenderer.invoke(IPC.ExportPdf, suggestedName),
  print: () => ipcRenderer.invoke(IPC.Print),

  findStart: (text: string, opts?: FindOptions) => ipcRenderer.invoke(IPC.FindStart, text, opts),
  findStop: (action: 'clearSelection' | 'keepSelection') => ipcRenderer.invoke(IPC.FindStop, action),

  popupMenu: (items: PopupItem[]) => ipcRenderer.invoke(IPC.MenuPopup, items),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OpenExternal, url),
  setTitle: (title: string) => ipcRenderer.invoke(IPC.WinSetTitle, title),
  setOverlay: (colors: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke(IPC.WinSetOverlay, colors),
  setDirty: (dirty: boolean) => ipcRenderer.invoke(IPC.WinSetDirty, dirty),
  getLocale: () => ipcRenderer.invoke(IPC.AppGetLocale),
  getInfo: () => ipcRenderer.invoke(IPC.AppGetInfo),
  allowRoot: (dir: string) => ipcRenderer.invoke(IPC.ProtocolAllowRoot, dir),
  // 拖拽 File → 绝对路径(渲染器 sandbox 拿不到 File.path,Electron 38 须经 webUtils)
  pathForFile: (file: File) => webUtils.getPathForFile(file).replace(/\\/g, '/'),

  // 渲染器初始化完毕(send 单向);主进程收到后才推送排队的 EvOpenPath
  ready: () => {
    ipcRenderer.send(IPC.RendererReady)
  },

  // ── 主进程 → 渲染器推送 ──
  onTreeChanged: (cb: (trees: FileNode[]) => void) => {
    ipcRenderer.on(IPC.EvTreeChanged, (_e, trees: FileNode[]) => cb(trees))
  },
  onFileChanged: (cb: (path: string) => void) => {
    ipcRenderer.on(IPC.EvFileChanged, (_e, p: string) => cb(p))
  },
  onOpenPath: (cb: (path: string) => void) => {
    ipcRenderer.on(IPC.EvOpenPath, (_e, p: string) => cb(p))
  },
  onMenuAction: (cb: (action: MenuAction) => void) => {
    ipcRenderer.on(IPC.EvMenuAction, (_e, action: MenuAction) => cb(action))
  },
  onFindResult: (cb: (r: FindResult) => void) => {
    ipcRenderer.on(IPC.EvFindResult, (_e, r: FindResult) => cb(r))
  },
  onSystemThemeChanged: (cb: (dark: boolean) => void) => {
    ipcRenderer.on(IPC.EvSystemThemeChanged, (_e, dark: boolean) => cb(dark))
  }
}

contextBridge.exposeInMainWorld('api', api)
