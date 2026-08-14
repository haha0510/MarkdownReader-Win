// 原文编辑模式 — CodeMirror 6:每文件独立撤销栈、Mod-S 保存、编辑停顿自动保存、
// 主题全部走 CSS 变量(主题切换时颜色自动跟随,无需重配置)。
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import { extractOutline } from '@/markdown/render'

let view: EditorView | null = null

/** findbar(同属 agent D)对同一实例调 openSearchPanel / findNext */
export function getEditorView(): EditorView | null {
  return view
}

// ── 自动换行 compartment ──
const wrapCompartment = new Compartment()
const wrapExt = (on: boolean): Extension => (on ? EditorView.lineWrapping : [])

// ── 主题:静态定义,颜色用 var() 字符串,主题变量变化时实时生效 ──
const cmTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--md-bg)',
    color: 'var(--md-fg)',
    fontSize: 'var(--editor-font-size, 14px)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--md-code-font, var(--mono-font))',
    lineHeight: '1.6',
    overflow: 'auto'
  },
  '.cm-content': { caretColor: 'var(--ui-accent)', padding: '12px 0' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ui-accent)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--ui-selection)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--ui-selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--md-mark-bg)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--md-mark-bg)',
    outline: '1px solid var(--ui-border)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--ui-selection)' },
  '.cm-gutters': {
    backgroundColor: 'var(--md-bg)',
    color: 'var(--ui-fg-muted)',
    border: 'none',
    borderRight: '1px solid var(--ui-border)'
  },
  '.cm-activeLine': { backgroundColor: 'var(--ui-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ui-hover)' },
  // 搜索面板(openSearchPanel)配色:保证输入框/按钮在暗色主题下可读
  '.cm-panels': { backgroundColor: 'var(--ui-panel-bg)', color: 'var(--ui-fg)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--ui-border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ui-border)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'var(--ui-font)', fontSize: '12px' },
  '.cm-panel.cm-search label': { color: 'var(--ui-fg-muted)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--ui-fg-muted)' },
  '.cm-textfield': {
    backgroundColor: 'var(--ui-bg)',
    color: 'var(--ui-fg)',
    border: '1px solid var(--ui-border)',
    borderRadius: '4px'
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--ui-panel-bg)',
    color: 'var(--ui-fg)',
    border: '1px solid var(--ui-border)',
    borderRadius: '4px'
  },
  '.cm-button:active': { backgroundColor: 'var(--ui-active)' }
})

// ── 语法高亮:覆盖 basicSetup 自带的浅色 defaultHighlightStyle(fallback),
// 颜色映射到主题 CSS 变量,深浅色主题下均可读且随主题切换实时生效 ──
const cmHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--md-heading)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--md-link)' },
  { tag: tags.monospace, color: 'var(--md-code-fg)' },
  { tag: tags.keyword, color: 'var(--hl-keyword)' },
  { tag: tags.string, color: 'var(--hl-string)' },
  { tag: tags.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--hl-number)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--ui-fg-muted)' },
  { tag: [tags.labelName, tags.propertyName], color: 'var(--hl-attr)' },
  { tag: tags.typeName, color: 'var(--hl-type)' },
  { tag: tags.function(tags.variableName), color: 'var(--hl-function)' }
])

/**
 * 用记号对包裹/去包裹主选区(加粗/斜体 toggle)。
 * - 有选区:两侧已是同记号则去掉(toggle off),否则包裹;
 * - 无选区:插入记号对并把光标置于中间。
 * 多选区只处理主选区,保持实现简单。
 */
function wrapSelection(v: EditorView, prefix: string, suffix: string): boolean {
  const { state } = v
  const range = state.selection.main
  const { from, to } = range
  const text = state.sliceDoc(from, to)
  if (from === to) {
    // 无选区:插入记号对,光标置中
    v.dispatch({
      changes: { from, insert: prefix + suffix },
      selection: { anchor: from + prefix.length }
    })
    return true
  }
  if (text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length) {
    // 选区自身已带同记号 → 去掉
    const inner = text.slice(prefix.length, text.length - suffix.length)
    v.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length }
    })
    return true
  }
  // 选区外侧紧邻同记号(常见于再次按快捷键)→ 去掉外侧记号
  const before = state.sliceDoc(Math.max(0, from - prefix.length), from)
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + suffix.length))
  if (before === prefix && after === suffix) {
    v.dispatch({
      changes: [
        { from: from - prefix.length, to: from },
        { from: to, to: to + suffix.length }
      ],
      selection: { anchor: from - prefix.length, head: to - prefix.length }
    })
    return true
  }
  // 普通包裹
  v.dispatch({
    changes: [
      { from, insert: prefix },
      { from: to, insert: suffix }
    ],
    selection: { anchor: from + prefix.length, head: to + prefix.length }
  })
  return true
}

/** 程序性 setState 期间抑制 updateListener 写回 store */
let applyingProgrammatic = false
/** 保存中标志,避免重复触发导致双写/双 toast */
let saving = false

// ── 自动保存:编辑停顿 800ms 后静默写盘(settings.autoSave 控制)──
const AUTO_SAVE_DELAY = 800
let autoSaveTimer: number | null = null

function clearAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

function scheduleAutoSave(): void {
  clearAutoSaveTimer()
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null
    if (saving) {
      // 上一次写盘尚未完成:顺延重试,避免这批编辑漏存
      scheduleAutoSave()
      return
    }
    void doSave(true)
  }, AUTO_SAVE_DELAY)
}

// ── 编辑 → 大纲实时同步:内容变化去抖后重提大纲(extractOutline 与渲染 id 一致)──
const OUTLINE_REFRESH_DELAY = 600
let outlineTimer: number | null = null

function clearOutlineTimer(): void {
  if (outlineTimer !== null) {
    window.clearTimeout(outlineTimer)
    outlineTimer = null
  }
}

function scheduleOutlineRefresh(): void {
  clearOutlineTimer()
  outlineTimer = window.setTimeout(() => {
    outlineTimer = null
    if (view) store.set({ outline: extractOutline(view.state.doc.toString()) })
  }, OUTLINE_REFRESH_DELAY)
}

// ── 程序性滚动期间抑制编辑器 scrollspy(机制参考 viewer:scrollend 解除 + 1000ms 兜底)──
let suppressUntil = 0
let suppressTimer: number | null = null

function releaseSuppress(): void {
  suppressUntil = 0
  if (suppressTimer !== null) {
    window.clearTimeout(suppressTimer)
    suppressTimer = null
  }
}

/**
 * 开启抑制窗口。编辑器滚动是瞬时的,scrollend 可能先于 scroll 监听排队的 rAF 回调到达,
 * 因此 scrollend 后推迟一帧再解除,保证已排队的 scrollspy 回调仍处于抑制期。
 */
function suppressSpy(): void {
  suppressUntil = Date.now() + 1000
  if (suppressTimer !== null) window.clearTimeout(suppressTimer)
  suppressTimer = window.setTimeout(releaseSuppress, 1000)
  view?.scrollDOM.addEventListener('scrollend', () => requestAnimationFrame(releaseSuppress), {
    once: true
  })
}

/** 按大纲 id 定位编辑器:光标置于标题行首并滚到视口顶部(大纲中无此 id 则原位不动) */
function scrollEditorToHeading(id: string): void {
  if (!view) return
  const item = store.get().outline.find((it) => it.id === id)
  if (!item) return
  // OutlineItem.line 为 0 基,CM 行号 1 基;行数可能已被编辑改变,越界时收敛到文末
  const ln = Math.min(item.line + 1, view.state.doc.lines)
  const pos = view.state.doc.line(ln).from
  suppressSpy() // 程序性滚动不让 scrollspy 改写 activeHeadingId
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 })
  })
}

/** 每文件全新状态(撤销栈随之重置) */
function freshState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      syntaxHighlighting(cmHighlight),
      markdown({ codeLanguages: languages }),
      wrapCompartment.of(wrapExt(store.get().settings.editorWordWrap)),
      cmTheme,
      // Mod-S 高优先级保存(菜单加速键之外的双保险)
      Prec.high(
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              bus.emit('save-request')
              return true
            }
          },
          // 加粗 / 斜体:包裹或去包裹主选区(见 wrapSelection)
          { key: 'Mod-b', preventDefault: true, run: (v) => wrapSelection(v, '**', '**') },
          { key: 'Mod-i', preventDefault: true, run: (v) => wrapSelection(v, '*', '*') }
        ])
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applyingProgrammatic) {
          store.set({ content: u.state.doc.toString(), dirty: true })
          const s = store.get()
          if (s.settings.autoSave && s.currentFile) scheduleAutoSave()
          scheduleOutlineRefresh() // 用户编辑 → 去抖更新大纲(新增/删除标题实时反映)
        }
      })
    ]
  })
}

/** silent=true(自动保存)时成功不弹 toast(避免刷屏),失败仍提示 */
async function doSave(silent = false): Promise<void> {
  const s = store.get()
  if (!s.currentFile || !s.dirty || saving) return
  saving = true
  // 写盘期间用户可能继续输入或切换文件:先捕获快照,落盘后按快照校验再更新状态
  const savedPath = s.currentFile
  const savedContent = s.content
  try {
    const r = await window.api.writeFile(savedPath, savedContent)
    const now = store.get()
    const patch: { dirty?: boolean; mtimeMs?: number } = {}
    if (now.currentFile === savedPath) patch.mtimeMs = r.mtimeMs
    // 内容已被继续编辑则保持 dirty,避免新击键被静默标成已保存
    if (now.content === savedContent) patch.dirty = false
    store.set(patch)
    if (!silent) bus.emit('toast', { message: t('win.saved'), kind: 'success' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    bus.emit('toast', { message: `${t('win.saveFailed')}: ${msg}`, kind: 'error' })
  } finally {
    saving = false
  }
}

export function initEditor(): void {
  const parent = document.getElementById('editor')
  if (!parent) return

  view = new EditorView({ state: freshState(store.get().content), parent })

  // 文件载入(含外部修改重载)→ 重建状态(撤销栈重置);旧文件的待自动保存/待大纲更新作废
  bus.on('file-loaded', () => {
    clearAutoSaveTimer()
    clearOutlineTimer()
    if (!view) return
    applyingProgrammatic = true
    // setState 会把滚动位置重置到顶部:抑制由此触发的 scrollspy,保留跨重载的 activeHeadingId
    suppressSpy()
    view.setState(freshState(store.get().content))
    applyingProgrammatic = false
  })

  // 自动换行设置变化 → 重配置 compartment;关闭自动保存时取消待写盘
  store.on('settings', (s, prev) => {
    if (view && s.editorWordWrap !== prev.editorWordWrap) {
      view.dispatch({ effects: wrapCompartment.reconfigure(wrapExt(s.editorWordWrap)) })
    }
    if (!s.autoSave && prev.autoSave) clearAutoSaveTimer()
  })

  // 切到 raw:重新测量(display:none 期间尺寸为 0)并聚焦;定位到渲染侧的活跃标题,
  // 保持阅读位置连续。无活跃标题(文档顶部)时保持编辑器原位。
  store.on('mode', (mode) => {
    if (mode !== 'raw' || !view) return
    view.requestMeasure()
    view.focus()
    const id = store.get().activeHeadingId
    if (!id) return
    // 等一帧:确保 #editor 已可见、CM 可测量后再定位
    requestAnimationFrame(() => {
      if (store.get().mode === 'raw') scrollEditorToHeading(id)
    })
  })

  // 大纲点击(编辑模式):跳到对应标题行;渲染模式不处理(viewer 已有)
  bus.on('scroll-to-heading', (payload) => {
    const id = typeof payload === 'string' ? payload : ''
    if (!id || !view || store.get().mode !== 'raw') return
    store.set({ activeHeadingId: id })
    scrollEditorToHeading(id)
    view.focus()
  })

  // ── 编辑滚动 → 大纲联动(rAF 节流):视口顶部行之前(含)的最后一个标题为活跃项 ──
  let spyRafPending = false
  view.scrollDOM.addEventListener(
    'scroll',
    () => {
      if (spyRafPending) return
      spyRafPending = true
      requestAnimationFrame(() => {
        spyRafPending = false
        if (!view || store.get().mode !== 'raw') return
        if (Date.now() < suppressUntil) return // 程序性滚动抑制期
        // +6px 容差:程序定位后 scrollTop 恰落在标题块上沿,防像素级抖动误判为前一项
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 6)
        const topLine = view.state.doc.lineAt(block.from).number - 1 // 转 0 基
        let active: string | null = null
        for (const it of store.get().outline) {
          if (it.line <= topLine) active = it.id
          else break // 大纲行号升序,可提前结束
        }
        store.set({ activeHeadingId: active }) // 位于首个标题之前 → null
      })
    },
    { passive: true }
  )

  bus.on('save-request', () => {
    // 手动保存立即写盘,取消待触发的自动保存(避免紧跟一次冗余写)
    clearAutoSaveTimer()
    void doSave()
  })
}
