// 渲染视图(rendered 模式)— markdown 渲染、排版 CSS 变量、滚动联动与滚动记忆、
// 链接点击委托、代码块复制按钮。契约:CONTRACTS §3 viewer / §8 缩放语义。
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import { renderMarkdown } from '@/markdown/render'
import { renderMermaidIn } from '@/markdown/mermaid'
// @ts-ignore -- css 由 vite 打包
import '@/styles/viewer.css'

// 复制 / 完成 图标(参考 rendering-spec §10.1)
const COPY_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H11"/></svg>'
const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 5.5"/></svg>'

export function initViewer(): void {
  const viewer = document.getElementById('viewer')
  const scrollEl = document.getElementById('viewer-scroll')
  if (!viewer || !scrollEl) return

  // ── 排版 CSS 变量(zoom 只作用于正文/编辑器字号)──
  const applyTypography = (): void => {
    const s = store.get()
    const root = document.documentElement.style
    root.setProperty('--md-font-size', `${s.settings.fontSize * s.zoom}px`)
    root.setProperty('--editor-font-size', `${s.settings.editorFontSize * s.zoom}px`)
    root.setProperty('--md-line-height', String(s.settings.lineHeight))
    root.setProperty(
      '--md-max-width',
      s.settings.contentWidth === 0 ? '100%' : `${s.settings.contentWidth}px`
    )
  }
  store.on('settings', applyTypography)
  store.on('zoom', applyTypography)
  applyTypography()

  // ── 渲染状态 ──
  /** 上次渲染的内容/文件(mode 切回 rendered 时判断是否需要重渲染) */
  let lastRenderedContent: string | null = null
  let lastRenderedFile: string | null = null
  /** 渲染竞态令牌 + 在飞计数(渲染期间不写滚动记忆) */
  let renderSeq = 0
  let rendersInFlight = 0
  /** 当前文件最近一次滚动比例(滚动 rAF 中更新;文件切换时清空) */
  let lastFraction: number | null = null

  const applyFraction = (frac: number): void => {
    const max = scrollEl.scrollHeight - scrollEl.clientHeight
    if (max > 0) scrollEl.scrollTop = frac * max
  }

  /** 会话中记忆的当前文件滚动比例 */
  const sessionFraction = (): number => {
    const s = store.get()
    return (s.currentFile ? s.session.scrollPositions[s.currentFile] : 0) ?? 0
  }

  // ── 复制代码按钮 ──
  const injectCopyButtons = (): void => {
    viewer.querySelectorAll<HTMLPreElement>('pre.hljs').forEach((pre) => {
      if (pre.querySelector(':scope > button.copy-code')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'copy-code'
      btn.title = t('win.copyCode')
      btn.innerHTML = COPY_SVG
      pre.appendChild(btn)
    })
  }

  const copyCode = (btn: HTMLButtonElement): void => {
    const pre = btn.closest('pre')
    const code = pre?.querySelector('code')
    const text = code ? code.innerText : (pre?.innerText ?? '')
    navigator.clipboard
      .writeText(text)
      .then(() => {
        bus.emit('toast', { message: t('win.copied'), kind: 'success' })
        btn.classList.add('copied')
        btn.innerHTML = CHECK_SVG
        window.setTimeout(() => {
          btn.classList.remove('copied')
          btn.innerHTML = COPY_SVG
        }, 1500)
      })
      .catch(() => {
        /* 剪贴板不可用:静默 */
      })
  }

  /** 渲染当前 store 内容;restoreFraction 非 null 时渲染完成后恢复滚动比例 */
  const render = async (restoreFraction: number | null): Promise<void> => {
    const s = store.get()
    if (!s.currentFile) {
      // 无文件:清空视图
      viewer.innerHTML = ''
      lastRenderedContent = null
      lastRenderedFile = null
      return
    }
    const seq = ++renderSeq
    rendersInFlight++
    try {
      const { html, outline } = renderMarkdown(s.content, {
        docPath: s.currentFile,
        plantumlServer: s.settings.plantumlServer
      })
      viewer.innerHTML = html
      lastRenderedContent = s.content
      lastRenderedFile = s.currentFile
      injectCopyButtons()
      store.set({ outline })
      try {
        await renderMermaidIn(viewer)
      } catch {
        /* mermaid 失败不阻塞渲染流程 */
      }
      if (seq !== renderSeq) return // 已有更新的渲染在进行,放弃收尾
      if (restoreFraction !== null) applyFraction(restoreFraction)
      bus.emit('rendered')
    } finally {
      rendersInFlight--
    }
  }

  // 文件载入(含外部修改重载):重渲染 + 恢复会话滚动位置
  bus.on('file-loaded', () => {
    lastFraction = null
    void render(sessionFraction())
  })

  // 无文件时清空(load 失败等场景 currentFile 被置 null)
  store.on('currentFile', (cf) => {
    if (cf === null) void render(null)
  })

  // 切回 rendered:内容变化过才重渲染;未变仅恢复滚动(display:none 会丢 scrollTop)
  store.on('mode', (mode) => {
    if (mode !== 'rendered') return
    const s = store.get()
    if (!s.currentFile) return
    const frac = lastFraction ?? sessionFraction()
    if (s.content !== lastRenderedContent || s.currentFile !== lastRenderedFile) {
      void render(frac)
    } else {
      applyFraction(frac)
    }
  })

  // ── 滚动:scrollspy(rAF 节流)+ 500ms 防抖写入会话滚动记忆 ──
  let rafPending = false
  let saveTimer: number | undefined
  /** 大纲点击平滑滚动期间抑制 scrollspy 的截止时间戳(scrollend 或超时解除) */
  let suppressUntil = 0
  let suppressTimer: number | undefined

  const releaseSuppress = (): void => {
    suppressUntil = 0
    if (suppressTimer !== undefined) {
      window.clearTimeout(suppressTimer)
      suppressTimer = undefined
    }
  }

  const updateActiveHeading = (): void => {
    const headings = viewer.querySelectorAll<HTMLElement>(
      'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'
    )
    let active: string | null = null
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= 90) active = h.id
    }
    // 已滚动到底:激活最后一个标题(否则短末节永远无法点亮)
    if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2) {
      const last = headings[headings.length - 1]
      if (last) active = last.id
    }
    store.set({ activeHeadingId: active })
  }

  const saveScrollFraction = (): void => {
    saveTimer = undefined
    const s = store.get()
    if (!s.currentFile || rendersInFlight > 0 || lastFraction === null) return
    if (scrollEl.clientHeight === 0) return // 隐藏状态下的值不可信
    const scrollPositions: Record<string, number> = { ...s.session.scrollPositions }
    // 先删再插使当前文件位于插入序最末(最新);超过 100 条按插入序淘汰最早的键
    delete scrollPositions[s.currentFile]
    scrollPositions[s.currentFile] = lastFraction
    const keys = Object.keys(scrollPositions)
    if (keys.length > 100) {
      for (const k of keys.slice(0, keys.length - 100)) delete scrollPositions[k]
    }
    store.set({ session: { ...s.session, scrollPositions } })
    void window.api.setSession({ scrollPositions })
  }

  scrollEl.addEventListener(
    'scroll',
    () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const max = scrollEl.scrollHeight - scrollEl.clientHeight
        if (max > 0) lastFraction = Math.min(1, Math.max(0, scrollEl.scrollTop / max))
        // 大纲跳转的平滑滚动期间不做 scrollspy(避免把 activeHeadingId 打回中途标题)
        if (Date.now() >= suppressUntil) updateActiveHeading()
        if (saveTimer !== undefined) window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(saveScrollFraction, 500)
      })
    },
    { passive: true }
  )

  // ── 大纲点击跳转(scroll-margin-top 由 viewer.css 提供)──
  bus.on('scroll-to-heading', (payload) => {
    const id = typeof payload === 'string' ? payload : ''
    if (!id) return
    const el = viewer.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (!el) return
    // 立即激活目标标题,平滑滚动期间抑制 scrollspy;scrollend 解除,兜底 1000ms 超时
    store.set({ activeHeadingId: id })
    suppressUntil = Date.now() + 1000
    scrollEl.addEventListener('scrollend', releaseSuppress, { once: true })
    if (suppressTimer !== undefined) window.clearTimeout(suppressTimer)
    suppressTimer = window.setTimeout(releaseSuppress, 1000)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  // ── 点击委托:复制按钮 / 本地 md 链接 / 页内锚点 / 外链 ──
  viewer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return

    const copyBtn = target.closest<HTMLButtonElement>('button.copy-code')
    if (copyBtn && viewer.contains(copyBtn)) {
      e.preventDefault()
      copyCode(copyBtn)
      return
    }

    const a = target.closest('a')
    if (!a || !viewer.contains(a)) return

    const mdLink = a.getAttribute('data-md-link')
    if (mdLink) {
      // 本地 markdown 链接 → 应用内打开
      e.preventDefault()
      bus.emit('open-file', mdLink)
      return
    }
    if (a.classList.contains('external-link')) {
      // http(s) 外链 → 系统浏览器
      e.preventDefault()
      const href = a.getAttribute('href')
      if (href) void window.api.openExternal(href)
      return
    }
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      // 页内锚点(含脚注引用/回跳)→ 平滑滚动
      e.preventDefault()
      let id = href.slice(1)
      try {
        id = decodeURIComponent(id)
      } catch {
        /* 保留原样 */
      }
      const el = id ? viewer.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })

  // 图片加载失败 → 标记 broken(error 不冒泡,用捕获)
  viewer.addEventListener(
    'error',
    (e) => {
      if (e.target instanceof HTMLImageElement) e.target.classList.add('broken')
    },
    true
  )
}
