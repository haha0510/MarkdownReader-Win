// README 宣传截图:统一 1440x900,演示文档 + mock AI,输出到 docs/screenshots/
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata-shoot')
const OUT = join(ROOT, 'docs', 'screenshots')
const DEMO = join(ROOT, 'tests', '我的笔记')
const TD = DEMO.replaceAll('\\', '/')
const GUIDE = `${TD}/Markdown Reader 使用指南.md`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 演示目录(从 tests/demo-docs 拷入临时目录,截图后清理)
rmSync(DEMO, { recursive: true, force: true })
cpSync(join(ROOT, 'tests', 'demo-docs'), DEMO, { recursive: true })
mkdirSync(OUT, { recursive: true })

// mock OpenAI 兼容服务:按问题返回像样的中文回答(流式)
const TRANSLATION = `# Markdown Reader User Guide

> Not yet another all-in-one editor — just a **quiet reader**. Open a folder and read in peace.

## Why choose it

- **Instant** — a native Windows app: fast to launch, fast to switch, smooth to scroll
- **Focused** — three-pane layout: file tree + rendered body + outline, see the structure at a glance
- **Unobtrusive** — no sign-up, no cloud sync, no ads; open and read
- **Edit when needed** — switch to edit mode with one click, auto-saves when you pause

## Full Markdown support

| Feature | Status | Notes |
|------|:----:|------|
| GFM tables / task lists | ✅ | alignment, strikethrough, footnotes, autolinks |
| Code highlighting | ✅ | 40+ languages, colors follow the theme |
| Math | ✅ | KaTeX inline and block |
| Mermaid diagrams | ✅ | rendered locally, adapts to dark/light |
| Local images | ✅ | relative paths just work |
`
const ANSWERS = [
  [
    '摘要',
    '这篇文档介绍了 Markdown Reader —— 一款面向 Windows 的轻量阅读器。核心主张是"安静阅读":三栏布局、秒开、不打扰;同时完整支持 GFM、代码高亮、KaTeX 公式与 Mermaid 图表,并提供编辑模式、多标签、全文搜索与 AI 助手。适合只想快速读完 .md 文件、偶尔顺手改两笔的用户。'
  ],
  [
    '窗户',
    '这句话用"干净的窗户"比喻理想的工具:好工具应当让使用者把注意力完全放在内容上,而不是被工具本身的界面、弹窗或复杂设置分散精力。对应到阅读器的设计,就是克制的 UI、无广告无登录、以及默认即合理的排版——这正是本文档反复强调的"安静"。'
  ],
  ['', '这段文字的意思是:工具应当退到幕后,让内容成为主角。阅读器通过简洁的三栏布局和自动保存等"无感"设计来实现这一点。']
]
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      /* ignore */
    }
    if (payload.stream === false) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }))
    }
    const text = JSON.stringify(payload.messages || [])
    const full = text.includes('翻译为') ? TRANSLATION : (ANSWERS.find(([k]) => k && text.includes(k)) || ANSWERS[2])[1]
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const chunks = full.match(/.{1,8}/gs) || [full]
    let i = 0
    const tick = () => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`)
        setTimeout(tick, 12)
      } else {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }
    tick()
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'settings.json'),
  JSON.stringify({ aiBaseUrl: BASE, aiApiKey: 'demo', aiModel: 'demo-chat', theme: 'buddy-light' })
)
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TD],
    openFile: GUIDE,
    openTabs: [GUIDE, `${TD}/功能演示.md`],
    expandedDirs: [`${TD}/项目笔记`],
    sidebarVisible: true,
    outlineVisible: true,
    zoom: 1,
    displayMode: 'rendered',
    scrollPositions: {},
    sidebarWidth: 240,
    outlineWidth: 220,
    recentRoots: [TD],
    windowBounds: { x: 100, y: 60, width: 1440, height: 900, maximized: false }
  })
)

const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await sleep(3500)
const shot = async (name) => {
  await win.screenshot({ path: join(OUT, name) })
  console.log('  shot:', name)
}
const setTheme = async (id) => {
  await win.keyboard.press('Control+,')
  await sleep(400)
  await win.locator('#settings-modal select').first().selectOption(id)
  await sleep(500)
  await win.keyboard.press('Escape')
  await sleep(600)
}

// 1 主界面(浅色)
await shot('01-overview-light.png')

// 2 深色主题
await setTheme('buddy-dark')
await sleep(1200)
await shot('02-overview-dark.png')

// 3/4 其他主题:Catppuccin / Nord
await setTheme('catppuccin-mocha')
await sleep(900)
await shot('03-theme-catppuccin.png')
await setTheme('nord')
await sleep(900)
await shot('04-theme-nord.png')
await setTheme('buddy-light')

// 5 编辑模式(定位到"代码与公式"章节)
await win.locator('#outline-list .ol-item', { hasText: '代码与公式' }).first().click()
await sleep(800)
await win.keyboard.press('Control+Shift+r')
await sleep(900)
await shot('05-edit-mode.png')
await win.keyboard.press('Control+Shift+e')
await sleep(700)

// 6 全文搜索
await win.keyboard.press('Control+Shift+f')
await sleep(400)
await win.keyboard.type('自动保存')
await sleep(1300)
await shot('06-fulltext-search.png')
await win.keyboard.press('Escape')
await sleep(300)

// 7 命令面板
await win.keyboard.press('Control+p')
await sleep(400)
await win.keyboard.type('笔记')
await sleep(500)
await shot('07-command-palette.png')
await win.keyboard.press('Escape')
await sleep(300)

// 8 AI:选中引用句 → 提问 → 回答(先滚到该段)
await win.locator('#outline-list .ol-item', { hasText: '引用' }).first().click()
await sleep(900)
await win.evaluate(() => {
  const viewer = document.getElementById('viewer')
  const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const i = node.data.indexOf('好的工具应该像一扇干净的窗户')
    if (i === -1) continue
    const r = document.createRange()
    r.setStart(node, i)
    r.setEnd(node, node.data.length)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(r)
    viewer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return
  }
})
await sleep(400)
await win.locator('#ai-fab').click()
await sleep(400)
await win.locator('.ai-input').fill('这句话想表达什么?和阅读器的设计有什么关系?')
await win.locator('.ai-send').click()
await sleep(2800)
await shot('08-ai-ask-selection.png')

// 9 AI 全文摘要
await win.locator('.ai-hbtn', { hasText: '摘要' }).first().click()
await sleep(3200)
// (摘要效果已含于 08 图,不单独出图)

// 10 翻译对照(左原文右译文;先关 AI 面板让双栏完整呈现)
await win.locator('.ai-hbtn', { hasText: '翻译对照' }).first().click()
await sleep(600)
await win.locator('.ai-close').click()
await sleep(3200)
await win.evaluate(() => { document.getElementById('viewer-scroll').scrollTop = 0; const t = document.getElementById('translate-scroll'); if (t) t.scrollTop = 0 })
await sleep(500)
await shot('10-ai-translate.png')
await win.locator('#translate-scroll .tr-btn').last().click().catch(() => {})
await sleep(400)

// 11 代码文件查看
await win.locator('#filetree .ft-row', { hasText: 'hello.c' }).first().click()
await sleep(900)
await shot('11-code-file.png')

await app.close()
server.close()
rmSync(DEMO, { recursive: true, force: true })
console.log('DONE ->', OUT)
