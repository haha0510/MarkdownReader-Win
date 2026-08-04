// 分段模式切换控件验证
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata')
const TESTDOCS = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TESTDOCS],
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
  console.log(`  ${c ? '✓' : '✗'} ${n}`)
}
check('分段控件两个选项', (await win.locator('#btn-mode .seg').count()) === 2)
check('渲染段带文字标签', ((await win.locator('#btn-mode .seg').first().textContent()) || '').includes('渲染'))
check('编辑段带文字标签', ((await win.locator('#btn-mode .seg').nth(1).textContent()) || '').includes('编辑'))
check('默认渲染段高亮', await win.locator('#btn-mode .seg').first().evaluate((el) => el.classList.contains('active')))
// 点「编辑」→ 编辑器出现并输入
await win.locator('#btn-mode .seg').nth(1).click()
await new Promise((r) => setTimeout(r, 700))
check('点击编辑段进入编辑器', await win.locator('#editor .cm-editor').isVisible())
await win.keyboard.type('x')
await new Promise((r) => setTimeout(r, 200))
check('无需点击直接可输入(自动聚焦)', await win.locator('#doc-dirty').isVisible())
await win.keyboard.press('Control+z')
// 撤销也算编辑,dirty 会挡住关闭确认对话框 → 关闭前确保已保存
await win.keyboard.press('Control+s')
await new Promise((r) => setTimeout(r, 800))
await win.screenshot({ path: 'tests/shots/10-mode-seg-edit.png' })
await win.locator('#btn-mode .seg').first().click()
await new Promise((r) => setTimeout(r, 500))
check('点击渲染段返回', await win.locator('#viewer-scroll').isVisible())
await win.screenshot({ path: 'tests/shots/11-mode-seg.png' })
console.log(ok ? 'MODE-SEG: ALL OK' : 'MODE-SEG: FAIL')
await app.close()
process.exit(ok ? 0 : 1)
