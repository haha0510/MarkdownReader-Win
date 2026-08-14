// 对话历史 + 选中即问批注标签 验证 — 本地 mock OpenAI 兼容流式接口。
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata-ainotes')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')

// ── mock OpenAI 兼容服务器(SSE 流式,固定含 MOCK-AI-ANSWER)──
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
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }))
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const full = 'MOCK-AI-ANSWER 这是回答内容。'
    const chunks = full.match(/.{1,6}/gs) || [full]
    let i = 0
    const tick = () => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`)
        i++
        setTimeout(tick, 20)
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
  JSON.stringify({ aiBaseUrl: BASE, aiApiKey: 'test-key', aiModel: 'mock' })
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

// 1) 在 #viewer 内选中「测试文档」,派发 mouseup 触发选中即问浮动按钮
const selected = await win.evaluate(() => {
  const viewer = document.getElementById('viewer')
  const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const idx = node.data.indexOf('测试文档')
    if (idx === -1) continue
    const range = document.createRange()
    range.setStart(node, idx)
    range.setEnd(node, idx + 4)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    viewer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  }
  return false
})
check('构造选区「测试文档」', selected)
await sleep(300)
check('浮动按钮出现', await win.locator('#ai-fab').isVisible())

// 2) 点击浮动按钮 → 面板打开;输入问题发送 → 流式答案
await win.locator('#ai-fab').click()
await sleep(300)
check('AI 面板打开', await win.locator('#ai-panel').isVisible())
await win.locator('.ai-input').fill('这个词是什么意思?')
await win.locator('.ai-send').click()
await sleep(1500)
const answer = (await win.locator('.ai-msg.ai-assistant').last().textContent()) || ''
check('流式答案含 MOCK-AI-ANSWER', answer.includes('MOCK-AI-ANSWER'), `got: ${answer.slice(0, 40)}`)

// 3) 等去抖写盘 → 历史与批注文件落盘
await sleep(1200)
const histFile = join(UD, 'data-ai-history.json')
const notesFile = join(UD, 'data-ai-notes.json')
check('data-ai-history.json 存在', existsSync(histFile))
check('历史含该问答', existsSync(histFile) && readFileSync(histFile, 'utf8').includes('MOCK-AI-ANSWER'))
check('data-ai-notes.json 含 quote', existsSync(notesFile) && readFileSync(notesFile, 'utf8').includes('测试文档'))

// 4) 正文出现批注标签
check('#viewer 出现 .ai-note-tag', (await win.locator('#viewer .ai-note-tag').count()) >= 1)

// 5) 切走再切回 → 标签仍在(rendered 后全量重打)
await win.locator(`.ft-row[data-path="${TD}/README.md"]`).click()
await sleep(1200)
await win.locator(`.ft-row[data-path="${TD}/功能演示.md"]`).click()
await sleep(1500)
check('切回后标签仍在', (await win.locator('#viewer .ai-note-tag').count()) >= 1)

// 6) 新对话清空后点标签 → 载入历史问答
await win.locator('.ai-hbtn.ai-icon').nth(1).click() // 新对话(+)
await sleep(200)
check('新对话已清空', (await win.locator('.ai-msg').count()) === 0)
await win.locator('#viewer .ai-note-tag').first().click()
await sleep(500)
const loaded = (await win.locator('.ai-messages').textContent()) || ''
check('点标签载入历史问答', loaded.includes('MOCK-AI-ANSWER'), `got: ${loaded.slice(0, 60)}`)

// 7) 历史按钮 → 列表 ≥ 1 条
await win.locator('.ai-hbtn.ai-icon').nth(0).click() // 历史(时钟)
await sleep(300)
check('历史列表 ≥ 1 条', (await win.locator('.ai-hist-row').count()) >= 1)
await win.screenshot({ path: 'tests/shots/16-ai-notes.png' })

console.log(ok ? 'AINOTES: ALL OK' : 'AINOTES: FAIL')
await app.close()
server.close()
process.exit(ok ? 0 : 1)
