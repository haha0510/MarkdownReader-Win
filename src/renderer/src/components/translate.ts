// 翻译对照阅读 — 原文左(#viewer-scroll / #editor) / 译文右(#translate-scroll)。
// 只用 runAi() 发起流式翻译;节流渲染;切换/关闭/切文档时取消旧的生成。
// 契约:CONTRACTS §3 viewer(布局)、AI 客户端见 ai/client.ts。
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import { renderMarkdown } from '@/markdown/render'
import { renderMermaidIn } from '@/markdown/mermaid'
import { runAi, aiConfigured, type AiRunHandle } from '@/ai/client'
// @ts-ignore -- css 由 vite 打包
import '@/styles/translate.css'

// 重新翻译 / 关闭 图标(风格对齐 viewer.ts 的 SVG)
const RETRY_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5V5H11"/></svg>'
const CLOSE_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

const TRANSLATE_SYSTEM =
  '你是专业翻译。只输出翻译后的 Markdown,严格保留原文的 Markdown 结构' +
  '(标题层级、列表、表格、代码块、链接、图片语法),不要翻译代码块内的代码,' +
  '不要输出任何解释或额外文字。'

export function initTranslate(): void {
  const scrollEl = document.getElementById('translate-scroll')
  const body = document.getElementById('translate-body')
  if (!scrollEl || !body) return

  // ── 顶部细条(标题 + 状态 + 重新翻译 / 关闭)──
  const head = document.createElement('div')
  head.className = 'tr-head'
  const titleEl = document.createElement('span')
  titleEl.className = 'tr-head-title'
  const statusEl = document.createElement('span')
  statusEl.className = 'tr-status'
  const retryBtn = document.createElement('button')
  retryBtn.type = 'button'
  retryBtn.className = 'tr-btn'
  retryBtn.innerHTML = RETRY_SVG
  retryBtn.title = t('win.aiTranslate')
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'tr-btn'
  closeBtn.innerHTML = CLOSE_SVG
  closeBtn.title = t('win.closeTab')
  head.append(titleEl, statusEl, retryBtn, closeBtn)
  scrollEl.insertBefore(head, body)

  // ── 生成状态 ──
  /** 当前在飞的翻译 handle;切换/关闭/重译前 cancel */
  let handle: AiRunHandle | null = null
  /** 竞态令牌:每次开始一轮翻译自增,回调据此丢弃过期结果 */
  let seq = 0
  /** 流式累积文本 */
  let buffer = ''
  /** 节流渲染定时器 */
  let renderTimer: number | undefined
  /** 本轮是否已首次写入(用于置顶一次) */
  let scrolledTop = false

  const isOpen = (): boolean => document.documentElement.dataset.translate === 'true'

  const updateTitle = (): void => {
    titleEl.textContent = `${t('win.aiTranslation')} · ${store.get().settings.aiTargetLang}`
  }

  /** 取消在飞生成并清理节流定时器 */
  const cancelActive = (): void => {
    seq++ // 使旧回调失效
    if (handle) {
      handle.cancel()
      handle = null
    }
    if (renderTimer !== undefined) {
      window.clearTimeout(renderTimer)
      renderTimer = undefined
    }
  }

  /** 用当前 buffer 渲染译文到 #translate-body */
  const renderBuffer = (): void => {
    const s = store.get()
    const { html } = renderMarkdown(buffer, {
      docPath: s.currentFile,
      plantumlServer: s.settings.plantumlServer
    })
    body.innerHTML = html
    if (!scrolledTop) {
      scrollEl.scrollTop = 0
      scrolledTop = true
    }
  }

  /** 节流:流式期间最多每 ~180ms 渲染一次 */
  const scheduleRender = (token: number): void => {
    if (token !== seq || renderTimer !== undefined) return
    renderTimer = window.setTimeout(() => {
      renderTimer = undefined
      if (token !== seq) return
      renderBuffer()
    }, 180)
  }

  /** 在译栏显示一段错误提示 */
  const showError = (msg: string): void => {
    body.innerHTML = ''
    const box = document.createElement('div')
    box.className = 'tr-error'
    box.textContent = msg
    body.appendChild(box)
  }

  /** 开始翻译当前文档(会先取消旧的) */
  const translate = (): void => {
    cancelActive()
    const s = store.get()
    if (!s.currentFile) return
    updateTitle()
    buffer = ''
    scrolledTop = false

    // 未配置 AI:提示并跳到设置
    if (!aiConfigured(s.settings)) {
      statusEl.textContent = ''
      showError(t('win.aiNotConfigured'))
      bus.emit('show-settings')
      return
    }

    statusEl.textContent = t('win.aiTranslating')
    body.innerHTML = ''
    const token = ++seq
    const userPrompt = `将以下内容翻译为${s.settings.aiTargetLang}:\n\n${s.content}`
    const h = runAi({
      system: TRANSLATE_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      onText: (text) => {
        if (token !== seq) return
        buffer += text
        scheduleRender(token)
      }
    })
    handle = h
    void h.done.then((res) => {
      if (token !== seq) return // 已被更新的一轮取代
      handle = null
      statusEl.textContent = ''
      if (res.ok) {
        renderBuffer()
        // 译文含 mermaid 图表少见,done 后补渲染一次即可
        void renderMermaidIn(body).catch(() => {})
        return
      }
      if (res.error === 'aborted') return // 主动取消,保持现状
      if (res.error === 'not-configured') {
        showError(t('win.aiNotConfigured'))
        bus.emit('show-settings')
        return
      }
      showError(t('win.aiError', { msg: res.error ?? '' }))
    })
  }

  const open = (): void => {
    // 无文档不进入
    if (!store.get().currentFile) return
    document.documentElement.dataset.translate = 'true'
    scrollEl.hidden = false
    translate()
  }

  const close = (): void => {
    cancelActive()
    delete document.documentElement.dataset.translate
    scrollEl.hidden = true
    statusEl.textContent = ''
  }

  // ── 切换开/关 ──
  bus.on('toggle-translate', () => {
    if (isOpen()) close()
    else open()
  })

  // 头部按钮
  retryBtn.addEventListener('click', () => {
    if (isOpen()) translate()
  })
  closeBtn.addEventListener('click', () => {
    close()
  })

  // ── 文档切换:开启中则重译新文档;无文档则关闭 ──
  store.on('currentFile', (cf) => {
    if (!isOpen()) return
    if (cf === null) close()
    else translate()
  })

  // ── 目标语言变化:开启中则更新标题并重译 ──
  store.on('settings', (s, prev) => {
    if (!isOpen()) return
    if (s.aiTargetLang !== prev.aiTargetLang) {
      updateTitle()
      translate()
    }
  })
}
