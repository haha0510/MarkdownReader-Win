// IPC 注册 — src/shared/ipc.ts 全部 invoke 通道在此接线
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, OpenDialogOptions } from 'electron'
import path from 'path'
import { IPC } from '@shared/ipc'
import type { FindOptions } from '@shared/ipc'
import type { PopupItem, SessionState, Settings } from '@shared/types'
import * as files from './files'
import { exportPdf } from './pdf'
import { allowRoot } from './protocol'
import { getSession, getSettings, setSession, setSettings } from './store'
import { setWatchRoots } from './watcher'

const norm = (p: string): string => p.replace(/\\/g, '/')

const winOf = (e: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)

// 右键菜单:原生 Menu.popup,resolve 点击项 id;未点击关闭 → null
function popupMenu(e: IpcMainInvokeEvent, items: PopupItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false
    const done = (v: string | null): void => {
      if (!resolved) {
        resolved = true
        resolve(v)
      }
    }
    const template: MenuItemConstructorOptions[] = items.map((it) =>
      it.type === 'separator'
        ? { type: 'separator' as const }
        : {
            // danger 项无原生样式支持,仅按普通项显示
            label: it.label ?? '',
            enabled: it.enabled !== false,
            click: (): void => done(it.id ?? null)
          }
    )
    const menu = Menu.buildFromTemplate(template)
    const win = winOf(e)
    menu.popup({
      window: win ?? undefined,
      // 关闭回调可能先于 click 触发,延迟兜底 resolve(null)
      callback: () => setTimeout(() => done(null), 150)
    })
  })
}

export function registerIpc(): void {
  // ── 对话框 ──
  ipcMain.handle(IPC.DialogOpen, async (e, kind: 'file' | 'folder') => {
    const opts: OpenDialogOptions =
      kind === 'file'
        ? {
            properties: ['openFile'],
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] }]
          }
        : { properties: ['openDirectory'] }
    const win = winOf(e)
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return norm(r.filePaths[0])
  })

  // ── 文件系统 ──
  ipcMain.handle(IPC.FsReadTree, (_e, rootDir: string) => files.readTree(rootDir))
  ipcMain.handle(IPC.FsReadFile, (_e, p: string) => files.readFile(p))
  ipcMain.handle(IPC.FsWriteFile, (_e, p: string, content: string) => files.writeFile(p, content))
  ipcMain.handle(IPC.FsCreate, (_e, dirPath: string, name: string, kind: 'file' | 'folder') =>
    files.createEntry(dirPath, name, kind)
  )
  ipcMain.handle(IPC.FsRename, (_e, p: string, newName: string) => files.renameEntry(p, newName))
  ipcMain.handle(IPC.FsMove, (_e, src: string, destDir: string) => files.moveEntry(src, destDir))
  ipcMain.handle(IPC.FsDelete, (_e, p: string) => files.deleteEntry(p))
  ipcMain.handle(IPC.FsExists, (_e, p: string) => files.exists(p))
  ipcMain.handle(IPC.FsWatch, (_e, roots: string[] | null) =>
    setWatchRoots(Array.isArray(roots) ? roots : null)
  )
  ipcMain.handle(IPC.FsReveal, (_e, p: string) => {
    shell.showItemInFolder(path.normalize(path.resolve(p)))
  })

  // ── 设置 / 会话 ──
  ipcMain.handle(IPC.SettingsGet, () => getSettings())
  ipcMain.handle(IPC.SettingsSet, (_e, patch: Partial<Settings>) => setSettings(patch))
  ipcMain.handle(IPC.SessionGet, () => getSession())
  ipcMain.handle(IPC.SessionSet, (_e, patch: Partial<SessionState>) => {
    setSession(patch)
  })

  // ── PDF 导出 ──
  ipcMain.handle(IPC.ExportPdf, (e, suggestedName: string) => {
    const win = winOf(e)
    if (!win) return { ok: false, error: 'no window' }
    return exportPdf(win, String(suggestedName ?? ''))
  })

  // ── 系统打印(渲染内容;@media print 已隐藏界面元素)──
  ipcMain.handle(IPC.Print, (e) => {
    e.sender.print({ printBackground: true }, () => {
      // 用户取消或完成均无需处理
    })
  })

  // ── 页内查找 ──
  ipcMain.handle(IPC.FindStart, (e, text: string, opts?: FindOptions) => {
    if (!text) {
      e.sender.stopFindInPage('clearSelection')
      return
    }
    e.sender.findInPage(text, {
      forward: opts?.forward ?? true,
      findNext: opts?.findNext ?? false,
      matchCase: opts?.matchCase ?? false
    })
  })
  ipcMain.handle(IPC.FindStop, (e, action: 'clearSelection' | 'keepSelection') => {
    e.sender.stopFindInPage(action)
  })

  // ── 杂项 ──
  ipcMain.handle(IPC.MenuPopup, (e, items: PopupItem[]) => popupMenu(e, Array.isArray(items) ? items : []))
  ipcMain.handle(IPC.OpenExternal, (_e, url: string) => {
    // 仅放行 http/https
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })
  ipcMain.handle(IPC.WinSetTitle, (e, title: string) => {
    winOf(e)?.setTitle(String(title ?? ''))
  })
  ipcMain.handle(IPC.WinSetOverlay, (e, colors: { color: string; symbolColor: string }) => {
    try {
      winOf(e)?.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 40 })
    } catch {
      // 无 overlay(异常配置)时忽略
    }
  })
  ipcMain.handle(IPC.AppGetLocale, () => app.getLocale())
  ipcMain.handle(IPC.AppGetInfo, () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.handle(IPC.ProtocolAllowRoot, (_e, dir: string) => {
    allowRoot(dir)
  })
}

// 查找结果推送:仅转发 finalUpdate,避免中间态刷屏
export function wireFindEvents(win: BrowserWindow): void {
  win.webContents.on('found-in-page', (_e, result) => {
    if (result.finalUpdate && !win.isDestroyed()) {
      win.webContents.send(IPC.EvFindResult, {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches
      })
    }
  })
}
