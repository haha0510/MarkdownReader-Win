// toast — 右下角堆叠提示;3s 自动消失,最多同时 3 条。
import { bus } from '@/bus'

interface ToastPayload {
  message: string
  kind?: 'info' | 'error' | 'success'
}

export function initToast(): void {
  const container = document.getElementById('toast-container')
  if (!container) return

  bus.on('toast', (payload) => {
    const { message, kind = 'info' } = (payload ?? {}) as ToastPayload
    if (!message) return
    while (container.children.length >= 3) container.firstElementChild?.remove()

    const el = document.createElement('div')
    el.className = `toast toast-${kind}`
    el.textContent = message
    container.appendChild(el)
    requestAnimationFrame(() => el.classList.add('show'))
    window.setTimeout(() => {
      el.classList.remove('show')
      window.setTimeout(() => el.remove(), 250) // 等淡出动画结束再移除
    }, 3000)
  })
}
