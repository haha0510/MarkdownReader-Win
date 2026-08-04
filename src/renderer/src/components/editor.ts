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

  // 文件载入(含外部修改重载)→ 重建状态(撤销栈重置);旧文件的待自动保存作废
  bus.on('file-loaded', () => {
    clearAutoSaveTimer()
    if (!view) return
    applyingProgrammatic = true
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

  // 切到 raw:重新测量(display:none 期间尺寸为 0)并聚焦
  store.on('mode', (mode) => {
    if (mode === 'raw' && view) {
      view.requestMeasure()
      view.focus()
    }
  })

  bus.on('save-request', () => {
    // 手动保存立即写盘,取消待触发的自动保存(避免紧跟一次冗余写)
    clearAutoSaveTimer()
    void doSave()
  })
}
