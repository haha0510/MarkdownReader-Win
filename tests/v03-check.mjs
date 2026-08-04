// v0.3 专项:标签页 / 全文搜索 / 图片灯箱
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
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
const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await new Promise((r) => setTimeout(r, 3000))
let ok = true
const check = (n, c) => {
  ok = ok && c
  console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}`)
}
// 标签页
check('标签栏显示且有1个标签', (await win.locator('#tabbar .tab').count()) === 1)
await win.locator('#filetree .ft-row', { hasText: 'README.md' }).first().click()
await new Promise((r) => setTimeout(r, 900))
check('打开第二个文件出现第二个标签', (await win.locator('#tabbar .tab').count()) === 2)
await win.locator('#tabbar .tab').first().click()
await new Promise((r) => setTimeout(r, 900))
check('点击标签切换文档', ((await win.locator('#doc-title').textContent()) || '').includes('功能演示'))
await win.keyboard.press('Control+w')
await new Promise((r) => setTimeout(r, 800))
check('Ctrl+W 关闭标签', (await win.locator('#tabbar .tab').count()) === 1)
// 全文搜索
await win.keyboard.press('Control+Shift+f')
await new Promise((r) => setTimeout(r, 400))
check('搜索浮层打开', await win.locator('#search-panel').isVisible())
await win.keyboard.type('斐波那契')
await new Promise((r) => setTimeout(r, 1200))
check('搜到内容命中', (await win.locator('#search-panel .sr-item').count()) >= 1)
await win.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 1500))
check('回车跳转到文件', ((await win.locator('#doc-title').textContent()) || '').includes('功能演示'))
// 图片灯箱
await win.locator('#viewer img[src^="mdr:"]').first().click()
await new Promise((r) => setTimeout(r, 500))
check('点击图片打开灯箱', await win.locator('#lightbox').isVisible())
await win.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 400))
check('Esc 关闭灯箱', !(await win.locator('#lightbox').isVisible()))
await win.screenshot({ path: 'tests/shots/13-v03.png' })
console.log(ok ? 'V03: ALL OK' : 'V03: FAIL')
await app.close()
process.exit(ok ? 0 : 1)
