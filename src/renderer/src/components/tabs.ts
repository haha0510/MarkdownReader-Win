// 多标签页 — 薄层设计:标签只是"打开过的文件路径"的列表,
// 切换即走现有 bus 'open-file' 流程,滚动位置/自动保存复用现有机制。
import './../styles/tabs.css'
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import type { SessionState } from '@shared/types'

const api = window.api

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

export function initTabs(): void {
  const bar = document.getElementById('tabbar')
  if (!bar) return

  // 标签路径列表(顺序即显示顺序);启动时从 session 恢复
  let tabs: string[] = [...store.get().session.openTabs]

  /** 持久化:镜像到 store.session 并写回主进程(与 app.ts patchSession 同模式,自建局部) */
  const persist = (): void => {
    const patch: Partial<SessionState> = { openTabs: [...tabs] }
    store.set({ session: { ...store.get().session, ...patch } })
    void api.setSession(patch)
  }

  /** 渲染整条标签栏 + 显隐控制 */
  const render = (): void => {
    const active = store.get().currentFile
    bar.textContent = ''
    for (const p of tabs) {
      const el = document.createElement('div')
      el.className = 'tab' + (p === active ? ' active' : '')
      el.dataset.path = p
      el.title = p
      const name = document.createElement('span')
      name.className = 'tab-name'
      name.textContent = basename(p)
      const close = document.createElement('button')
      close.className = 'tab-close'
      close.title = t('win.closeTab')
      close.textContent = '✕'
      close.addEventListener('click', (e) => {
        e.stopPropagation()
        closeTab(p)
      })
      el.appendChild(name)
      el.appendChild(close)
      // 左键切换;中键关闭
      el.addEventListener('click', () => {
        if (p !== store.get().currentFile) bus.emit('open-file', p)
      })
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault()
          closeTab(p)
        }
      })
      bar.appendChild(el)
    }
    // 有标签才显示标签栏,并让内容区(absolute inset:0)通过 data-tabs 让出 34px
    const has = tabs.length > 0
    bar.hidden = !has
    if (has) document.documentElement.dataset.tabs = 'true'
    else delete document.documentElement.dataset.tabs
    // 保证 active 标签可见(溢出横向滚动时)
    bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /** 关闭一个标签:被关的是 active → 激活右邻(无则左邻);清空则回欢迎页/空态 */
  const closeTab = (p: string): void => {
    const idx = tabs.indexOf(p)
    if (idx < 0) return
    const wasActive = store.get().currentFile === p
    tabs.splice(idx, 1)
    persist()
    if (wasActive) {
      const next = tabs[idx] ?? tabs[idx - 1]
      if (next) {
        bus.emit('open-file', next)
      } else {
        // 无标签可激活:清空当前文件,回欢迎页/空态
        store.set({
          currentFile: null,
          content: '',
          dirty: false,
          outline: [],
          activeHeadingId: null,
          selectedPath: null
        })
      }
    }
    render()
  }

  // currentFile 变化 → 维护 tabs 数组。
  // 重命名/移动场景:旧值在 tabs 且新值不在时,若旧文件已不存在(api.exists 为 false),
  // 视为同一文件改名 → 原位替换而非 append,保持标签位置;否则正常 append。
  store.on('currentFile', (cf, prev) => {
    if (cf && !tabs.includes(cf)) {
      const oldIdx = prev ? tabs.indexOf(prev) : -1
      if (oldIdx >= 0) {
        void api.exists(prev as string).then((exists) => {
          // 异步期间 tabs 可能已变,重新校验
          if (tabs.includes(cf)) return
          const i = tabs.indexOf(prev as string)
          if (!exists && i >= 0) tabs.splice(i, 1, cf)
          else tabs.push(cf)
          persist()
          render()
        })
        return
      }
      tabs.push(cf)
      persist()
    }
    render()
  })

  // rootDirs 清空(close-folder)→ 清空全部标签
  store.on('rootDirs', (dirs) => {
    if (dirs.length === 0 && tabs.length > 0) {
      tabs = []
      persist()
      render()
    }
  })

  bus.on('close-active-tab', () => {
    const cf = store.get().currentFile
    if (cf && tabs.includes(cf)) closeTab(cf)
  })

  // 循环切到下一个标签
  bus.on('cycle-tab', () => {
    if (tabs.length < 2) return
    const cf = store.get().currentFile
    const idx = cf ? tabs.indexOf(cf) : -1
    const next = tabs[(idx + 1) % tabs.length]
    if (next && next !== cf) bus.emit('open-file', next)
  })

  render()
}
