// markdown 渲染管线:markdown-it + 插件 → HTML 字符串 + 大纲。
// 后处理(<template>,不执行脚本):本地图片改写为 mdr:// 协议、
// 相对 .md 链接标记 data-md-link、外链标记 external-link、安全清理。
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import katexPlugin from '@vscode/markdown-it-katex'
// @ts-ignore -- markdown-it-footnote 未提供类型声明
import mdFootnote from 'markdown-it-footnote'
// @ts-ignore -- markdown-it-task-lists 未提供类型声明
import mdTaskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'
import dart from 'highlight.js/lib/languages/dart'
import scala from 'highlight.js/lib/languages/scala'
import http from 'highlight.js/lib/languages/http'
import type { OutlineItem } from '@shared/types'
import { MD_EXTENSIONS } from '@shared/types'
import { plantumlBlockHtml } from './plantuml'
// @ts-ignore -- css 由 vite 处理
import 'katex/dist/katex.min.css'
// @ts-ignore -- css 由 vite 处理
import '@/styles/markdown.css'

const footnotePlugin = mdFootnote as (md: MarkdownIt) => void
const taskListsPlugin = mdTaskLists as (
  md: MarkdownIt,
  opts?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }
) => void

// 补充 lib/common 之外的常用语言(确定性注册,不做自动检测)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('dart', dart)
hljs.registerLanguage('scala', scala)
hljs.registerLanguage('http', http)

// ── 每次 render 期间的临时状态(单线程,渲染同步完成) ──
let outlineCollector: OutlineItem[] = []
let currentPlantumlServer = ''

/** github 风格 slug:小写、trim、空白→'-'、仅保留字母(含 CJK)/数字/-/_;空结果回退 'section' */
function githubSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
  return s || 'section'
}

let mdSingleton: MarkdownIt | null = null

function getMd(): MarkdownIt {
  if (mdSingleton) return mdSingleton
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })

  // 围栏代码块渲染:mermaid / plantuml / highlight.js。
  // 必须在 use(katexPlugin) 之前赋值,katex 会包装本规则以接管 ```math。
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : ''
    const rawLang = info.split(/\s+/)[0] ?? ''
    const lang = rawLang.toLowerCase()
    const code = token.content

    if (lang === 'mermaid') {
      // 源码存 data-src,由 mermaid.ts 懒渲染;encodeURIComponent 结果在双引号属性中安全
      return `<div class="mermaid-block" data-src="${encodeURIComponent(code)}"></div>\n`
    }
    if (lang === 'plantuml' || lang === 'puml') {
      const block = plantumlBlockHtml(code, currentPlantumlServer)
      if (block !== null) return block
      // 服务器为空 → 按普通代码块降级
    }

    // 确定性高亮:已注册语言才高亮,否则纯转义(不自动检测)
    const body =
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        : md.utils.escapeHtml(code)
    const cls = rawLang ? `language-${md.utils.escapeHtml(rawLang)} hljs` : 'hljs'
    return `<pre class="hljs"><code class="${cls}">${body}</code></pre>\n`
  }

  md.use(taskListsPlugin, { enabled: false, label: true })
  md.use(footnotePlugin)
  md.use(katexPlugin, { enableFencedBlocks: true, throwOnError: false })
  md.use(anchor, {
    // 不加 permalink 链接(默认关闭);不给标题加 tabindex
    tabIndex: false,
    slugify: githubSlug,
    callback: (token, info) => {
      // heading_open token:tag = h1..h6,map[0] = 0 基起始行
      outlineCollector.push({
        level: Number(token.tag.slice(1)) || 1,
        text: info.title,
        id: info.slug,
        line: token.map?.[0] ?? 0
      })
    }
  })
  mdSingleton = md
  return md
}

// ── 路径工具(统一 '/' 分隔的 Windows 路径) ──

const DRIVE_RE = /^[a-zA-Z]:(\/|\\|$)/
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

function toSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 去文件名取目录;'D:/a/b.md' → 'D:/a' */
function dirnameSlash(p: string): string {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : p
}

/** 归一化 '/' 分隔路径:处理 ./ ../ 、盘符与 UNC 前缀 */
function normalizePath(p: string): string {
  let rest = toSlash(p)
  let drive = ''
  const dm = /^([a-zA-Z]:)/.exec(rest)
  if (dm) {
    drive = dm[1]
    rest = rest.slice(2)
  }
  const unc = !drive && rest.startsWith('//')
  const rooted = rest.startsWith('/')
  const out: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!rooted && !drive && !unc) out.push('..')
      // 绝对路径越过根:丢弃该段
    } else {
      out.push(seg)
    }
  }
  const prefix = drive ? `${drive}/` : unc ? '//' : rooted ? '/' : ''
  return prefix + out.join('/')
}

/** 把本地引用解析为绝对路径;非本地或无法解析时返回 null */
function resolveLocal(raw: string, baseDir: string | null): string | null {
  const p = toSlash(raw)
  if (DRIVE_RE.test(p)) return normalizePath(p) // 带盘符绝对路径
  if (p.startsWith('//')) return normalizePath(p) // UNC
  if (p.startsWith('/')) {
    // 根相对:借用文档所在盘符
    if (baseDir) {
      const dm = /^([a-zA-Z]:)/.exec(toSlash(baseDir))
      if (dm) return normalizePath(dm[1] + p)
    }
    return null
  }
  if (SCHEME_RE.test(p)) return null // 其他协议
  if (!baseDir) return null
  return normalizePath(`${toSlash(baseDir)}/${p}`)
}

function tryDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const MD_EXT_RE = new RegExp(`\\.(?:${MD_EXTENSIONS.map((e) => e.slice(1)).join('|')})$`, 'i')

/**
 * HTML 后处理:通过 <template> 解析(内容惰性,脚本不会执行)。
 * 1) 深度防御:移除 <script> 与 on* 内联事件、javascript: 链接
 * 2) 本地图片 → mdr://local/<encodeURIComponent(绝对路径)>
 * 3) 相对/本地 .md 链接 → data-md-link=绝对路径,href='#'
 * 4) http(s) 链接 → class external-link,去 target
 */
function postProcess(html: string, docPath: string | null): string {
  const baseDir = docPath ? dirnameSlash(toSlash(docPath)) : null
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const root = tpl.content

  // 1) 安全清理
  root.querySelectorAll('script').forEach((el) => el.remove())
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
    }
  })

  // 2) 图片路径改写
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src) return
    const t = src.trim()
    if (SCHEME_RE.test(t) && !DRIVE_RE.test(t)) return // http(s)/data/mdr/file 等协议不动
    const abs = resolveLocal(tryDecode(t), baseDir)
    if (abs) img.setAttribute('src', `mdr://local/${encodeURIComponent(abs)}`)
  })

  // 3) 链接处理
  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href')
    if (href === null) return
    const t = href.trim()
    if (/^javascript:/i.test(t)) {
      a.removeAttribute('href')
      return
    }
    if (t.startsWith('#')) return // 页内锚点保留
    if (/^https?:/i.test(t)) {
      a.classList.add('external-link')
      a.removeAttribute('target')
      return
    }
    if (SCHEME_RE.test(t) && !DRIVE_RE.test(t)) return // mailto: 等其他协议
    // 本地链接:先按原始文本剥离 ?query/#fragment 再判断扩展名
    const pure = t.split('#')[0].split('?')[0]
    const decoded = tryDecode(pure)
    if (!MD_EXT_RE.test(decoded)) return
    const abs = resolveLocal(decoded, baseDir)
    if (abs) {
      a.setAttribute('data-md-link', abs)
      a.setAttribute('href', '#')
    }
  })

  return tpl.innerHTML
}

/**
 * 渲染 markdown 源文本。
 * 返回 html(已后处理)与 outline(与渲染出的 heading id 严格一致)。
 */
export function renderMarkdown(
  src: string,
  opts: { docPath: string | null; plantumlServer: string }
): { html: string; outline: OutlineItem[] } {
  const md = getMd()
  currentPlantumlServer = opts.plantumlServer
  outlineCollector = []
  const rawHtml = md.render(src)
  const outline = outlineCollector
  const html = postProcess(rawHtml, opts.docPath)
  return { html, outline }
}
