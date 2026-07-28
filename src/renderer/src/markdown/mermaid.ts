// mermaid 图表模块:懒加载(动态 import,首次遇到图表才加载)、
// 顺序渲染 .mermaid-block、主题切换(theme-changed)时按明暗重渲染。
import type { Mermaid } from 'mermaid'
import { bus } from '@/bus'
import { store } from '@/state'

let mermaidPromise: Promise<Mermaid> | null = null
/** 上次 initialize 使用的明暗态;变化才重新 initialize */
let initializedDark: boolean | null = null
let idSeq = 0
/** 渲染串行队列,避免并发 render 与主题切换交错 */
let queue: Promise<void> = Promise.resolve()

function isDarkNow(): boolean {
  return document.documentElement.dataset.dark === 'true'
}

/** 单例加载 mermaid 并按需(明暗变化时)initialize */
async function getOrInit(dark: boolean): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
  }
  const mermaid = await mermaidPromise
  if (initializedDark !== dark) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default'
    })
    initializedDark = dark
  }
  return mermaid
}

/** 渲染失败时在块内展示错误信息 + 源码 */
function showError(block: HTMLElement, err: unknown, src: string): void {
  const msg = err instanceof Error ? err.message : String(err)
  block.innerHTML = ''
  const box = document.createElement('div')
  box.className = 'mermaid-error'
  const p = document.createElement('p')
  p.textContent = `Mermaid — ${msg}` // 专有名词 + 引擎报错原文,不走 i18n
  const pre = document.createElement('pre')
  pre.textContent = src
  box.append(p, pre)
  block.appendChild(box)
}

async function doRender(container: HTMLElement): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('.mermaid-block:not([data-done])')
  )
  if (blocks.length === 0) return
  const mermaid = await getOrInit(isDarkNow())
  for (const block of blocks) {
    if (!block.isConnected) continue // 期间文档被替换
    const raw = block.dataset.src ?? ''
    const id = `mmd-${++idSeq}`
    let src = raw
    try {
      src = decodeURIComponent(raw)
      const { svg } = await mermaid.render(id, src)
      block.innerHTML = svg
    } catch (err) {
      // mermaid 失败时可能在 body 遗留临时节点,清掉
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
      showError(block, err, src)
    }
    block.dataset.done = 'true'
  }
}

/** 渲染 container 内所有未完成的 mermaid 块(源码在 data-src,渲染后置 data-done) */
export function renderMermaidIn(container: HTMLElement): Promise<void> {
  const run = queue.then(() => doRender(container))
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 注册主题联动:theme-changed 且处于渲染模式时,清 data-done 并按新明暗重渲染 */
export function initMermaidModule(): void {
  bus.on('theme-changed', () => {
    if (store.get().mode !== 'rendered') return
    const viewer = document.getElementById('viewer')
    if (!viewer) return
    const done = viewer.querySelectorAll<HTMLElement>('.mermaid-block[data-done]')
    if (done.length === 0) return
    done.forEach((b) => b.removeAttribute('data-done'))
    void renderMermaidIn(viewer)
  })
}
