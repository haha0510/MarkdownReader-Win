// 应用菜单 — hidden 标题栏下菜单栏不可见,但加速键仍然生效(CONTRACTS §7)
// 菜单项统一转发 EvMenuAction 到聚焦窗口,标签用英文即可
import { app, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'
import type { MenuAction } from '@shared/types'

function sendAction(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.webContents.send(IPC.EvMenuAction, action)
}

const item = (action: MenuAction, label: string, accelerator?: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: () => sendAction(action)
})

export function setupMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        item('open-file', 'Open File…', 'CmdOrCtrl+O'),
        item('open-folder', 'Open Folder…', 'CmdOrCtrl+Shift+O'),
        item('new-file', 'New File', 'CmdOrCtrl+N'),
        { type: 'separator' },
        item('save', 'Save', 'CmdOrCtrl+S'),
        item('export-pdf', 'Export as PDF…', 'CmdOrCtrl+Alt+E'),
        { type: 'separator' },
        item('settings', 'Settings…', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('find', 'Find', 'CmdOrCtrl+F'),
        item('find-next', 'Find Next', 'F3'),
        item('find-next', 'Find Next', 'CmdOrCtrl+G'),
        item('find-prev', 'Find Previous', 'Shift+F3'),
        item('find-prev', 'Find Previous', 'CmdOrCtrl+Shift+G')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('toggle-sidebar', 'Toggle Sidebar', 'CmdOrCtrl+\\'),
        item('toggle-outline', 'Toggle Outline', 'CmdOrCtrl+Shift+\\'),
        { type: 'separator' },
        item('mode-rendered', 'Rendered Mode', 'CmdOrCtrl+Shift+E'),
        item('mode-raw', 'Source Mode', 'CmdOrCtrl+Shift+R'),
        { type: 'separator' },
        item('zoom-in', 'Zoom In', 'CmdOrCtrl+='),
        item('zoom-in', 'Zoom In', 'CmdOrCtrl+numadd'),
        item('zoom-out', 'Zoom Out', 'CmdOrCtrl+-'),
        item('zoom-out', 'Zoom Out', 'CmdOrCtrl+numsub'),
        item('zoom-reset', 'Reset Zoom', 'CmdOrCtrl+0'),
        { type: 'separator' },
        item('palette', 'Go to File…', 'CmdOrCtrl+P')
      ]
    }
  ]
  // 仅开发环境提供 DevTools/Reload(F12 另在 before-input-event 处理)
  if (!app.isPackaged) {
    template.push({
      label: 'Dev',
      submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }]
    })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
