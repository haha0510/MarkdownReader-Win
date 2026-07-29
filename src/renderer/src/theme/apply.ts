// 主题应用 — 解析当前主题,按 design/theme-derivation.md 派生全部 token,
// 一次性写入 documentElement 的 CSS 变量(CONTRACTS §4 目录),并同步标题栏 overlay。
// 注:铬区背景(titlebar/sidebar/panel)与正文点缀色在参考派生之上做了层次化增强:
// 标题栏最深 → 侧栏次深(渗一丝 accent) → 正文 surface → 面板/浮层最亮;
// 标题/行内代码/引用条/表头按固定比例混入 accent,让每套主题自带色彩层次。
import type { RendererApi } from '@shared/ipc'
import { store } from '@/state'
import { bus } from '@/bus'
import { DEFAULT_DARK, DEFAULT_LIGHT, getTheme, type FullTheme } from './themes'
import '@/styles/hljs.css'

type RGB = readonly [number, number, number] // 0..255 整数

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

// ── 颜色数学(与参考实现严格一致:sRGB 逐通道插值 + 向零截断) ──

/** 解析 #rgb / #rrggbb;失败返回 null */
function parseHex(hex: string): RGB | null {
  let h = hex.trim().replace(/#/g, '')
  if (h.length === 3)
    h = h
      .split('')
      .map((ch) => ch + ch)
      .join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const v = parseInt(h, 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/** sRGB 线性插值 a*(1-f)+b*f;通道结果截断(参考实现 cssHex 语义,非四舍五入) */
function mix(a: RGB, b: RGB, f: number): RGB {
  const ch = (av: number, bv: number): number => Math.trunc(((av / 255) * (1 - f) + (bv / 255) * f) * 255)
  return [ch(a[0], b[0]), ch(a[1], b[1]), ch(a[2], b[2])]
}

/** 小写 #rrggbb */
function cssHex(c: RGB): string {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** rgba(r, g, b, a) — alpha 两位小数(参考实现 %.2f) */
function cssRgba(c: RGB, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(2)})`
}

/** 感知亮度 0..1(0.299/0.587/0.114) */
function brightness(c: RGB): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
}

// ── 派生并映射到契约变量目录 ──

interface BuiltTheme {
  vars: Record<string, string>
  overlay: { color: string; symbolColor: string }
  dark: boolean
}

function buildVars(theme: FullTheme): BuiltTheme {
  const dark = theme.dark // 派生分支用声明类型(theme-derivation.md §3)
  const c = theme.contrast / 100
  // 预置主题必解析成功;失败按参考实现回退基色
  const surface: RGB = parseHex(theme.colors.surface) ?? BLACK
  const ink: RGB = parseHex(theme.colors.ink) ?? WHITE
  const accent: RGB = parseHex(theme.colors.accent) ?? [0, 0, 255]
  const success: RGB = parseHex(theme.colors.success) ?? [0, 255, 0]
  const danger: RGB = parseHex(theme.colors.danger) ?? [255, 0, 0]

  // 派生 token(§3 公式)
  const fSubtle = dark ? 0.02 + c * 0.02 : 0.08 + c * 0.08
  const fMuted = dark ? 0.04 + c * 0.03 : 0.12 + c * 0.1 // bgMuted 混合比,亦作内联代码底色 alpha
  const aSecondary = 0.65 + c * 0.1
  const aFgMuted = dark ? 0.42 + c * 0.13 : 0.45 + c * 0.1
  const accentHover = dark ? mix(accent, WHITE, 0.12) : mix(accent, BLACK, 0.08)
  // 暗色 accentSoft 以纯黑为基(非 surface),与参考一致
  const accentSoft = dark ? mix(BLACK, accent, 0.2 + c * 0.08) : mix(surface, accent, 0.11 + c * 0.04)
  const aBorder = 0.06 + c * 0.04 // 弱边线(hr/滚动条,保持参考值)
  const aBorderUi = 0.1 + c * 0.05 // --ui-border 加强一档,铬区分界更可见
  const aBorderSubtle = 0.04 + c * 0.02

  // ── 铬区台阶(层次化):标题栏最深 → 侧栏次深(渗一丝 accent) → 正文 surface → 面板/浮层最亮 ──
  // 护栏:surface 近纯黑(RGB 均 <12)时 darken 无感 → 反向改微提亮;近纯白同理,面板反向微压暗
  const nearBlack = surface.every((v) => v < 12)
  const nearWhite = surface.every((v) => v > 243)
  let titlebarBg: RGB
  let sidebarBg: RGB
  let panelBg: RGB
  if (dark) {
    titlebarBg = nearBlack ? mix(surface, WHITE, 0.045) : mix(surface, BLACK, 0.22)
    sidebarBg = mix(nearBlack ? mix(surface, WHITE, 0.028) : mix(surface, BLACK, 0.12), accent, 0.05)
    panelBg = mix(surface, WHITE, 0.05)
  } else {
    titlebarBg = mix(surface, BLACK, 0.07)
    sidebarBg = mix(mix(surface, BLACK, 0.04), accent, 0.04)
    // 面板/浮层提亮浮起;近纯白提亮无感 → 微压暗,靠加强的边框与阴影分层
    panelBg = nearWhite ? mix(surface, BLACK, 0.025) : mix(surface, WHITE, 0.35)
  }

  // ── 主题色渗入正文:固定混合比,33 套深浅主题均不塌对比 ──
  const mdHeading = mix(ink, accent, 0.22) // 标题 = ink 带 22% accent
  const mdHeadingBorder = mix(accent, surface, dark ? 0.35 : 0.45) // h1/h2 下划线
  const mdInlineCodeFg = mix(accent, ink, 0.35) // 行内代码前景
  const mdBlockquoteBorder = mix(accent, surface, dark ? 0.5 : 0.4) // 引用左边条
  const mdTableHeadBg = mix(surface, accent, dark ? 0.14 : 0.1) // 表头底色 = surface 渗 accent

  // 代码高亮色(§5;isDarkCode 按感知亮度判定,33 个预置与声明类型一致)
  const isDarkCode = brightness(surface) < brightness(ink)
  const codeBg = mix(surface, ink, isDarkCode ? 0.06 : 0.04)
  const hlString = isDarkCode ? mix(success, WHITE, 0.15) : mix(success, ink, 0.15)
  const hlNumber = mix(accent, danger, 0.25)
  const hlFunction = mix(accent, ink, 0.4)
  const hlVariable = mix(ink, success, 0.15) // 参考 Prism variable 色 → 映射给 --hl-meta
  const hlTag = mix(accent, success, 0.4)
  const hlAttr = mix(accent, danger, 0.3)
  const hlBuiltin = mix(accent, ink, 0.3)

  // accent 上可读的前景:按感知亮度取黑/白
  const accentFg = brightness(accent) >= 0.6 ? '#000000' : '#ffffff'

  const vars: Record<string, string> = {
    // ── UI 铬 ──
    '--ui-bg': cssHex(surface),
    '--ui-fg': cssHex(ink),
    '--ui-fg-muted': cssRgba(ink, aFgMuted),
    '--ui-accent': cssHex(accent),
    '--ui-accent-fg': accentFg,
    '--ui-border': cssRgba(ink, aBorderUi),
    '--ui-hover': cssRgba(ink, 0.06),
    '--ui-active': cssRgba(ink, 0.1),
    '--ui-selection': cssRgba(accentSoft, 1),
    '--ui-titlebar-bg': cssHex(titlebarBg),
    '--ui-sidebar-bg': cssHex(sidebarBg),
    '--ui-panel-bg': cssHex(panelBg),
    '--ui-popover-bg': cssHex(panelBg),
    '--ui-danger': cssHex(danger),
    '--ui-success': cssHex(success),
    // 滚动条:低透明度 ink(与参考 scroll.css thumb=border / hover=fgMuted 一致)
    '--ui-scrollbar': cssRgba(ink, aBorder),
    '--ui-scrollbar-hover': cssRgba(ink, aFgMuted),
    // ── 正文 ──
    '--md-bg': cssHex(surface),
    '--md-fg': cssHex(ink),
    '--md-heading': cssHex(mdHeading),
    '--md-heading-border': cssHex(mdHeadingBorder),
    '--md-link': cssHex(accent),
    '--md-border': cssRgba(ink, aBorderSubtle),
    '--md-code-bg': cssHex(codeBg),
    '--md-code-fg': cssHex(ink), // 参考实现 cssHex 丢弃 alpha → 即 ink
    '--md-inline-code-bg': cssRgba(ink, fMuted), // bgMuted 的 alpha 形式(叠在 surface 上等价)
    '--md-inline-code-fg': cssHex(mdInlineCodeFg),
    '--md-blockquote-fg': cssRgba(ink, aSecondary),
    '--md-blockquote-border': cssHex(mdBlockquoteBorder),
    '--md-table-stripe': cssRgba(ink, fSubtle), // bgSubtle 的 alpha 形式
    '--md-table-head-bg': cssHex(mdTableHeadBg),
    '--md-hr': cssRgba(ink, aBorder),
    '--md-mark-bg': cssRgba(accent, 0.25),
    // ── 代码高亮(hljs.css 消费) ──
    '--hl-comment': cssRgba(ink, aFgMuted),
    '--hl-keyword': cssHex(accent),
    '--hl-string': cssHex(hlString),
    '--hl-number': cssHex(hlNumber),
    '--hl-function': cssHex(hlFunction),
    '--hl-title': cssHex(accent), // 章节标题(markdown section)
    '--hl-attr': cssHex(hlAttr),
    '--hl-tag': cssHex(hlTag),
    '--hl-literal': cssHex(accent), // Prism boolean 用 keyword 色
    '--hl-builtin': cssHex(hlBuiltin),
    '--hl-type': cssHex(success), // Prism className
    '--hl-meta': cssHex(hlVariable),
    '--hl-addition-bg': cssRgba(success, 0.16),
    '--hl-deletion-bg': cssRgba(danger, 0.16)
  }

  // 排版覆盖:仅字体族;字号/行高归设置端(--md-font-size/--md-line-height 由 D 维护,见 §8)
  const typo = theme.typography
  if (typo.bodyFontFamily) vars['--md-body-font'] = typo.bodyFontFamily
  if (typo.headingFontFamily) vars['--md-heading-font'] = typo.headingFontFamily
  if (typo.codeFontFamily) vars['--md-code-font'] = typo.codeFontFamily

  return { vars, overlay: { color: cssHex(titlebarBg), symbolColor: cssHex(ink) }, dark }
}

/** 解析生效主题:auto 时按系统明暗取 light/dark 主题;查不到回落默认 */
function resolveTheme(): FullTheme {
  const st = store.get()
  const s = st.settings
  const id = s.theme === 'auto' ? (st.systemDark ? s.darkTheme : s.lightTheme) : s.theme
  return getTheme(id) ?? getTheme(st.systemDark ? DEFAULT_DARK : DEFAULT_LIGHT)!
}

/** 应用当前主题:一次性写入全部变量 → data-dark/color-scheme → overlay → theme-changed */
function applyTheme(): void {
  const { vars, overlay, dark } = buildVars(resolveTheme())
  const el = document.documentElement
  // 字体族覆盖会随主题消失,先清除再统一写入
  el.style.removeProperty('--md-body-font')
  el.style.removeProperty('--md-heading-font')
  el.style.removeProperty('--md-code-font')
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
  el.dataset.dark = dark ? 'true' : 'false'
  el.style.setProperty('color-scheme', dark ? 'dark' : 'light')
  // 同步系统标题栏 overlay 配色(失败静默)
  const api = (window as unknown as { api?: RendererApi }).api
  api?.setOverlay(overlay).catch(() => {})
  bus.emit('theme-changed')
}

let inited = false

/** 初始化主题系统:立即应用一次,并订阅 settings/systemDark 变化 */
export function initTheme(): void {
  if (inited) return
  inited = true
  // 仅主题相关字段变化才重应用(避免 fontSize 等变更触发 mermaid 无谓重渲染)
  store.on('settings', (next, prev) => {
    if (next.theme !== prev.theme || next.lightTheme !== prev.lightTheme || next.darkTheme !== prev.darkTheme) {
      applyTheme()
    }
  })
  // 系统明暗切换:仅 auto 模式受影响
  store.on('systemDark', () => {
    if (store.get().settings.theme === 'auto') applyTheme()
  })
  applyTheme()
}
