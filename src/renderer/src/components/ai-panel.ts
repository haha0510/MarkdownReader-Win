// AI 对话面板 — 右侧抽屉:选中即问 + 全文摘要 + 多轮对话。
// 所有 AI 调用统一走 @/ai/client 的 runAi();历史保存在本模块数组。
import '@/styles/ai-panel.css'
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import { runAi, aiConfigured, type AiRunHandle } from '@/ai/client'
import { renderMarkdown } from '@/markdown/render'
import type { AiMessage } from '@shared/ipc'

// 系统提示词(发给模型的指令,非 UI 文案,按任务规格用中文)
const SYS_CHAT = '你是阅读助手,基于用户提供的文档片段回答,简洁准确,默认中文。'
const SYS_SUMMARY = '你是文档摘要助手,输出简明要点(Markdown 列表),使用中文。'

export function initAiPanel(): void {
  const panel = document.getElementById('ai-panel') as HTMLElement
  const fab = document.getElementById('ai-fab') as HTMLButtonElement
  const viewer = document.getElementById('viewer')
  if (!panel || !fab) return

  // ── 多轮对话历史(发给模型的消息)与临时选中上下文 ──
  const messages: AiMessage[] = []
  let pendingContext: string | null = null // 待并入下一条提问的选中文本
  let currentHandle: AiRunHandle | null = null
  let generating = false
  let lastSelection = '' // #ai-fab 点击时使用的选中文本

  // ── 构建面板结构 ──
  panel.innerHTML = ''
  const header = document.createElement('div')
  header.className = 'ai-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'ai-title'
  titleEl.textContent = t('win.aiTitle')
  const spacer = document.createElement('span')
  spacer.className = 'ai-header-spacer'
  const summaryBtn = document.createElement('button')
  summaryBtn.className = 'ai-hbtn'
  summaryBtn.type = 'button'
  summaryBtn.textContent = t('win.aiSummary')
  // 翻译对照:交给 translate 组件切换分栏视图
  const translateBtn = document.createElement('button')
  translateBtn.className = 'ai-hbtn'
  translateBtn.type = 'button'
  translateBtn.textContent = t('win.aiTranslate')
  translateBtn.addEventListener('click', () => bus.emit('toggle-translate'))
  const clearBtn = document.createElement('button')
  clearBtn.className = 'ai-hbtn'
  clearBtn.type = 'button'
  clearBtn.textContent = t('win.aiClear')
  const closeBtn = document.createElement('button')
  closeBtn.className = 'ai-hbtn ai-close'
  closeBtn.type = 'button'
  closeBtn.textContent = '✕'
  header.append(titleEl, spacer, summaryBtn, translateBtn, clearBtn, closeBtn)

  const messagesEl = document.createElement('div')
  messagesEl.className = 'ai-messages'

  const footer = document.createElement('div')
  footer.className = 'ai-input-area'
  const input = document.createElement('textarea')
  input.className = 'ai-input'
  input.rows = 2
  input.placeholder = t('win.aiInputPlaceholder')
  input.spellcheck = false
  const sendBtn = document.createElement('button')
  sendBtn.className = 'ai-send'
  sendBtn.type = 'button'
  footer.append(input, sendBtn)

  panel.append(header, messagesEl, footer)

  // ── 工具函数 ──
  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function renderOpts(): { docPath: string | null; plantumlServer: string } {
    const st = store.get()
    return { docPath: st.currentFile, plantumlServer: st.settings.plantumlServer }
  }

  function addUserBubble(text: string): void {
    const b = document.createElement('div')
    b.className = 'ai-msg ai-user'
    b.textContent = text // 纯文本,天然转义
    messagesEl.appendChild(b)
    scrollToBottom()
  }

  function addAssistantBubble(): HTMLElement {
    const b = document.createElement('div')
    b.className = 'ai-msg ai-assistant markdown-body'
    messagesEl.appendChild(b)
    scrollToBottom()
    return b
  }

  // 选中上下文引用块
  function addContextBlock(text: string): void {
    const box = document.createElement('div')
    box.className = 'ai-context'
    const label = document.createElement('div')
    label.className = 'ai-context-label'
    label.textContent = t('win.aiSelectionContext')
    const body = document.createElement('div')
    body.className = 'ai-context-text'
    body.textContent = text
    box.append(label, body)
    messagesEl.appendChild(box)
    scrollToBottom()
  }

  function setGenerating(on: boolean): void {
    generating = on
    if (on) {
      sendBtn.classList.add('stop')
      sendBtn.textContent = t('win.aiStop')
    } else {
      sendBtn.classList.remove('stop')
      sendBtn.textContent = '' // 图标态,内容由 CSS 提供
    }
  }

  // ── 核心:流式生成到一个新的 assistant 气泡 ──
  async function generate(system: string, apiMessages: AiMessage[]): Promise<{ ok: boolean; text: string }> {
    const bubble = addAssistantBubble()
    // 加载态占位
    bubble.classList.add('ai-loading')
    bubble.textContent = t('win.aiThinking')
    setGenerating(true)

    let acc = ''
    let raf = 0
    const flush = (): void => {
      raf = 0
      bubble.classList.remove('ai-loading')
      bubble.innerHTML = renderMarkdown(acc, renderOpts()).html
      scrollToBottom()
    }

    const handle = runAi({
      system,
      messages: apiMessages,
      onText: (chunk) => {
        acc += chunk
        if (!raf) raf = requestAnimationFrame(flush) // 每帧节流重渲染
      }
    })
    currentHandle = handle
    const res = await handle.done
    currentHandle = null
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    setGenerating(false)

    // 固化最终内容
    bubble.classList.remove('ai-loading')
    if (acc) bubble.innerHTML = renderMarkdown(acc, renderOpts()).html

    if (!res.ok) {
      if (res.error === 'aborted') {
        // 用户主动停止:保留已生成部分,不报错
        if (!acc) bubble.remove()
        return { ok: false, text: acc }
      }
      const emsg =
        res.error === 'not-configured'
          ? t('win.aiNotConfigured')
          : t('win.aiError', { msg: res.error ?? '' })
      bubble.classList.add('ai-error')
      bubble.textContent = emsg
      bus.emit('toast', { message: emsg, kind: 'error' })
      return { ok: false, text: acc }
    }
    scrollToBottom()
    return { ok: true, text: acc }
  }

  // ── 发送用户提问 ──
  function submit(): void {
    if (generating) return
    const text = input.value.trim()
    if (!text) return
    if (!aiConfigured(store.get().settings)) {
      bus.emit('toast', { message: t('win.aiNotConfigured'), kind: 'error' })
      bus.emit('show-settings')
      return
    }
    input.value = ''
    autoResize()

    // 首条若有选中上下文,则并入模型消息(展示气泡仍只显示问题本身)
    let apiContent = text
    if (pendingContext) {
      apiContent = `文档片段:\n${pendingContext}\n\n问题:${text}`
      pendingContext = null
    }
    addUserBubble(text)
    messages.push({ role: 'user', content: apiContent })

    void generate(SYS_CHAT, messages.slice()).then((r) => {
      if (r.ok) messages.push({ role: 'assistant', content: r.text })
    })
  }

  // ── 全文摘要 ──
  function doSummary(): void {
    if (generating) return
    const st = store.get()
    if (!st.currentFile) return
    if (!aiConfigured(st.settings)) {
      bus.emit('toast', { message: t('win.aiNotConfigured'), kind: 'error' })
      bus.emit('show-settings')
      return
    }
    openPanel()
    const label = `[${t('win.aiSummary')}]`
    addUserBubble(label)
    const prompt = '请为以下文档生成摘要:\n\n' + st.content
    void generate(SYS_SUMMARY, [{ role: 'user', content: prompt }]).then((r) => {
      if (r.ok) {
        messages.push({ role: 'user', content: label })
        messages.push({ role: 'assistant', content: r.text })
      }
    })
  }

  function clearChat(): void {
    messages.length = 0
    pendingContext = null
    messagesEl.textContent = ''
  }

  // ── 打开/关闭面板 ──
  function openPanel(): void {
    panel.hidden = false
    document.documentElement.dataset.ai = 'true'
    setTimeout(() => input.focus(), 0)
  }
  function closePanel(): void {
    panel.hidden = true
    delete document.documentElement.dataset.ai
    hideFab()
  }
  function togglePanel(): void {
    if (panel.hidden) openPanel()
    else closePanel()
  }

  // ── 选中即问:入口(供 fab 与 bus 复用) ──
  function askSelection(text: string): void {
    const clip = text.trim()
    if (!clip) return
    openPanel()
    addContextBlock(clip)
    pendingContext = clip
    hideFab()
    setTimeout(() => input.focus(), 0)
  }

  // ── #ai-fab 定位与显隐 ──
  function showFab(rect: DOMRect, text: string): void {
    lastSelection = text
    fab.textContent = t('win.aiAsk')
    fab.hidden = false
    const w = fab.offsetWidth || 88
    const h = fab.offsetHeight || 28
    let left = rect.left + rect.width / 2 - w / 2
    let top = rect.bottom + 8 // 选区下方,避免遮挡
    // 视口内钳制
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    if (top + h > window.innerHeight - 8) top = rect.top - h - 8
    fab.style.left = `${left}px`
    fab.style.top = `${top}px`
  }
  function hideFab(): void {
    fab.hidden = true
  }

  // ── 事件绑定 ──
  summaryBtn.addEventListener('click', doSummary)
  clearBtn.addEventListener('click', clearChat)
  closeBtn.addEventListener('click', closePanel)

  sendBtn.addEventListener('click', () => {
    if (generating) currentHandle?.cancel()
    else submit()
  })

  function autoResize(): void {
    input.style.height = 'auto'
    input.style.height = `${Math.min(96, Math.max(44, input.scrollHeight))}px`
  }
  input.addEventListener('input', autoResize)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      closePanel()
    }
  })

  // 选中即问:#viewer 内 mouseup 检测选区
  viewer?.addEventListener('mouseup', () => {
    // 延迟到选区稳定后读取
    setTimeout(() => {
      const sel = window.getSelection()
      const text = sel?.toString() ?? ''
      if (!sel || sel.rangeCount === 0 || text.trim().length < 1) {
        hideFab()
        return
      }
      const range = sel.getRangeAt(0)
      if (!viewer.contains(range.commonAncestorContainer)) {
        hideFab()
        return
      }
      showFab(range.getBoundingClientRect(), text)
    }, 0)
  })

  fab.addEventListener('mousedown', (e) => {
    // 阻止取消选区,保留 lastSelection
    e.preventDefault()
  })
  fab.addEventListener('click', () => {
    askSelection(lastSelection)
  })

  // 点击别处 / 滚动 → 隐藏 fab
  document.addEventListener('mousedown', (e) => {
    if (e.target !== fab && !fab.hidden) hideFab()
  })
  document.getElementById('viewer-scroll')?.addEventListener('scroll', hideFab, { passive: true })

  // ── bus 订阅 ──
  bus.on('show-ai', togglePanel)
  bus.on('ai-ask-selection', (payload) => {
    if (typeof payload === 'string') askSelection(payload)
  })
  bus.on('close-overlays', () => {
    if (!panel.hidden) closePanel()
    hideFab()
  })
}
