// 主进程入口 — 窗口/单实例/argv 打开路径/系统主题/生命周期
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, shell } from 'electron'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import type { WindowBounds } from '@shared/types'
import { isMarkdownPath, isTextPath } from '@shared/types'
import { registerIpc, wireFindEvents } from './ipc'
import { setupMenu } from './menu'
import { registerProtocol } from './protocol'
import { flushStore, getSession, setSession } from './store'
import { initWatcher, stopWatcher } from './watcher'

// mdr 特权 scheme 必须在 app ready 之前注册
protocol.registerSchemesAsPrivileged([
  { scheme: 'mdr', privileges: { supportFetchAPI: true, stream: true } }
])

// 测试钩子:允许 e2e 用独立 userData,避免污染真实用户数据
if (process.env.MDR_USER_DATA) {
  app.setPath('userData', process.env.MDR_USER_DATA)
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
const pendingOpenPaths: string[] = []
// 渲染器脏状态镜像(WinSetDirty);关闭拦截据此弹原生确认框
let rendererDirty = false
let forceClose = false

const norm = (p: string): string => p.replace(/\\/g, '/')

// 从 argv 提取存在于磁盘的 md/文本文件或目录(跳过开关参数/应用自身路径)
function extractOpenPaths(argv: string[], baseDir: string): string[] {
  const out: string[] = []
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue
    try {
      const abs = path.resolve(baseDir, raw)
      if (abs === app.getAppPath() || abs === path.resolve(process.execPath)) continue
      if (!existsSync(abs)) continue
      const st = statSync(abs)
      if (st.isDirectory() || (st.isFile() && (isMarkdownPath(abs) || isTextPath(abs)))) {
        out.push(norm(abs))
      }
    } catch {
      // 非法参数忽略
    }
  }
  return out
}

// 渲染器就绪前排队,就绪后直接推送
function deliverOpenPath(p: string): void {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.EvOpenPath, p)
  } else {
    pendingOpenPaths.push(p)
  }
}

// 恢复上次窗口位置;校验落在某显示器工作区内并夹取
function restoreBounds(): WindowBounds {
  const def: WindowBounds = { width: 1200, height: 800, maximized: false }
  const wb = getSession().windowBounds
  if (!wb || typeof wb.width !== 'number' || typeof wb.height !== 'number') return def
  let width = Math.max(720, Math.floor(wb.width))
  let height = Math.max(480, Math.floor(wb.height))
  const maximized = wb.maximized === true
  if (typeof wb.x !== 'number' || typeof wb.y !== 'number') return { width, height, maximized }
  const x0 = Math.floor(wb.x)
  const y0 = Math.floor(wb.y)
  const wa = screen.getDisplayMatching({ x: x0, y: y0, width, height }).workArea
  width = Math.min(width, wa.width)
  height = Math.min(height, wa.height)
  const x = Math.min(Math.max(x0, wa.x), wa.x + wa.width - width)
  const y = Math.min(Math.max(y0, wa.y), wa.y + wa.height - height)
  return { x, y, width, height, maximized }
}

function createWindow(): void {
  const b = restoreBounds()
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: b.width,
    height: b.height,
    ...(typeof b.x === 'number' && typeof b.y === 'number' ? { x: b.x, y: b.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: dark ? '#1e1e1e' : '#ffffff',
    titleBarStyle: 'hidden',
    // 初始配色按系统明暗;之后渲染器主题模块经 WinSetOverlay 同步
    titleBarOverlay: {
      height: 40,
      color: dark ? '#1e1e1e' : '#ffffff',
      symbolColor: dark ? '#cccccc' : '#333333'
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    if (b.maximized) win.maximize()
    win.show()
  })

  // 关闭时把窗口位置写入 session(will-quit 时 flush)
  win.on('close', (e) => {
    try {
      const nb = win.getNormalBounds()
      setSession({
        windowBounds: { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized: win.isMaximized() }
      })
    } catch {
      // 窗口已销毁等边界情况忽略
    }
    // 脏文件关闭确认:beforeunload 里 confirm 被 Chromium 屏蔽,只能在主进程拦截
    if (rendererDirty && !forceClose) {
      e.preventDefault()
      const zh = app.getLocale().toLowerCase().startsWith('zh')
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          buttons: zh ? ['放弃更改并关闭', '取消'] : ['Discard Changes and Close', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          message: zh ? '有未保存的更改' : 'You have unsaved changes',
          detail: zh
            ? '关闭窗口将丢失未保存的修改。可先按 Ctrl+S 保存。'
            : 'Closing now will lose unsaved edits. Press Ctrl+S to save first.'
        })
        .then(({ response }) => {
          if (response === 0 && !win.isDestroyed()) {
            forceClose = true
            win.close()
          }
        })
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // 仅开发环境:F12 / Ctrl+Shift+I 切换 DevTools
  win.webContents.on('before-input-event', (e, input) => {
    if (app.isPackaged || input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools()
      e.preventDefault()
    }
  })

  // 禁止新开窗口/页面内导航;http(s) 丢给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  wireFindEvents(win)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function onReady(): void {
  registerProtocol()
  registerIpc()
  setupMenu()
  initWatcher(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null))

  // 渲染器就绪 → flush 排队的打开请求(文件关联/命令行参数)
  ipcMain.on(IPC.RendererReady, () => {
    rendererReady = true
    while (pendingOpenPaths.length > 0) {
      const p = pendingOpenPaths.shift()
      if (p && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.EvOpenPath, p)
      }
    }
  })

  // 脏状态镜像(关闭拦截用)
  ipcMain.handle(IPC.WinSetDirty, (_e, d: boolean) => {
    rendererDirty = d === true
  })

  // 系统明暗切换 → 推送渲染器(theme='auto' 时消费)
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EvSystemThemeChanged, nativeTheme.shouldUseDarkColors)
    }
  })

  createWindow()
  for (const p of extractOpenPaths(process.argv, process.cwd())) deliverOpenPath(p)
}

// 单实例锁:二次启动把其 argv 路径转给首实例并前置窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv, workingDirectory) => {
    for (const p of extractOpenPaths(argv, workingDirectory)) deliverOpenPath(p)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(onReady)

  app.on('window-all-closed', () => {
    void stopWatcher()
    app.quit()
  })

  app.on('will-quit', () => {
    flushStore()
  })
}
