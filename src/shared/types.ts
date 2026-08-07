// 共享类型 — 主进程 / preload / 渲染器三方契约。修改需同步 design/CONTRACTS.md。

/** 目录树节点。path 一律为绝对路径,统一使用正斜杠 `/` 分隔。 */
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  /** 仅目录有;按 目录在前、名称不分大小写 排序 */
  children?: FileNode[]
}

/** 大纲条目(从 markdown 标题提取) */
export interface OutlineItem {
  /** 1-6 */
  level: number
  /** 纯文本标题 */
  text: string
  /** 渲染 HTML 中对应 heading 元素的 id(slug) */
  id: string
  /** 源文件中的 0-based 行号 */
  line: number
}

/** 主题定义:5 基色 + 元信息(与 design/themes.json 一致) */
export interface ThemeDef {
  id: string
  name: string
  dark: boolean
  colors: Record<string, string>
}

export type DisplayMode = 'rendered' | 'raw'
export type Language = 'auto' | 'zh-Hans' | 'zh-Hant' | 'en'

export interface Settings {
  /** 主题 id,或 'auto' 表示跟随系统明暗 */
  theme: string
  /** theme === 'auto' 时,明/暗各用哪个主题 id */
  lightTheme: string
  darkTheme: string
  /** 正文字号 px */
  fontSize: number
  /** 正文行高(倍数) */
  lineHeight: number
  /** 正文最大宽度 px;0 = 跟随可用内容区 */
  contentWidth: number
  /** 编辑器(原文模式)字号 px */
  editorFontSize: number
  language: Language
  /** PlantUML 渲染服务器;空字符串 = 禁用 PlantUML */
  plantumlServer: string
  /** 编辑器自动换行 */
  editorWordWrap: boolean
  /** 自动保存:编辑停顿后自动写回本地文件 */
  autoSave: boolean
  /** AI 服务地址(OpenAI 兼容,如 https://api.deepseek.com) */
  aiBaseUrl: string
  /** AI API Key */
  aiApiKey: string
  /** AI 模型名(如 deepseek-chat / gpt-4o-mini) */
  aiModel: string
  /** 翻译目标语言 */
  aiTargetLang: string
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** 会话状态(窗口恢复) */
export interface SessionState {
  /** 工作区根目录列表(VS Code 式多根;空数组 = 未打开目录) */
  rootDirs: string[]
  openFile: string | null
  windowBounds?: WindowBounds
  expandedDirs: string[]
  /** path -> 滚动比例 0..1 */
  scrollPositions: Record<string, number>
  /** 缩放,1 = 100% */
  zoom: number
  displayMode: DisplayMode
  sidebarVisible: boolean
  outlineVisible: boolean
  sidebarWidth: number
  outlineWidth: number
  recentRoots: string[]
  /** 打开的标签页(文件绝对路径,顺序即显示顺序) */
  openTabs: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  lightTheme: 'buddy-light',
  darkTheme: 'buddy-dark',
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 0,
  editorFontSize: 14,
  language: 'auto',
  plantumlServer: 'https://www.plantuml.com/plantuml',
  editorWordWrap: true,
  autoSave: true,
  aiBaseUrl: '',
  aiApiKey: '',
  aiModel: 'deepseek-chat',
  aiTargetLang: '中文'
}

export const DEFAULT_SESSION: SessionState = {
  rootDirs: [],
  openFile: null,
  expandedDirs: [],
  scrollPositions: {},
  zoom: 1,
  displayMode: 'rendered',
  sidebarVisible: true,
  outlineVisible: true,
  sidebarWidth: 240,
  outlineWidth: 220,
  recentRoots: [],
  openTabs: []
}

/** 文件读取结果 */
export interface FileContent {
  content: string
  mtimeMs: number
}

/** 目录树中显示的 markdown 扩展名 */
export const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx']

/** 右键菜单模板项(渲染器 → 主进程 Menu.popup) */
export interface PopupItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator'
  enabled?: boolean
  danger?: boolean
}

/** 菜单/快捷键动作 id(主进程加速键 → 渲染器) */
export type MenuAction =
  | 'open-file'
  | 'open-folder'
  | 'new-file'
  | 'save'
  | 'export-pdf'
  | 'settings'
  | 'toggle-sidebar'
  | 'toggle-outline'
  | 'mode-rendered'
  | 'mode-raw'
  | 'mode-toggle'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'find'
  | 'find-next'
  | 'find-prev'
  | 'palette'
  | 'reload-file'
  | 'close-tab'
  | 'next-tab'
  | 'search'
  | 'toggle-ai'
