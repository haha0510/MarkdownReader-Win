// 关闭文件夹返回欢迎页 验证
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
    openFile: TD + '/README.md',
    sidebarVisible: true,
    outlineVisible: true,
    zoom: 1,
    displayMode: 'rendered',
    expandedDirs: [],
    scrollPositions: {},
    sidebarWidth: 240,
    outlineWidth: 220,
    recentRoots: [TD]
  })
)
const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await new Promise((r) => setTimeout(r, 2500))
let ok = true
const check = (n, c) => {
  ok = ok && c
  console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}`)
}
check('header 3 buttons', (await win.locator('#sidebar-header button').count()) === 3)
await win.locator('#sidebar-header button').nth(2).click()
await new Promise((r) => setTimeout(r, 800))
check('welcome visible after close', await win.locator('#welcome').isVisible())
check('tree cleared', (await win.locator('#filetree .ft-row').count()) === 0)
check('welcome has open buttons', (await win.locator('#welcome button').count()) >= 2)
console.log(ok ? 'CLOSE-FOLDER: ALL OK' : 'CLOSE-FOLDER: FAIL')
await app.close()
process.exit(ok ? 0 : 1)
