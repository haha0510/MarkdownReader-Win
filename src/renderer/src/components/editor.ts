// 原文编辑模式 — CodeMirror 6:每文件独立撤销栈、Mod-S 保存、
// 主题全部走 CSS 变量(主题切换时颜色自动跟随,无需重配置)。
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
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

/** 程序性 setState 期间抑制 updateListener 写回 store */
let applyingProgrammatic = false
/** 保存中标志,避免重复触发导致双写/双 toast */
let saving = false

/** 每文件全新状态(撤销栈随之重置) */
function freshState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
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
          }
        ])
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applyingProgrammatic) {
          store.set({ content: u.state.doc.toString(), dirty: true })
        }
      })
    ]
  })
}

async function doSave(): Promise<void> {
  const s = store.get()
  if (!s.currentFile || !s.dirty || saving) return
  saving = true
  try {
    const r = await window.api.writeFile(s.currentFile, s.content)
    store.set({ dirty: false, mtimeMs: r.mtimeMs })
    bus.emit('toast', { message: t('win.saved'), kind: 'success' })
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

  // 文件载入(含外部修改重载)→ 重建状态(撤销栈重置)
  bus.on('file-loaded', () => {
    if (!view) return
    applyingProgrammatic = true
    view.setState(freshState(store.get().content))
    applyingProgrammatic = false
  })

  // 自动换行设置变化 → 重配置 compartment
  store.on('settings', (s, prev) => {
    if (view && s.editorWordWrap !== prev.editorWordWrap) {
      view.dispatch({ effects: wrapCompartment.reconfigure(wrapExt(s.editorWordWrap)) })
    }
  })

  // 切到 raw:重新测量(display:none 期间尺寸为 0)并聚焦
  store.on('mode', (mode) => {
    if (mode === 'raw' && view) {
      view.requestMeasure()
      view.focus()
    }
  })

  bus.on('save-request', () => {
    void doSave()
  })
}
