#!/usr/bin/env node
// 从 design/i18n.json 生成 src/renderer/src/i18n/strings.ts。
// 参考项目 key/文案逐字保留;末尾追加 Windows 移植新增的 win.* key(三语)。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const design = JSON.parse(readFileSync(resolve(root, 'design/i18n.json'), 'utf8'))

// Windows 版新增 key(参考项目没有对应文案的 UI)
const winKeys = {
  'win.copyCode': { zhHans: '复制代码', zhHant: '複製程式碼', en: 'Copy code' },
  'win.copied': { zhHans: '已复制', zhHant: '已複製', en: 'Copied' },
  'win.saved': { zhHans: '已保存', zhHant: '已儲存', en: 'Saved' },
  'win.saveFailed': { zhHans: '保存失败', zhHant: '儲存失敗', en: 'Save failed' },
  'win.loadError': { zhHans: '文件加载失败', zhHant: '檔案載入失敗', en: 'Failed to load file' },
  'win.exportPdfSuccess': {
    zhHans: 'PDF 已导出：{path}',
    zhHant: 'PDF 已匯出：{path}',
    en: 'PDF exported: {path}'
  },
  'win.exportPdfFailed': { zhHans: 'PDF 导出失败', zhHant: 'PDF 匯出失敗', en: 'Failed to export PDF' },
  'win.confirmDiscardChanges': {
    zhHans: '有未保存的更改，确定要放弃吗？',
    zhHant: '有未儲存的變更，確定要放棄嗎？',
    en: 'You have unsaved changes. Discard them?'
  },
  'win.externalChangeReload': {
    zhHans: '文件已被外部修改，已重新加载',
    zhHant: '檔案已被外部修改，已重新載入',
    en: 'File changed on disk — reloaded'
  },
  'win.newFileDefaultName': { zhHans: '未命名', zhHant: '未命名', en: 'Untitled' },
  'win.themeFollowSystem': { zhHans: '主题：跟随系统', zhHant: '主題：跟隨系統', en: 'Theme: Follow System' },
  'win.themeLight': { zhHans: '主题：浅色', zhHant: '主題：淺色', en: 'Theme: Light' },
  'win.themeDark': { zhHans: '主题：深色', zhHant: '主題：深色', en: 'Theme: Dark' },
  'win.recentFolders': { zhHans: '最近打开', zhHant: '最近開啟', en: 'Recent' },
  'win.noRecent': { zhHans: '暂无最近打开的项目', zhHant: '暫無最近開啟的項目', en: 'No recent items' },
  'win.matchCase': { zhHans: '区分大小写', zhHant: '區分大小寫', en: 'Match case' },
  'win.findPlaceholder': { zhHans: '查找…', zhHant: '尋找…', en: 'Find…' },
  'win.languageReloadHint': {
    zhHans: '语言已更改，部分界面在重启应用后完全生效',
    zhHant: '語言已更改，部分介面在重新啟動應用後完全生效',
    en: 'Language changed. Some UI updates fully after restart.'
  },
  'win.resetSettings': { zhHans: '重置为默认设置', zhHant: '重設為預設設定', en: 'Reset to Defaults' },
  'win.emptyTree': {
    zhHans: '此目录下没有 Markdown 文件',
    zhHant: '此目錄下沒有 Markdown 檔案',
    en: 'No Markdown files in this folder'
  },
  'win.emptyOutline': { zhHans: '暂无标题', zhHant: '暫無標題', en: 'No headings' },
  'win.paletteNoResults': { zhHans: '未找到结果', zhHant: '未找到結果', en: 'No results found' },
  'win.palettePlaceholder': {
    zhHans: '按名称搜索文件…',
    zhHant: '按名稱搜尋檔案…',
    en: 'Search files by name…'
  }
}

const all = { ...design.keys, ...winKeys }

// ── Windows 术语替换(仅生成层后处理;design/i18n.json 原始数据与 key 一律不动)──
// 参考项目为 macOS 文案(访达/废纸篓/Finder/Trash),Windows 版全局替换为对应术语。
// 注:原始简/繁文案中部分条目直接夹带英文 "Finder",一并按语言替换。
const TERM_MAP = {
  zhHans: [
    ['访达', '资源管理器'],
    ['Finder', '资源管理器'],
    ['废纸篓', '回收站']
  ],
  zhHant: [
    ['訪達', '檔案總管'],
    ['Finder', '檔案總管'],
    ['垃圾桶', '資源回收筒'],
    ['廢紙簍', '資源回收筒']
  ],
  en: [
    ['Finder', 'File Explorer'],
    ['Trash', 'Recycle Bin']
  ]
}

/** 对单条文案按语言应用全部术语替换 */
function winTerms(lang, text) {
  let out = text
  for (const [from, to] of TERM_MAP[lang]) out = out.replaceAll(from, to)
  return out
}

const lines = []
lines.push('// 本文件由 scripts/gen-i18n.mjs 自动生成 — 勿手改;修改 design/i18n.json 或脚本后重新生成。')
lines.push('')
lines.push('/** 单条文案(三语) */')
lines.push('export interface LocaleEntry {')
lines.push('  zhHans: string')
lines.push('  zhHant: string')
lines.push('  en: string')
lines.push('}')
lines.push('')
lines.push('export const strings = {')
for (const [key, v] of Object.entries(all)) {
  if (typeof v?.zhHans !== 'string' || typeof v?.zhHant !== 'string' || typeof v?.en !== 'string') {
    throw new Error(`key "${key}" 缺少语言字段`)
  }
  lines.push(
    `  ${JSON.stringify(key)}: { zhHans: ${JSON.stringify(winTerms('zhHans', v.zhHans))}, zhHant: ${JSON.stringify(
      winTerms('zhHant', v.zhHant)
    )}, en: ${JSON.stringify(winTerms('en', v.en))} },`
  )
}
lines.push('} satisfies Record<string, LocaleEntry>')
lines.push('')
lines.push('export type I18nKey = keyof typeof strings')
lines.push('')

const outPath = resolve(root, 'src/renderer/src/i18n/strings.ts')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`generated ${outPath} (${Object.keys(all).length} keys)`)
