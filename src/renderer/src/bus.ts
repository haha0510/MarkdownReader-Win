// 渲染器内部事件总线 — 组件间解耦通信。
// 事件目录(载荷类型)见 design/CONTRACTS.md 第 5 节。
type Handler = (payload?: unknown) => void

export type BusEvent =
  | 'open-file' // (path: string) 请求打开文件
  | 'open-folder' // (path: string) 请求打开目录
  | 'file-loaded' // () 文件内容已载入 store
  | 'rendered' // () viewer 完成一次渲染(大纲/滚动可用)
  | 'theme-changed' // () CSS 变量已应用(mermaid 等需重渲染)
  | 'scroll-to-heading' // (id: string)
  | 'show-find' // ()
  | 'show-palette' // ()
  | 'show-settings' // ()
  | 'close-overlays' // () Esc 语义
  | 'save-request' // ()
  | 'toast' // ({ message: string; kind?: 'info'|'error'|'success' })
  | 'reveal-in-tree' // (path: string)

const handlers = new Map<BusEvent, Set<Handler>>()

export const bus = {
  on(event: BusEvent, fn: Handler): () => void {
    let set = handlers.get(event)
    if (!set) {
      set = new Set()
      handlers.set(event, set)
    }
    set.add(fn)
    return () => set.delete(fn)
  },
  emit(event: BusEvent, payload?: unknown): void {
    handlers.get(event)?.forEach((fn) => fn(payload))
  }
}
