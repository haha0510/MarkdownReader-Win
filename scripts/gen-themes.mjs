#!/usr/bin/env node
// 从 design/themes.json 生成 src/renderer/src/theme/themes.ts(字面量数据)。
// 用法: node scripts/gen-themes.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcPath = join(root, 'design', 'themes.json')
const outPath = join(root, 'src', 'renderer', 'src', 'theme', 'themes.ts')

const raw = JSON.parse(readFileSync(srcPath, 'utf8'))
if (!Array.isArray(raw) || raw.length === 0) throw new Error('themes.json 为空或非数组')

const COLOR_KEYS = ['surface', 'ink', 'accent', 'success', 'danger']
const TYPO_KEYS = [
  'bodyFontFamily',
  'headingFontFamily',
  'codeFontFamily',
  'bodyFontSize',
  'lineHeight',
  'letterSpacing',
  'borderRadius'
]
const HEX_RE = /^#[0-9a-fA-F]{6}$/

// ── 校验源数据 ──
const seen = new Set()
for (const t of raw) {
  for (const k of ['id', 'name', ...COLOR_KEYS]) {
    if (typeof t[k] !== 'string' || t[k] === '') throw new Error(`主题 ${t.id ?? '?'} 缺字段 ${k}`)
  }
  if (typeof t.dark !== 'boolean') throw new Error(`主题 ${t.id} dark 无效`)
  if (!Number.isInteger(t.contrast) || t.contrast < 0 || t.contrast > 100)
    throw new Error(`主题 ${t.id} contrast 无效: ${t.contrast}`)
  for (const k of COLOR_KEYS) {
    if (!HEX_RE.test(t[k])) throw new Error(`主题 ${t.id} 颜色 ${k}=${t[k]} 非 #rrggbb`)
  }
  if (seen.has(t.id)) throw new Error(`主题 id 重复: ${t.id}`)
  seen.add(t.id)
}
if (!seen.has('buddy-dark') || !seen.has('buddy-light')) throw new Error('缺少默认主题 buddy-dark / buddy-light')

const q = JSON.stringify // 字符串安全转义

function themeLiteral(t) {
  const colors = COLOR_KEYS.map((k) => `${k}: ${q(t[k])}`).join(', ')
  const typoKeys = TYPO_KEYS.filter((k) => typeof t[k] === 'string' && t[k] !== '')
  const typo = typoKeys.length === 0 ? '{}' : `{ ${typoKeys.map((k) => `${k}: ${q(t[k])}`).join(', ')} }`
  return [
    '  {',
    `    id: ${q(t.id)},`,
    `    name: ${q(t.name)},`,
    `    dark: ${t.dark},`,
    `    colors: { ${colors} },`,
    `    contrast: ${t.contrast},`,
    `    typography: ${typo}`,
    '  }'
  ].join('\n')
}

const code = `// 本文件由 scripts/gen-themes.mjs 依据 design/themes.json 自动生成 — 勿手改。
// 共 ${raw.length} 个主题,顺序与源一致(暗色在前)。

/** 主题元信息(主题列表/选择器用) */
export interface ThemeInfo {
  id: string
  name: string
  dark: boolean
}

/** 5 基色(#rrggbb) */
export interface ThemeColors {
  surface: string
  ink: string
  accent: string
  success: string
  danger: string
}

/** 可选排版覆盖(原始 CSS 值;缺省 = 用默认) */
export interface ThemeTypography {
  bodyFontFamily?: string
  headingFontFamily?: string
  codeFontFamily?: string
  bodyFontSize?: string
  lineHeight?: string
  letterSpacing?: string
  borderRadius?: string
}

/** 完整主题定义:基色 + 对比度(0-100) + 排版 */
export interface FullTheme extends ThemeInfo {
  colors: ThemeColors
  contrast: number
  typography: ThemeTypography
}

/** 参考项目默认主题 id */
export const DEFAULT_DARK: string = 'buddy-dark'
export const DEFAULT_LIGHT: string = 'buddy-light'

/** 全部主题完整数据(源顺序) */
export const fullThemes: FullTheme[] = [
${raw.map(themeLiteral).join(',\n')}
]

/** 主题元信息列表(源顺序) */
export const themes: ThemeInfo[] = fullThemes.map((t) => ({ id: t.id, name: t.name, dark: t.dark }))

const byId: Map<string, FullTheme> = new Map(fullThemes.map((t) => [t.id, t]))

/** 按 id 查找主题 */
export function getTheme(id: string): FullTheme | undefined {
  return byId.get(id)
}
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, code, 'utf8')
console.log(`已生成 ${outPath}(${raw.length} 个主题,暗色 ${raw.filter((t) => t.dark).length} / 亮色 ${raw.filter((t) => !t.dark).length})`)
