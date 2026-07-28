// i18n — 语言解析 + 查表翻译。strings.ts 由 scripts/gen-i18n.mjs 从 design/i18n.json 生成。
import type { RendererApi } from '@shared/ipc'
import { store } from '@/state'
import type { LocaleEntry } from './strings'
import { strings } from './strings'

// window.api 全局类型声明(preload 注入;declare global 对整个编译单元生效)
declare global {
  interface Window {
    api: RendererApi
  }
}

type Lang = 'zh-Hans' | 'zh-Hant' | 'en'

const FIELD: Record<Lang, keyof LocaleEntry> = { 'zh-Hans': 'zhHans', 'zh-Hant': 'zhHant', en: 'en' }
const table = strings as Record<string, LocaleEntry | undefined>

let current: Lang = store.get().lang

/** 系统 locale(zh-CN / zh-Hant-TW / en-US…)→ 界面语言 */
function resolveLocale(locale: string): Lang {
  const parts = locale.toLowerCase().split(/[-_]/)
  if (parts[0] !== 'zh') return 'en'
  if (parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo')) {
    return 'zh-Hant'
  }
  return 'zh-Hans' // zh / zh-CN / zh-SG / zh-Hans-*
}

function applyLang(lang: Lang): void {
  current = lang
  document.documentElement.lang = lang
  store.set({ lang })
}

/** 启动第一步:按 settings.language(auto 时按系统 locale)解析 store.lang */
export async function initI18n(): Promise<void> {
  const settings = await window.api.getSettings()
  applyLang(settings.language === 'auto' ? resolveLocale(await window.api.getLocale()) : settings.language)
  // 运行时改语言设置 → 更新解析结果(已渲染文本不自动刷新,设置界面用 win.languageReloadHint 提示)
  store.on('settings', (s, prev) => {
    if (s.language === prev.language) return
    if (s.language === 'auto') {
      void window.api.getLocale().then((loc) => applyLang(resolveLocale(loc)))
    } else {
      applyLang(s.language)
    }
  })
}

/** 翻译:回退链 当前语言 → en → key 本身(并 console.warn);{name} 具名占位替换 */
export function t(key: string, params?: Record<string, string | number>): string {
  const entry = table[key]
  let text: string
  if (entry) {
    text = entry[FIELD[current]] || entry.en || key
  } else {
    console.warn(`[i18n] missing key: ${key}`)
    text = key
  }
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}
