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
  'win.aiTitle': { zhHans: 'AI 助手', zhHant: 'AI 助手', en: 'AI Assistant' },
  'win.aiAsk': { zhHans: '选中即问', zhHant: '選取即問', en: 'Ask about selection' },
  'win.aiSummary': { zhHans: '全文摘要', zhHant: '全文摘要', en: 'Summarize' },
  'win.aiTranslate': { zhHans: '翻译对照', zhHant: '翻譯對照', en: 'Translate side-by-side' },
  'win.aiInputPlaceholder': { zhHans: '输入问题,回车发送…', zhHant: '輸入問題,Enter 送出…', en: 'Ask a question, Enter to send…' },
  'win.aiThinking': { zhHans: '正在生成…', zhHant: '正在產生…', en: 'Generating…' },
  'win.aiStop': { zhHans: '停止', zhHant: '停止', en: 'Stop' },
  'win.aiClear': { zhHans: '清空对话', zhHant: '清空對話', en: 'Clear chat' },
  'win.aiNotConfigured': {
    zhHans: '尚未配置 AI:请在设置中填写 API 地址、密钥和模型',
    zhHant: '尚未設定 AI:請在設定中填寫 API 位址、金鑰與模型',
    en: 'AI not configured: set API URL, key and model in Settings'
  },
  'win.aiError': { zhHans: 'AI 请求失败:{msg}', zhHant: 'AI 請求失敗:{msg}', en: 'AI request failed: {msg}' },
  'win.aiSelectionContext': { zhHans: '选中内容', zhHant: '選取內容', en: 'Selected text' },
  'win.aiHistory': { zhHans: '历史对话', zhHant: '歷史對話', en: 'History' },
  'win.aiNewChat': { zhHans: '新对话', zhHant: '新對話', en: 'New chat' },
  'win.aiHistoryEmpty': { zhHans: '暂无历史对话', zhHant: '暫無歷史對話', en: 'No conversations yet' },
  'win.aiHistoryDeleteConfirm': {
    zhHans: '确定删除这条对话记录吗？',
    zhHant: '確定刪除這條對話記錄嗎？',
    en: 'Delete this conversation?'
  },
  'win.aiKindAsk': { zhHans: '选中', zhHant: '選取', en: 'Ask' },
  'win.aiKindSummary': { zhHans: '摘要', zhHant: '摘要', en: 'Summary' },
  'win.aiKindTranslate': { zhHans: '翻译', zhHant: '翻譯', en: 'Translate' },
  'win.aiKindChat': { zhHans: '对话', zhHant: '對話', en: 'Chat' },
  'win.aiNoteDelete': { zhHans: '删除批注', zhHant: '刪除批註', en: 'Delete annotation' },
  'win.aiNoteDeleteConfirm': {
    zhHans: '确定删除这条批注吗？',
    zhHant: '確定刪除這條批註嗎？',
    en: 'Delete this annotation?'
  },
  'win.aiTimeJustNow': { zhHans: '刚刚', zhHant: '剛剛', en: 'just now' },
  'win.aiTimeMinutesAgo': { zhHans: '{n} 分钟前', zhHant: '{n} 分鐘前', en: '{n} min ago' },
  'win.aiTimeHoursAgo': { zhHans: '{n} 小时前', zhHant: '{n} 小時前', en: '{n} h ago' },
  'win.aiTimeDaysAgo': { zhHans: '{n} 天前', zhHant: '{n} 天前', en: '{n} d ago' },
  'win.aiTranslating': { zhHans: '正在翻译…', zhHant: '正在翻譯…', en: 'Translating…' },
  'win.aiOriginal': { zhHans: '原文', zhHant: '原文', en: 'Original' },
  'win.aiTranslation': { zhHans: '译文', zhHant: '譯文', en: 'Translation' },
  'win.settingsAi': { zhHans: 'AI 助手', zhHant: 'AI 助手', en: 'AI Assistant' },
  'win.settingsAiBaseUrl': { zhHans: 'API 地址', zhHant: 'API 位址', en: 'API URL' },
  'win.settingsAiKey': { zhHans: 'API 密钥', zhHant: 'API 金鑰', en: 'API Key' },
  'win.settingsAiModel': { zhHans: '模型名称', zhHant: '模型名稱', en: 'Model' },
  'win.settingsAiTargetLang': { zhHans: '翻译目标语言', zhHant: '翻譯目標語言', en: 'Translation target language' },
  'win.settingsAiTest': { zhHans: '测试连接', zhHant: '測試連線', en: 'Test connection' },
  'win.settingsAiTestOk': { zhHans: '连接成功', zhHant: '連線成功', en: 'Connected' },
  'win.settingsAiTestFail': { zhHans: '连接失败:{msg}', zhHant: '連線失敗:{msg}', en: 'Failed: {msg}' },
  'win.settingsAiHint': {
    zhHans: '兼容 OpenAI 接口(DeepSeek、OpenAI、各类中转)。地址示例:https://api.deepseek.com',
    zhHant: '相容 OpenAI 介面(DeepSeek、OpenAI、各類中轉)。位址範例:https://api.deepseek.com',
    en: 'OpenAI-compatible endpoint (DeepSeek, OpenAI, proxies). e.g. https://api.deepseek.com'
  },
  'win.searchTitle': { zhHans: '全文搜索', zhHant: '全文搜尋', en: 'Search in Files' },
  'win.searchPlaceholder': {
    zhHans: '搜索所有文档内容…',
    zhHant: '搜尋所有文件內容…',
    en: 'Search in all documents…'
  },
  'win.searchNoResults': { zhHans: '没有匹配结果', zhHant: '沒有符合結果', en: 'No results' },
  'win.closeTab': { zhHans: '关闭标签页', zhHant: '關閉分頁', en: 'Close Tab' },
  'win.closeFolder': { zhHans: '关闭文件夹', zhHant: '關閉資料夾', en: 'Close Folder' },
  'win.addFolder': { zhHans: '添加文件夹', zhHant: '新增資料夾', en: 'Add Folder' },
  'win.removeFolder': { zhHans: '从侧栏移除', zhHant: '從側欄移除', en: 'Remove from Sidebar' },
  'win.foldersTitle': { zhHans: '{n} 个文件夹', zhHant: '{n} 個資料夾', en: '{n} folders' },
  'win.ctxToggleTheme': { zhHans: '切换深色 / 浅色', zhHant: '切換深色 / 淺色', en: 'Toggle Dark / Light' },
  'win.ctxPrint': { zhHans: '打印…', zhHant: '列印…', en: 'Print…' },
  'win.autoSave': { zhHans: '自动保存', zhHant: '自動儲存', en: 'Auto save' },
  'win.autoSaveHint': {
    zhHans: '编辑停顿后自动写入本地文件',
    zhHant: '編輯停頓後自動寫入本機檔案',
    en: 'Write changes to disk automatically after you pause typing'
  },
  'win.outlineCollapseAll': { zhHans: '全部折叠', zhHant: '全部摺疊', en: 'Collapse all' },
  'win.outlineExpandAll': { zhHans: '全部展开', zhHant: '全部展開', en: 'Expand all' },
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
