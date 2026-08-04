// 双根目录专项验证
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
const TD2 = resolve(ROOT, 'design').replaceAll('\\', '/')
rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TD, TD2],
    openFile: TD + '/README.md',
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
check('两个根区块行', (await win.locator('#filetree .ft-root').count()) === 2)
check('第一根内容可见', (await win.locator('#filetree .ft-row', { hasText: 'README.md' }).count()) >= 1)
check('第二根内容可见', (await win.locator('#filetree .ft-row', { hasText: 'CONTRACTS.md' }).count()) >= 1)
// 打开第二根的文件
await win.locator('#filetree .ft-row', { hasText: 'CONTRACTS.md' }).first().click()
await new Promise((r) => setTimeout(r, 900))
check('跨根打开文件', ((await win.locator('#doc-title').textContent()) || '').includes('CONTRACTS'))
// 命令面板聚合两根
await win.keyboard.press('Control+p')
await new Promise((r) => setTimeout(r, 300))
await win.keyboard.type('derivation')
await new Promise((r) => setTimeout(r, 400))
check('面板搜到第二根文件', (await win.locator('#palette .pal-item').count()) >= 1)
await win.keyboard.press('Escape')
await win.screenshot({ path: 'tests/shots/12-multiroot.png' })
console.log(ok ? 'MULTIROOT: ALL OK' : 'MULTIROOT: FAIL')
await app.close()
process.exit(ok ? 0 : 1)
