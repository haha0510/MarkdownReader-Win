// v0.2 新功能验证:主题层次 / 大纲折叠 / 自动保存
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata')
const TESTDOCS = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDir: TESTDOCS,
    openFile: `${TESTDOCS}/功能演示.md`,
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
let pass = 0,
  fail = 0
const ok = (n, c, x = '') => {
  c ? pass++ : fail++
  console.log(`  ${c ? '✓' : '✗'} ${n} ${c ? '' : x}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await sleep(3000)

console.log('[主题层次]')
const gv = (v) => win.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), v)
const tb = await gv('--ui-titlebar-bg')
const sb = await gv('--ui-sidebar-bg')
const md = await gv('--md-bg')
ok('标题栏/侧栏/正文三色互异', tb !== sb && sb !== md && tb !== md, `${tb}|${sb}|${md}`)
const hd = await gv('--md-heading')
const fg = await gv('--md-fg')
ok('标题色 ≠ 正文色(主题色渗入)', hd !== '' && hd !== fg, `${hd} vs ${fg}`)
ok('表头着色变量存在', (await gv('--md-table-head-bg')) !== '')
await win.screenshot({ path: 'tests/shots/07-theme-light.png' })
// 切到深色看效果
await win.locator('#btn-theme').click() // auto -> light
await sleep(300)
await win.locator('#btn-theme').click() // light -> dark
await sleep(600)
await win.screenshot({ path: 'tests/shots/08-theme-dark.png' })
const tbD = await gv('--ui-titlebar-bg')
const sbD = await gv('--ui-sidebar-bg')
const mdD = await gv('--md-bg')
ok('深色下三区也互异', tbD !== sbD && sbD !== mdD, `${tbD}|${sbD}|${mdD}`)
await win.locator('#btn-theme').click() // dark -> auto
await sleep(400)

console.log('[大纲折叠]')
const total = await win.locator('#outline-list .ol-item').count()
ok('默认全部展开(条目数≥16)', total >= 16, `got ${total}`)
ok('有折叠箭头', (await win.locator('#outline-list .ol-twist').count()) > 0)
const twists = win.locator('#outline-list .ol-twist')
// 点击"长内容滚动测试"分支的箭头折叠
const collapseAllBtn = win.locator('#outline-header button').first()
await collapseAllBtn.click()
await sleep(400)
const visibleAfterCollapse = await win.locator('#outline-list .ol-item:visible').count()
ok('全部折叠后可见条目变少', visibleAfterCollapse < total, `${total} -> ${visibleAfterCollapse}`)
await win.screenshot({ path: 'tests/shots/09-outline-collapsed.png' })
const expandAllBtn = win.locator('#outline-header button').nth(1)
await expandAllBtn.click()
await sleep(400)
ok('全部展开恢复', (await win.locator('#outline-list .ol-item:visible').count()) === total)

console.log('[自动保存]')
const readmePath = `${TESTDOCS}/README.md`
const before = readFileSync(readmePath, 'utf8')
// 打开 README 并进入编辑模式
await win.keyboard.press('Control+p')
await sleep(300)
await win.keyboard.type('readme')
await sleep(300)
await win.keyboard.press('Enter')
await sleep(800)
await win.keyboard.press('Control+Shift+r')
await sleep(600)
await win.locator('#editor .cm-content').click()
await win.keyboard.press('Control+End')
await win.keyboard.type('\nAUTOSAVE-MARK')
// 不按 Ctrl+S,等自动保存(800ms 去抖 + 写盘)
await sleep(2200)
const after = readFileSync(readmePath, 'utf8')
ok('未按 Ctrl+S 内容已写盘', after.includes('AUTOSAVE-MARK'))
ok('自动保存后脏标记消失', !(await win.locator('#doc-dirty').isVisible()))
writeFileSync(readmePath, before)
await sleep(500)

console.log(`\n═══ ${pass} 通过, ${fail} 失败 ═══`)
await app.close()
process.exit(fail ? 1 : 0)
