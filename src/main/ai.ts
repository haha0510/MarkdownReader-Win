// AI 转发 — 通用 OpenAI 兼容接口(DeepSeek / OpenAI / 各类中转均可)。
// 主进程直连 {baseUrl}/chat/completions(不受渲染器 CSP 限制),SSE 流式,
// 增量经 EvAiDelta 推送渲染器。仅做透明转发,提示词由渲染器构造。
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import type { AiRequest } from '@shared/ipc'
import { getSettings } from './store'

// 进行中的请求 id → AbortController
const active = new Map<string, AbortController>()

/** 规范化 endpoint:用户填 base(如 https://api.deepseek.com)自动补 /chat/completions;
 *  已含该后缀则原样使用,便于填自定义中转完整地址。 */
function endpointOf(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(u) ? u : `${u}/chat/completions`
}

/** 从错误响应体尽量提取可读信息 */
function extractErr(text: string): string {
  try {
    const j = JSON.parse(text)
    const msg = j?.error?.message ?? j?.message ?? j?.error
    if (typeof msg === 'string') return msg
  } catch {
    // 非 JSON
  }
  return text.slice(0, 300)
}

export function cancelAi(id: string): void {
  active.get(id)?.abort()
  active.delete(id)
}

/** 连接测试:一次极短的非流式请求 */
export async function testAi(cfg: {
  baseUrl: string
  apiKey: string
  model: string
}): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = cfg.baseUrl?.trim()
  const apiKey = cfg.apiKey?.trim()
  const model = cfg.model?.trim()
  if (!baseUrl || !apiKey || !model) return { ok: false, error: 'not-configured' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(endpointOf(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        stream: false
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status} ${extractErr(t)}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: /abort/i.test(msg) ? 'timeout' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** 流式生成:逐 token 推 EvAiDelta,结束返回 { ok }。取消 → ok:false, error:'aborted'。 */
export async function streamAi(wc: WebContents, req: AiRequest): Promise<{ ok: boolean; error?: string }> {
  const s = getSettings()
  const baseUrl = s.aiBaseUrl?.trim()
  const apiKey = s.aiApiKey?.trim()
  const model = s.aiModel?.trim()
  if (!baseUrl || !apiKey || !model) return { ok: false, error: 'not-configured' }

  const controller = new AbortController()
  active.set(req.id, controller)
  try {
    const messages = req.system
      ? [{ role: 'system', content: req.system }, ...req.messages]
      : req.messages
    const res = await fetch(endpointOf(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 8192 }),
      signal: controller.signal
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status} ${extractErr(t)}` }
    }
    if (!res.body) return { ok: false, error: 'empty-response' }

    const decoder = new TextDecoder()
    let buf = ''
    // Node fetch 的 body 是 Uint8Array 的异步可迭代对象
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (controller.signal.aborted) break
      buf += decoder.decode(chunk, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? '' // 末行可能不完整,留到下次
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          const delta: unknown = j?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0 && !wc.isDestroyed()) {
            wc.send(IPC.EvAiDelta, { id: req.id, text: delta })
          }
        } catch {
          // 不完整/非 JSON 的 data 行,跳过
        }
      }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort/i.test(msg)) return { ok: false, error: 'aborted' }
    return { ok: false, error: msg }
  } finally {
    active.delete(req.id)
  }
}
