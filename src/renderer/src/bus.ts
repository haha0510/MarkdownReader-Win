// 渲染器内部事件总线 — 组件间解耦通信。
// 事件目录(载荷类型)见 design/CONTRACTS.md 第 5 节。
type Handler = (payload?: unknown) => void

export type BusEvent =
  | 'open-file' // (path: string) 请求打开文件
  | 'open-folder' // (path: string) 请求打开(追加)目录
  | 'remove-folder' // (path: string) 从工作区移除单个根目录
  | 'close-folder' // () 关闭全部目录,回到欢迎页
  | 'show-ai' // () 打开/切换 AI 面板
  | 'ai-ask-selection' // (text: string) 选中文字 → 打开 AI 面板提问
  | 'toggle-translate' // () 切换翻译对照视图
  | 'show-search' // () 全文搜索浮层
  | 'close-active-tab' // () 关闭当前标签
  | 'cycle-tab' // () 切到下一个标签
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
