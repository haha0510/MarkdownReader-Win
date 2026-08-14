// AI 对话面板 — 右侧抽屉:选中即问 + 全文摘要 + 多轮对话 + 对话历史持久化 + 选中批注标签。
// 所有 AI 调用统一走 @/ai/client 的 runAi();历史与批注经 window.api.dataGet/dataSet 持久化。
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

// ── 持久化数据结构 ──
type ConvKind = 'ask' | 'summary' | 'translate' | 'chat'

/** 一条保存的对话('ai-history') */
interface Conversation {
  id: string
  /** 首个用户问题前 30 字 */
  title: string
  kind: ConvKind
  /** 关联文档路径(无文档为 null) */
  file: string | null
  createdAt: number
  updatedAt: number
  messages: AiMessage[]
}

/** 选中即问批注('ai-notes':Record<文件路径, Note[]>) */
interface Note {
  id: string
  file: string
  /** 选中文本(trim,截 500) */
  quote: string
  /** quote 在全文 textContent 中的第 n 次出现(1 基) */
  occurrence: number
  conversationId: string
  createdAt: number
}

const HISTORY_LIMIT = 50
const NOTES_PER_FILE_LIMIT = 100
const QUOTE_LIMIT = 500

// 小图标(SVG,随 currentColor 取色)
const CLOCK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><polyline points="8 4.5 8 8 10.5 9.5"/></svg>'
const PLUS_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>'

let idSeq = 0
/** 生成本地唯一 id */
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++idSeq).toString(36)}`
}

/** 相对时间文案(历史列表用) */
function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('win.aiTimeJustNow')
  if (min < 60) return t('win.aiTimeMinutesAgo', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return t('win.aiTimeHoursAgo', { n: h })
  return t('win.aiTimeDaysAgo', { n: Math.floor(h / 24) })
}

/** kind → 徽标文案 */
function kindLabel(kind: ConvKind): string {
  switch (kind) {
    case 'ask':
      return t('win.aiKindAsk')
    case 'summary':
      return t('win.aiKindSummary')
    case 'translate':
      return t('win.aiKindTranslate')
    default:
      return t('win.aiKindChat')
  }
}

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
  /** #ai-fab 显示时捕获的选区定位信息(quote + 第 n 次出现),点击后建批注用 */
  let lastSelInfo: { quote: string; occurrence: number } | null = null

  // ── 持久化状态(启动异步载入)──
  let history: Conversation[] = []
  let notes: Record<string, Note[]> = {}
  /** 当前会话(null = 尚未开始;首轮问答完成后写入 history) */
  let currentConv: Conversation | null = null

  function saveHistory(): void {
    void window.api.dataSet('ai-history', history)
  }
  function saveNotes(): void {
    void window.api.dataSet('ai-notes', notes)
  }

  // ── 构建面板结构 ──
  panel.innerHTML = ''
  const header = document.createElement('div')
  header.className = 'ai-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'ai-title'
  titleEl.textContent = t('win.aiTitle')
  const spacer = document.createElement('span')
  spacer.className = 'ai-header-spacer'
  // 历史(时钟图标)与新对话(+)小图标按钮
  const historyBtn = document.createElement('button')
  historyBtn.className = 'ai-hbtn ai-icon'
  historyBtn.type = 'button'
  historyBtn.title = t('win.aiHistory')
  historyBtn.innerHTML = CLOCK_SVG
  const newBtn = document.createElement('button')
  newBtn.className = 'ai-hbtn ai-icon'
  newBtn.type = 'button'
  newBtn.title = t('win.aiNewChat')
  newBtn.innerHTML = PLUS_SVG
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
  header.append(titleEl, spacer, historyBtn, newBtn, summaryBtn, translateBtn, clearBtn, closeBtn)

  const messagesEl = document.createElement('div')
  messagesEl.className = 'ai-messages'

  // 历史列表视图(与消息区互斥显示)
  const historyEl = document.createElement('div')
  historyEl.className = 'ai-history'
  historyEl.hidden = true

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

  panel.append(header, messagesEl, historyEl, footer)

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

  // ── 会话持久化 ──
  /** 新建会话对象(尚未入库,首轮完成后 upsert) */
  function newConv(kind: ConvKind): Conversation {
    const now = Date.now()
    return {
      id: uid('c'),
      title: '',
      kind,
      file: store.get().currentFile,
      createdAt: now,
      updatedAt: now,
      messages: []
    }
  }

  /** 保存/更新当前会话到历史;超 50 条按 updatedAt 淘汰最旧 */
  function upsertConv(): void {
    if (!currentConv) return
    currentConv.messages = messages.slice()
    currentConv.updatedAt = Date.now()
    if (!currentConv.title) {
      const firstUser = messages.find((m) => m.role === 'user')
      currentConv.title = (firstUser?.content ?? '').slice(0, 30)
    }
    const i = history.findIndex((c) => c.id === currentConv!.id)
    if (i >= 0) history[i] = currentConv
    else history.push(currentConv)
    while (history.length > HISTORY_LIMIT) {
      let oldest = 0
      for (let k = 1; k < history.length; k++) {
        if (history[k].updatedAt < history[oldest].updatedAt) oldest = k
      }
      history.splice(oldest, 1)
    }
    saveHistory()
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
    showChatView()
    if (!currentConv) currentConv = newConv('chat')

    // 首条若有选中上下文,则并入模型消息(展示气泡仍只显示问题本身)
    let apiContent = text
    if (pendingContext) {
      apiContent = `文档片段:\n${pendingContext}\n\n问题:${text}`
      pendingContext = null
    }
    addUserBubble(text)
    // 标题取首个用户问题(展示文本)前 30 字
    if (currentConv && !currentConv.title) currentConv.title = text.slice(0, 30)
    messages.push({ role: 'user', content: apiContent })

    void generate(SYS_CHAT, messages.slice()).then((r) => {
      if (r.ok) {
        messages.push({ role: 'assistant', content: r.text })
        upsertConv() // 一轮问答完成 → 自动保存
      }
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
    showChatView()
    if (!currentConv) currentConv = newConv('summary')
    const label = `[${t('win.aiSummary')}]`
    addUserBubble(label)
    const prompt = '请为以下文档生成摘要:\n\n' + st.content
    void generate(SYS_SUMMARY, [{ role: 'user', content: prompt }]).then((r) => {
      if (r.ok) {
        messages.push({ role: 'user', content: label })
        messages.push({ role: 'assistant', content: r.text })
        upsertConv()
      }
    })
  }

  /** 清空面板并结束当前会话(历史记录保留) */
  function newChat(): void {
    messages.length = 0
    pendingContext = null
    currentConv = null
    messagesEl.textContent = ''
    showChatView()
  }

  // ── 历史视图 ──
  function showChatView(): void {
    historyEl.hidden = true
    messagesEl.hidden = false
  }

  function renderHistory(): void {
    historyEl.textContent = ''
    const sorted = history.slice().sort((a, b) => b.updatedAt - a.updatedAt)
    if (sorted.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'ai-history-empty'
      empty.textContent = t('win.aiHistoryEmpty')
      historyEl.appendChild(empty)
      return
    }
    for (const conv of sorted) {
      const row = document.createElement('div')
      row.className = 'ai-hist-row'
      const title = document.createElement('span')
      title.className = 'ai-hist-title'
      title.textContent = conv.title || kindLabel(conv.kind)
      const badge = document.createElement('span')
      badge.className = 'ai-hist-kind'
      badge.textContent = kindLabel(conv.kind)
      const time = document.createElement('span')
      time.className = 'ai-hist-time'
      time.textContent = relTime(conv.updatedAt)
      const del = document.createElement('button')
      del.className = 'ai-hist-del'
      del.type = 'button'
      del.textContent = '✕'
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!window.confirm(t('win.aiHistoryDeleteConfirm'))) return
        history = history.filter((c) => c.id !== conv.id)
        if (currentConv?.id === conv.id) currentConv = null
        saveHistory()
        renderHistory()
      })
      row.append(title, badge, time, del)
      row.addEventListener('click', () => loadConversation(conv))
      historyEl.appendChild(row)
    }
  }

  function toggleHistory(): void {
    if (historyEl.hidden) {
      renderHistory()
      historyEl.hidden = false
      messagesEl.hidden = true
    } else {
      showChatView()
    }
  }

  /** 载入历史会话到面板(可继续追问) */
  function loadConversation(conv: Conversation): void {
    currentConv = conv
    pendingContext = null
    messages.length = 0
    messages.push(...conv.messages)
    messagesEl.textContent = ''
    for (const m of conv.messages) {
      if (m.role === 'user') {
        addUserBubble(m.content)
      } else {
        const b = addAssistantBubble()
        b.innerHTML = renderMarkdown(m.content, renderOpts()).html
      }
    }
    showChatView()
    scrollToBottom()
    setTimeout(() => input.focus(), 0)
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

  // ══ 批注标签:定位/打标/交互 ══

  /** 收集 #viewer 内文本节点(跳过批注标签 ✦ 自身的文本,保证偏移稳定) */
  function textNodesOf(root: HTMLElement): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        (n.parentElement?.closest('.ai-note-tag') ?? null)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
    })
    const out: Text[] = []
    let cur = walker.nextNode()
    while (cur) {
      out.push(cur as Text)
      cur = walker.nextNode()
    }
    return out
  }

  /** 全文索引 → (文本节点, 节点内偏移) */
  function locate(nodes: Text[], index: number): { node: Text; offset: number } | null {
    let acc = 0
    for (const n of nodes) {
      const len = n.data.length
      if (index <= acc + len) return { node: n, offset: index - acc }
      acc += len
    }
    return null
  }

  /** 从当前选区计算 quote + 第 n 次出现(发起选中即问时调用) */
  function selInfoOf(sel: Selection): { quote: string; occurrence: number } | null {
    if (!viewer || sel.rangeCount === 0) return null
    const raw = sel.toString()
    const quote = raw.trim().slice(0, QUOTE_LIMIT)
    if (!quote) return null
    const range = sel.getRangeAt(0)
    const nodes = textNodesOf(viewer)
    const full = nodes.map((n) => n.data).join('')
    // 选区起点的全文绝对偏移(startContainer 非文本节点时按"整节点在选区前"累加近似)
    let abs = 0
    let found = false
    for (const n of nodes) {
      if (n === range.startContainer) {
        abs += range.startOffset
        found = true
        break
      }
      if (!found) {
        try {
          if (range.comparePoint(n, n.data.length) === -1) abs += n.data.length
          else break
        } catch {
          break
        }
      }
    }
    // 选区可能以空白开头,quote 已 trim → 起点前移
    abs += raw.length - raw.trimStart().length
    // 统计 quote 第几次出现覆盖该偏移
    let occ = 0
    let idx = full.indexOf(quote)
    while (idx !== -1) {
      occ++
      if (idx + quote.length > abs) break
      idx = full.indexOf(quote, idx + 1)
    }
    return { quote, occurrence: Math.max(1, occ) }
  }

  /** 在 viewer 文本流中定位 quote 的第 occurrence 次出现(支持跨文本节点),返回 Range */
  function rangeOfOccurrence(quote: string, occurrence: number): Range | null {
    if (!viewer) return null
    const nodes = textNodesOf(viewer)
    const full = nodes.map((n) => n.data).join('')
    let idx = -1
    for (let k = 0; k < occurrence; k++) {
      idx = full.indexOf(quote, idx + 1)
      if (idx === -1) return null
    }
    const start = locate(nodes, idx)
    const end = locate(nodes, idx + quote.length)
    if (!start || !end) return null
    const r = document.createRange()
    r.setStart(start.node, Math.min(start.offset, start.node.data.length))
    r.setEnd(end.node, Math.min(end.offset, end.node.data.length))
    return r
  }

  /** 对单条批注打标:高亮 mark(可失败) + 末尾 ✦ 标签 */
  function applyNote(n: Note): void {
    const range = rangeOfOccurrence(n.quote, n.occurrence)
    if (!range) return // 文档已改,静默跳过
    let mark: HTMLElement | null = null
    try {
      // 跨元素选区 surroundContents 会抛异常 → 只留标签
      const m = document.createElement('mark')
      m.className = 'ai-note-mark'
      m.dataset.noteId = n.id
      range.surroundContents(m)
      mark = m
    } catch {
      mark = null
    }
    const sup = document.createElement('sup')
    sup.className = 'ai-note-tag'
    sup.dataset.noteId = n.id
    sup.textContent = '✦'
    sup.title = n.quote.slice(0, 60)
    if (mark) {
      mark.after(sup)
    } else {
      const end = range.cloneRange()
      end.collapse(false)
      end.insertNode(sup)
    }
  }

  /** 渲染后全量打标(幂等:已存在的标签跳过,重渲染清空 DOM 后全部重建) */
  function decorateNotes(): void {
    const st = store.get()
    if (!viewer || st.mode !== 'rendered' || !st.currentFile) return
    const list = notes[st.currentFile]
    if (!list || list.length === 0) return
    for (const n of list) {
      if (viewer.querySelector(`.ai-note-tag[data-note-id="${n.id}"]`)) continue
      applyNote(n)
    }
  }

  /** 发起选中即问时创建批注并立即打标 */
  function createNote(info: { quote: string; occurrence: number }, conversationId: string): void {
    const file = store.get().currentFile
    if (!file) return
    const note: Note = {
      id: uid('n'),
      file,
      quote: info.quote,
      occurrence: info.occurrence,
      conversationId,
      createdAt: Date.now()
    }
    const list = notes[file] ?? (notes[file] = [])
    list.push(note)
    while (list.length > NOTES_PER_FILE_LIMIT) list.shift() // 每文件上限,淘汰最早
    saveNotes()
    decorateNotes()
  }

  /** 删除批注:数据 + DOM 标签/mark(mark 解包保留文本) */
  function deleteNote(noteId: string): void {
    for (const file of Object.keys(notes)) {
      const before = notes[file].length
      notes[file] = notes[file].filter((n) => n.id !== noteId)
      if (notes[file].length === 0) delete notes[file]
      if (before !== (notes[file]?.length ?? 0)) break
    }
    saveNotes()
    if (!viewer) return
    viewer.querySelector(`.ai-note-tag[data-note-id="${noteId}"]`)?.remove()
    const mark = viewer.querySelector(`.ai-note-mark[data-note-id="${noteId}"]`)
    if (mark) mark.replaceWith(...mark.childNodes)
  }

  /** 点击 ✦ → 打开面板并载入对应会话 */
  function openNote(noteId: string): void {
    let note: Note | undefined
    for (const list of Object.values(notes)) {
      note = list.find((n) => n.id === noteId)
      if (note) break
    }
    openPanel()
    if (!note) return
    const conv = history.find((c) => c.id === note!.conversationId)
    if (conv) loadConversation(conv)
  }

  // ── 选中即问:入口(供 fab 与 bus 复用;info 存在时创建批注)──
  function askSelection(text: string, info?: { quote: string; occurrence: number } | null): void {
    const clip = text.trim()
    if (!clip) return
    // 每次选中即问开启一个新会话,便于批注标签一一对应
    newChat()
    currentConv = newConv('ask')
    openPanel()
    addContextBlock(clip)
    pendingContext = clip
    if (info) createNote(info, currentConv.id)
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
  historyBtn.addEventListener('click', toggleHistory)
  newBtn.addEventListener('click', newChat)
  summaryBtn.addEventListener('click', doSummary)
  clearBtn.addEventListener('click', newChat)
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
      lastSelInfo = selInfoOf(sel) // 选区仍在时捕获定位信息
      showFab(range.getBoundingClientRect(), text)
    }, 0)
  })

  fab.addEventListener('mousedown', (e) => {
    // 阻止取消选区,保留 lastSelection
    e.preventDefault()
  })
  fab.addEventListener('click', () => {
    askSelection(lastSelection, lastSelInfo)
    lastSelInfo = null
  })

  // 批注标签交互:点击 ✦ 载入会话;右键 ✦ 删除。stopPropagation 防选区/委托干扰
  viewer?.addEventListener('click', (e) => {
    const sup = (e.target as HTMLElement | null)?.closest?.('.ai-note-tag')
    if (!sup || !viewer.contains(sup)) return
    e.preventDefault()
    e.stopPropagation()
    const id = sup.getAttribute('data-note-id')
    if (id) openNote(id)
  })
  viewer?.addEventListener('contextmenu', (e) => {
    const sup = (e.target as HTMLElement | null)?.closest?.('.ai-note-tag')
    if (!sup || !viewer.contains(sup)) return
    e.preventDefault()
    e.stopPropagation() // 不触发正文右键菜单
    const id = sup.getAttribute('data-note-id')
    if (!id) return
    void (async () => {
      const picked = await window.api.popupMenu([{ id: 'delete-note', label: t('win.aiNoteDelete') }])
      if (picked === 'delete-note' && window.confirm(t('win.aiNoteDeleteConfirm'))) deleteNote(id)
    })()
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
  // 渲染完成 → 重打当前文件全部批注标签(重渲染已清空 DOM,天然幂等)
  bus.on('rendered', decorateNotes)

  // ── 启动载入持久化数据 ──
  void (async () => {
    try {
      const h = await window.api.dataGet('ai-history')
      if (Array.isArray(h)) history = h as Conversation[]
      const n = await window.api.dataGet('ai-notes')
      if (n && typeof n === 'object' && !Array.isArray(n)) notes = n as Record<string, Note[]>
    } catch {
      // 读取失败按空数据处理
    }
    decorateNotes() // 首次渲染可能早于数据载入,此处补打
  })()
}
