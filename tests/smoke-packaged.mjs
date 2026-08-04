// 打包版冒烟测试:asar 资源路径 / 会话恢复 / 渲染管线
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata-packaged')
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
  executablePath: join(ROOT, 'dist', 'win-unpacked', 'Markdown Reader.exe'),
  args: [],
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await new Promise((r) => setTimeout(r, 4000))
const checks = {
  h1: await win.locator('#viewer h1').first().textContent().catch(() => null),
  hljs: await win.locator('#viewer .hljs-keyword').count(),
  katex: await win.locator('#viewer .katex').count(),
  mermaid: await win.locator('#viewer .mermaid-block svg').count(),
  image: await win
    .locator('#viewer img[src^="mdr:"]')
    .first()
    .evaluate((el) => el.naturalWidth > 0)
    .catch(() => false),
  tree: await win.locator('#filetree .ft-row').count(),
  outline: await win.locator('#outline-list .ol-item').count()
}
await win.screenshot({ path: 'tests/shots/06-packaged.png' })
console.log('PACKAGED CHECKS:', JSON.stringify(checks))
const okAll =
  checks.h1?.includes('功能演示') &&
  checks.hljs > 0 &&
  checks.katex >= 2 &&
  checks.mermaid >= 2 &&
  checks.image &&
  checks.tree >= 3 &&
  checks.outline >= 10
console.log(okAll ? 'PACKAGED SMOKE: ALL OK' : 'PACKAGED SMOKE: FAILURES')
await app.close()
process.exit(okAll ? 0 : 1)
