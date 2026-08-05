// 渲染器侧 AI 流式客户端 — 按 id 路由增量,封装 runAi()。
// 主进程经 EvAiDelta 推 { id, text };这里统一订阅一次并分发到对应回调。
import type { AiMessage } from '@shared/ipc'

const handlers = new Map<string, (text: string) => void>()
let subscribed = false
let seq = 0

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  window.api.onAiDelta((d) => handlers.get(d.id)?.(d.text))
}

export interface AiRunHandle {
  id: string
  /** 中止本次生成 */
  cancel: () => void
  /** 结束时 resolve:ok=false 时 error 为 'not-configured' | 'aborted' | 具体错误信息 */
  done: Promise<{ ok: boolean; error?: string }>
}

/** 发起一次流式生成;每收到一段文本调用 onText(增量,非累积)。 */
export function runAi(opts: {
  system?: string
  messages: AiMessage[]
  onText: (text: string) => void
}): AiRunHandle {
  ensureSubscribed()
  const id = `ai-${Date.now()}-${++seq}`
  handlers.set(id, opts.onText)
  const done = window.api
    .aiStream({ id, system: opts.system, messages: opts.messages })
    .finally(() => handlers.delete(id))
  return { id, cancel: () => void window.api.aiCancel(id), done }
}

/** 当前是否已配置 AI(base+key+model 齐全) */
export function aiConfigured(settings: {
  aiBaseUrl: string
  aiApiKey: string
  aiModel: string
}): boolean {
  return !!(settings.aiBaseUrl.trim() && settings.aiApiKey.trim() && settings.aiModel.trim())
}
