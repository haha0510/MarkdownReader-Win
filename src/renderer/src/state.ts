// 渲染器全局状态存储 — 极简响应式 store。
// 用法: store.get().currentFile / store.set({ zoom: 1.2 }) / store.on('zoom', cb)
import type { DisplayMode, FileNode, OutlineItem, Settings, SessionState } from '@shared/types'
import { DEFAULT_SESSION, DEFAULT_SETTINGS } from '@shared/types'

export interface AppState {
  /** 打开的根目录(单文件模式为 null) */
  rootDir: string | null
  tree: FileNode | null
  /** 当前文件绝对路径 */
  currentFile: string | null
  /** 当前文件内容(编辑中为编辑器内容) */
  content: string
  /** 磁盘上的 mtime,用于外部修改检测 */
  mtimeMs: number
  dirty: boolean
  mode: DisplayMode
  outline: OutlineItem[]
  /** 滚动联动的当前活跃标题 id */
  activeHeadingId: string | null
  settings: Settings
  session: SessionState
  /** 生效的暗色状态(auto 时来自系统) */
  systemDark: boolean
  zoom: number
  sidebarVisible: boolean
  outlineVisible: boolean
  sidebarWidth: number
  outlineWidth: number
  /** 当前 UI 语言(已解析,非 auto) */
  lang: 'zh-Hans' | 'zh-Hant' | 'en'
  /** 文件树中选中的路径 */
  selectedPath: string | null
}

type Listener<K extends keyof AppState> = (value: AppState[K], prev: AppState[K]) => void

const state: AppState = {
  rootDir: null,
  tree: null,
  currentFile: null,
  content: '',
  mtimeMs: 0,
  dirty: false,
  mode: 'rendered',
  outline: [],
  activeHeadingId: null,
  settings: { ...DEFAULT_SETTINGS },
  session: { ...DEFAULT_SESSION },
  systemDark: false,
  zoom: 1,
  sidebarVisible: true,
  outlineVisible: true,
  sidebarWidth: 240,
  outlineWidth: 220,
  lang: 'zh-Hans',
  selectedPath: null
}

const listeners = new Map<keyof AppState, Set<Listener<never>>>()

export const store = {
  get(): Readonly<AppState> {
    return state
  },
  set(patch: Partial<AppState>): void {
    const changed: Array<[keyof AppState, unknown, unknown]> = []
    for (const k of Object.keys(patch) as Array<keyof AppState>) {
      const next = patch[k]
      const prev = state[k]
      if (next !== prev) {
        ;(state as Record<string, unknown>)[k] = next
        changed.push([k, next, prev])
      }
    }
    for (const [k, next, prev] of changed) {
      listeners.get(k)?.forEach((fn) => (fn as Listener<keyof AppState>)(next as never, prev as never))
    }
  },
  on<K extends keyof AppState>(key: K, fn: Listener<K>): () => void {
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(fn as Listener<never>)
    return () => set.delete(fn as Listener<never>)
  }
}
