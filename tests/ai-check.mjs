// AI 功能验证 — 用本地 mock 服务器模拟 OpenAI 兼容流式接口(不依赖真实 key)。
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')

// ── mock OpenAI 兼容服务器 ──
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
    const isTranslate = JSON.stringify(payload.messages || []).includes('翻译为')
    if (payload.stream === false) {
      // 连接测试
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }))
      return
    }
    // SSE 流式:分多段推送
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const full = isTranslate ? '# 已翻译\n\nTRANSLATE-OK 这是译文内容。' : 'ANSWER-OK **答案**内容。'
    const chunks = full.match(/.{1,6}/gs) || [full]
    let i = 0
    const tick = () => {
      if (i < chunks.length) {
        const evt = { choices: [{ delta: { content: chunks[i] } }] }
        res.write(`data: ${JSON.stringify(evt)}\n\n`)
        i++
        setTimeout(tick, 30)
      } else {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }
    tick()
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const BASE = `http://127.0.0.1:${port}`

rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TD],
    openFile: TD + '/功能演示.md',
    openTabs: [TD + '/功能演示.md'],
    sidebarVisible: true,
    outlineVisible: true,
    zoom: 1,
    displayMode: 'rendered',
    expandedDirs: [],
    scrollPositions: {},
    sidebarWidth: 240,
    outlineWidth: 220,
    recentRoots: []
  })
)
writeFileSync(
  join(UD, 'settings.json'),
  JSON.stringify({ aiBaseUrl: BASE, aiApiKey: 'test-key', aiModel: 'mock-model', aiTargetLang: 'English' })
)

const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(3000)
let ok = true
const check = (n, c, x = '') => {
  ok = ok && c
  console.log(`  ${c ? 'PASS' : 'FAIL'} ${n} ${c ? '' : x}`)
}

// 1) 打开 AI 面板
await win.locator('#btn-ai').click()
await sleep(400)
check('AI 面板打开', await win.locator('#ai-panel').isVisible())

// 2) 选中即问:提问并流式接收
await win.locator('.ai-input').click()
await win.keyboard.type('这篇文档讲了什么?')
await win.locator('.ai-send').click()
await sleep(1500)
const answer = (await win.locator('.ai-msg.ai-assistant').last().textContent()) || ''
check('提问流式返回答案', answer.includes('ANSWER-OK'), `got: ${answer.slice(0, 40)}`)

// 3) 全文摘要
await win.locator('.ai-hbtn', { hasText: '全文摘要' }).click()
await sleep(1500)
const summary = (await win.locator('.ai-msg.ai-assistant').last().textContent()) || ''
check('全文摘要返回内容', summary.includes('ANSWER-OK'))
await win.screenshot({ path: 'tests/shots/14-ai-panel.png' })

// 4) 翻译对照
await win.locator('.ai-hbtn', { hasText: '翻译对照' }).click()
await sleep(1800)
check('翻译分栏出现', await win.locator('#translate-scroll').isVisible())
const trans = (await win.locator('#translate-body').textContent()) || ''
check('译文流式渲染', trans.includes('TRANSLATE-OK'), `got: ${trans.slice(0, 40)}`)
check('译文按 Markdown 渲染(有标题)', (await win.locator('#translate-body h1').count()) >= 1)
await win.screenshot({ path: 'tests/shots/15-ai-translate.png' })

console.log(ok ? 'AI: ALL OK' : 'AI: FAIL')
await app.close()
server.close()
process.exit(ok ? 0 : 1)
