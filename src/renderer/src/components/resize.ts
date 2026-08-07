// 面板宽度拖拽 — #resize-left(侧栏 180–480)/ #resize-right(大纲 160–400)。
// 拖动实时写 store + CSS 变量;动态保留正文最小宽度;pointerup 持久化到 session。
import type { SessionState } from '@shared/types'
import type { AppState } from '@/state'
import { store } from '@/state'

interface HandleSpec {
  id: string
  key: 'sidebarWidth' | 'outlineWidth'
  cssVar: string
  min: number
  max: number
  def: number
  /** 鼠标向右移动时宽度变化方向:1 = 左侧栏增宽,-1 = 右侧大纲减宽 */
  dir: 1 | -1
}

const SPECS: HandleSpec[] = [
  { id: 'resize-left', key: 'sidebarWidth', cssVar: '--sidebar-width', min: 180, max: 480, def: 240, dir: 1 },
  { id: 'resize-right', key: 'outlineWidth', cssVar: '--outline-width', min: 160, max: 400, def: 220, dir: -1 }
]

const MIN_CONTENT_WIDTH = 480

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(v)))

export function initResize(): void {
  for (const spec of SPECS) setup(spec)
}

function setup(spec: HandleSpec): void {
  const handle = document.getElementById(spec.id)
  const panel = document.getElementById(spec.key === 'sidebarWidth' ? 'sidebar' : 'outline')
  const otherPanel = document.getElementById(spec.key === 'sidebarWidth' ? 'outline' : 'sidebar')
  const layout = document.getElementById('layout')
  if (!handle || !panel || !otherPanel || !layout) return

  // 宽度补丁(sidebarWidth/outlineWidth 在 AppState 与 SessionState 中同名)
  const widthPatch = (w: number): Partial<AppState> & Partial<SessionState> =>
    spec.key === 'sidebarWidth' ? { sidebarWidth: w } : { outlineWidth: w }

  const setVar = (w: number): void => {
    document.documentElement.style.setProperty(spec.cssVar, `${w}px`)
  }
  // 初始 + 跟随 store(其他模块也可能改宽度)
  setVar(store.get()[spec.key])
  store.on(spec.key, setVar)

  const persist = (): void => {
    const w = store.get()[spec.key]
    store.set({ session: { ...store.get().session, ...widthPatch(w) } })
    void window.api.setSession(widthPatch(w))
  }

  let dragging = false
  let startX = 0
  let startW = 0

  const currentMax = (): number => {
    const otherWidth = otherPanel.getBoundingClientRect().width
    const handlesWidth = 8
    const available = layout.clientWidth - otherWidth - handlesWidth - MIN_CONTENT_WIDTH
    const responsiveMax = layout.clientWidth * (spec.key === 'sidebarWidth' ? 0.28 : 0.24)
    return Math.max(spec.min, Math.min(spec.max, available, responsiveMax))
  }

  handle.addEventListener('pointerdown', (e) => {
    dragging = true
    startX = e.clientX
    startW = panel.getBoundingClientRect().width || store.get()[spec.key]
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('dragging')
    document.body.classList.add('resizing')
  })

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const w = clamp(startW + spec.dir * (e.clientX - startX), spec.min, currentMax())
    store.set(widthPatch(w))
  })

  const end = (e: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('dragging')
    document.body.classList.remove('resizing')
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    persist()
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)

  // 双击恢复默认宽度
  handle.addEventListener('dblclick', () => {
    store.set(widthPatch(spec.def))
    persist()
  })
}
