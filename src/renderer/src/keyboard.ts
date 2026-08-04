// 全局键盘 — 本地处理契约 §7 的全部快捷键(原生菜单加速键是双保险:
// 窗口失焦 / 自动化输入等场景原生菜单不触发,本地 keydown 兜底)。
// 动作经 window CustomEvent 'app:menu-action' 转发,app.ts 与原生菜单 EvMenuAction
// 走同一分发入口并做 50ms 去重(双触发时只生效一次)。
import type { MenuAction } from '@shared/types'
import { bus } from '@/bus'

function send(action: MenuAction): void {
  window.dispatchEvent(new CustomEvent<MenuAction>('app:menu-action', { detail: action }))
}

export function initKeyboard(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing) return // IME 组合中不处理
      if (e.key === 'Escape') {
        bus.emit('close-overlays')
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        send(e.shiftKey ? 'find-prev' : 'find-next')
        return
      }
      if (!e.ctrlKey || e.altKey || e.metaKey) {
        // Ctrl+Alt+E 导出 PDF 是唯一带 Alt 的组合
        if (e.ctrlKey && e.altKey && !e.metaKey && e.key.toLowerCase() === 'e') {
          e.preventDefault()
          send('export-pdf')
        }
        return
      }
      const k = e.key.toLowerCase()
      // 缩放:阻止 Chromium 页面缩放,改为正文缩放
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault()
        send('zoom-in')
        return
      }
      if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        send('zoom-out')
        return
      }
      if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault()
        send('zoom-reset')
        return
      }
      // Shift 会改变 e.key(如 Shift+\ → |),反斜杠用物理键码判断
      if (e.code === 'Backslash') {
        e.preventDefault()
        send(e.shiftKey ? 'toggle-outline' : 'toggle-sidebar')
        return
      }
      // Ctrl+Tab 切换标签
      if (e.key === 'Tab') {
        e.preventDefault()
        send('next-tab')
        return
      }
      // 契约 §7 其余组合(与原生菜单加速键一致,经 app.ts 去重)
      const plain: Record<string, MenuAction> = {
        o: 'open-file',
        n: 'new-file',
        s: 'save',
        f: 'find',
        g: 'find-next',
        p: 'palette',
        w: 'close-tab',
        ',': 'settings'
      }
      const shifted: Record<string, MenuAction> = {
        o: 'open-folder',
        e: 'mode-rendered',
        r: 'mode-raw',
        g: 'find-prev',
        f: 'search'
      }
      const action = e.shiftKey ? shifted[k] : plain[k]
      if (action) {
        e.preventDefault()
        send(action)
      }
    },
    { capture: true }
  )

  // Ctrl+滚轮:在渲染视图上缩放正文
  document.getElementById('viewer-scroll')?.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      send(e.deltaY < 0 ? 'zoom-in' : 'zoom-out')
    },
    { passive: false }
  )
}
