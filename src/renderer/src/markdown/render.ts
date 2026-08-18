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
import dos from 'highlight.js/lib/languages/dos'
import cmake from 'highlight.js/lib/languages/cmake'
import properties from 'highlight.js/lib/languages/properties'
import groovy from 'highlight.js/lib/languages/groovy'
import x86asm from 'highlight.js/lib/languages/x86asm'
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
hljs.registerLanguage('dos', dos)
hljs.registerLanguage('cmake', cmake)
hljs.registerLanguage('properties', properties)
hljs.registerLanguage('groovy', groovy)
hljs.registerLanguage('x86asm', x86asm)

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
  // 避开 markdown-it-footnote 的 id 命名空间(fn1/fnref1),防止页内锚点冲突
  if (/^fn(?:ref)?\d+$/.test(s)) return `${s}-h`
  return s || 'section'
}

let mdSingleton: MarkdownIt | null = null

function getMd(): MarkdownIt {
  if (mdSingleton) return mdSingleton
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  // 关闭无协议的"模糊"识别:裸词 README.md 会被当作 .md(摩尔多瓦)域名连去外网
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })

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

  // 2) 本地媒体路径改写(img/video/audio/source 的 src 与 srcset)
  const toMdr = (val: string): string | null => {
    const t = val.trim()
    if (!t) return null
    if (SCHEME_RE.test(t) && !DRIVE_RE.test(t)) return null // http(s)/data/mdr/file 等协议不动
    const abs = resolveLocal(tryDecode(t), baseDir)
    return abs ? `mdr://local/${encodeURIComponent(abs)}` : null
  }
  root.querySelectorAll('img, video, audio, source').forEach((el) => {
    const src = el.getAttribute('src')
    if (src) {
      const m = toMdr(src)
      if (m) el.setAttribute('src', m)
    }
    const srcset = el.getAttribute('srcset')
    if (srcset) {
      // srcset:逗号分隔的 "url [描述符]" 列表,逐项改写
      const rewritten = srcset
        .split(',')
        .map((entry) => {
          const parts = entry.trim().split(/\s+/)
          if (parts.length === 0 || !parts[0]) return entry.trim()
          const m = toMdr(parts[0])
          if (m) parts[0] = m
          return parts.join(' ')
        })
        .join(', ')
      el.setAttribute('srcset', rewritten)
    }
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

/**
 * 仅提取大纲,不产出 HTML(编辑模式实时大纲用)。
 * markdown-it-anchor 注册的是 core 规则(core.ruler.push('anchor')),md.parse 即触发其
 * callback(已对 node_modules 实测:parse 触发、id 去重后缀一致、去重状态按次重建),
 * 因此 id 与 renderMarkdown 对同一文本的产出(含 -1/-2 去重后缀)严格一致;
 * fence 等渲染器规则不执行,plantuml server 等渲染期状态不受影响。
 */
export function extractOutline(src: string): OutlineItem[] {
  const md = getMd()
  outlineCollector = []
  md.parse(src, {})
  const outline = outlineCollector
  outlineCollector = [] // 断开与模块态的别名,避免后续渲染误改返回值
  return outline
}

// ── 代码/文本文件直读视图(非 markdown 的 currentFile) ──

/** 扩展名(去点小写)→ hljs 语言名;未列出或未注册的语言降级纯转义 */
const CODE_LANG_BY_EXT: Record<string, string> = {
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  bat: 'dos',
  cmd: 'dos',
  ps1: 'powershell',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  toml: 'ini',
  properties: 'properties',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  svelte: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  java: 'java',
  kt: 'kotlin',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
  lua: 'lua',
  dart: 'dart',
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivec',
  s: 'x86asm',
  asm: 'x86asm',
  cmake: 'cmake',
  mk: 'makefile',
  gradle: 'groovy'
}

/** 无后缀特例文件名(小写)→ hljs 语言名 */
const CODE_LANG_BY_NAME: Record<string, string> = {
  makefile: 'makefile',
  gnumakefile: 'makefile',
  dockerfile: 'dockerfile',
  jenkinsfile: 'groovy'
}

/** 超过 1MB 直接纯文本不高亮(防卡) */
const CODE_HIGHLIGHT_MAX = 1024 * 1024

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 渲染代码/纯文本文件为高亮 HTML(同步)。
 * 输出 `<pre class="hljs code-file">`,复用 markdown 代码块的主题样式与复制按钮机制。
 */
export function renderCodeFile(src: string, filePath: string): string {
  const base = toSlash(filePath).slice(toSlash(filePath).lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1) : ''
  const lang = CODE_LANG_BY_EXT[ext] ?? CODE_LANG_BY_NAME[base] ?? ''
  const canHighlight = src.length <= CODE_HIGHLIGHT_MAX && !!lang && !!hljs.getLanguage(lang)
  const body = canHighlight
    ? hljs.highlight(src, { language: lang, ignoreIllegals: true }).value
    : escapeHtml(src)
  const cls = canHighlight ? `language-${lang} hljs` : 'hljs'
  return `<pre class="hljs code-file"><code class="${cls}">${body}</code></pre>\n`
}
