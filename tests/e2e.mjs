// 端到端验证:Playwright 驱动打包前的 Electron 应用(需先 npm run build)
// 用法: node tests/e2e.mjs [--keep]  (--keep 保留窗口不退出,便于人工查看)
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const USER_DATA = join(ROOT, 'tests', '.userdata')
const SHOTS = join(ROOT, 'tests', 'shots')
const TESTDOCS = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
const DEMO = `${TESTDOCS}/功能演示.md`

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ✗ ${name} ${extra}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 准备:干净的 userData + 预置会话(跳过原生"打开目录"对话框) ──
rmSync(USER_DATA, { recursive: true, force: true })
mkdirSync(USER_DATA, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
writeFileSync(
  join(USER_DATA, 'session.json'),
  JSON.stringify({
    rootDirs: [TESTDOCS],
    openFile: DEMO,
    expandedDirs: [],
    scrollPositions: {},
    zoom: 1,
    displayMode: 'rendered',
    sidebarVisible: true,
    outlineVisible: true,
    sidebarWidth: 240,
    outlineWidth: 220,
    recentRoots: [TESTDOCS]
  })
)

console.log('启动 Electron …')
const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: USER_DATA, NODE_ENV: 'production' }
})
const win = await app.firstWindow()
win.on('console', (m) => {
  if (m.type() === 'error') console.log('  [renderer error]', m.text().slice(0, 300))
})
await win.waitForLoadState('domcontentloaded')
await sleep(2500) // 等初始渲染 + mermaid

try {
  console.log('\n[1] 启动与会话恢复')
  ok('窗口标题', (await win.title()).length > 0)
  ok('标题栏存在', await win.locator('#titlebar').isVisible())
  ok('文档标题显示', (await win.locator('#doc-title').textContent())?.includes('功能演示'))

  console.log('\n[2] Markdown 渲染')
  const viewer = win.locator('#viewer')
  ok('H1 渲染', (await viewer.locator('h1').first().textContent())?.includes('功能演示'))
  ok('表格渲染', (await viewer.locator('table').count()) >= 1)
  ok('任务列表复选框', (await viewer.locator('input[type=checkbox]').count()) >= 3)
  ok('代码高亮块', (await viewer.locator('pre code .hljs-keyword, pre code .hljs-string').count()) > 0, '需要 hljs token')
  ok('KaTeX 公式', (await viewer.locator('.katex').count()) >= 2)
  ok('脚注', (await viewer.locator('.footnotes, section.footnotes').count()) >= 1)
  await sleep(2000)
  ok('Mermaid SVG', (await viewer.locator('.mermaid-block svg').count()) >= 2, '两个图表都要渲染')
  const imgOk = await viewer.locator('img[src^="mdr:"]').first().evaluate((el) => el.naturalWidth > 0).catch(() => false)
  ok('本地图片 mdr:// 加载', imgOk)
  await win.screenshot({ path: join(SHOTS, '01-rendered.png') })

  console.log('\n[3] 大纲导航')
  const olCount = await win.locator('#outline-list .ol-item').count()
  ok('大纲条目提取', olCount >= 10, `got ${olCount}`)
  await win.locator('#outline-list .ol-item', { hasText: '小节 C' }).first().click()
  await sleep(900)
  const activeId = await win.evaluate(() => document.querySelector('#outline-list .ol-item.active')?.textContent)
  ok('点击跳转 + 滚动联动', !!activeId, `active=${activeId}`)

  console.log('\n[4] 文件树')
  ok('树节点渲染', (await win.locator('#filetree .ft-row').count()) >= 3)
  await win.locator('#filetree .ft-row[data-dir="true"]', { hasText: '子目录' }).first().click()
  await sleep(400)
  const nested = win.locator('#filetree .ft-row', { hasText: '嵌套文档' })
  ok('目录展开', (await nested.count()) === 1)
  await nested.first().click()
  await sleep(800)
  ok('点击打开文件', (await win.locator('#doc-title').textContent())?.includes('嵌套文档'))
  await win.screenshot({ path: join(SHOTS, '02-tree.png') })

  console.log('\n[5] 命令面板')
  await win.keyboard.press('Control+p')
  await sleep(400)
  ok('面板打开', await win.locator('#palette').isVisible())
  await win.keyboard.type('readme')
  await sleep(400)
  ok('模糊搜索结果', (await win.locator('#palette .pal-item').count()) >= 1)
  await win.screenshot({ path: join(SHOTS, '03-palette.png') })
  await win.keyboard.press('Enter')
  await sleep(800)
  ok('回车打开文件', (await win.locator('#doc-title').textContent())?.includes('README'))

  console.log('\n[6] 原文模式与编辑保存')
  await win.keyboard.press('Control+Shift+r')
  await sleep(600)
  ok('编辑器显示', await win.locator('#editor .cm-editor').isVisible())
  const readmePath = `${TESTDOCS}/README.md`
  const before = readFileSync(readmePath, 'utf8')
  await win.locator('#editor .cm-content').click()
  await win.keyboard.press('Control+End')
  await win.keyboard.type('\nE2E-EDIT-MARK')
  await sleep(300)
  ok('脏标记显示', await win.locator('#doc-dirty').isVisible())
  await win.keyboard.press('Control+s')
  await sleep(800)
  const after = readFileSync(readmePath, 'utf8')
  ok('Ctrl+S 写入磁盘', after.includes('E2E-EDIT-MARK'))
  ok('保存后脏标记消失', !(await win.locator('#doc-dirty').isVisible()))
  writeFileSync(readmePath, before)
  await sleep(600)
  await win.keyboard.press('Control+Shift+e')
  await sleep(500)
  ok('切回渲染模式', await win.locator('#viewer-scroll').isVisible())

  console.log('\n[7] 查找')
  await win.keyboard.press('Control+f')
  await sleep(400)
  ok('查找栏显示', await win.locator('#findbar').isVisible())
  await win.keyboard.type('content')
  await sleep(800)
  // 注意:CDP(Playwright)附加时 Electron 38 的 found-in-page 事件不触发,
  // 真实运行已用独立脚本验证(见 tests/standalone-find.md)。这里注入合成事件
  // 验证 主进程→渲染器→计数显示 的接线。
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('ev:find:result', { activeMatchOrdinal: 1, matches: 2 })
  })
  await sleep(400)
  const countText = await win.locator('#findbar').textContent()
  ok('匹配计数显示接线', /1\s*\/\s*2/.test(countText || ''), `text=${countText?.slice(0, 40)}`)
  await win.keyboard.press('Escape')
  await sleep(300)

  console.log('\n[8] 缩放')
  const fs1 = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-font-size'))
  await win.keyboard.press('Control+=')
  await sleep(400)
  const fs2 = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-font-size'))
  ok('Ctrl+= 放大', parseFloat(fs2) > parseFloat(fs1), `${fs1} -> ${fs2}`)
  await win.keyboard.press('Control+0')

  console.log('\n[9] 主题切换')
  const bg1 = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-bg').trim())
  await win.locator('#btn-theme').click()
  await sleep(500)
  const bg2 = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-bg').trim())
  await win.locator('#btn-theme').click()
  await sleep(500)
  const bg3 = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-bg').trim())
  ok('主题循环切换生效', bg1 !== bg2 || bg2 !== bg3, `${bg1} / ${bg2} / ${bg3}`)
  await win.screenshot({ path: join(SHOTS, '04-theme.png') })

  console.log('\n[10] 设置面板')
  await win.locator('#btn-settings').click()
  await sleep(400)
  ok('设置打开', await win.locator('#settings-modal').isVisible())
  const themeOptions = await win.locator('#settings-modal select').first().locator('option').count()
  ok('主题列表完整(33+auto)', themeOptions >= 34, `got ${themeOptions}`)
  await win.screenshot({ path: join(SHOTS, '05-settings.png') })
  await win.keyboard.press('Escape')

  console.log('\n[11] 侧栏开关')
  await win.keyboard.press('Control+\\')
  await sleep(400)
  const sbHidden = await win.locator('#sidebar').isHidden()
  ok('Ctrl+\\ 隐藏侧栏', sbHidden)
  await win.keyboard.press('Control+\\')
  await sleep(300)
} catch (e) {
  fail++
  failures.push('异常中断: ' + e.message)
  console.log('EXCEPTION:', e)
  await win.screenshot({ path: join(SHOTS, 'error.png') }).catch(() => {})
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
if (failures.length) console.log(failures.map((f) => '  ✗ ' + f).join('\n'))

if (!process.argv.includes('--keep')) await app.close()
process.exit(fail ? 1 : 0)
