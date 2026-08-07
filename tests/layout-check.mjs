// 宽屏(最大化)布局实测:正文与侧栏之间不应有大片空白
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const ROOT = resolve('.')
const UD = join(ROOT, 'tests', '.userdata')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
// 关键:模拟"老用户"配置(旧默认 820px),验证迁移是否把它改回自适应
writeFileSync(join(UD, 'settings.json'), JSON.stringify({ contentWidth: 820, theme: 'auto' }))
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TD],
    openFile: `${TD}/功能演示.md`,
    openTabs: [`${TD}/功能演示.md`],
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
// 最大化窗口
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
await new Promise((r) => setTimeout(r, 3000))

let ok = true
const check = (n, c, extra = '') => {
  ok = ok && c
  console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${extra ? ' — ' + extra : ''}`)
}

const m = await win.evaluate(() => {
  const sb = document.getElementById('sidebar').getBoundingClientRect()
  const content = document.getElementById('content').getBoundingClientRect()
  const viewer = document.getElementById('viewer').getBoundingClientRect()
  const h1 = document.querySelector('#viewer h1').getBoundingClientRect()
  const cs = getComputedStyle(document.getElementById('viewer'))
  return {
    win: window.innerWidth,
    sidebarRight: Math.round(sb.right),
    contentLeft: Math.round(content.left),
    contentWidth: Math.round(content.width),
    viewerLeft: Math.round(viewer.left),
    viewerWidth: Math.round(viewer.width),
    textLeft: Math.round(h1.left),
    maxWidth: cs.maxWidth,
    padLeft: cs.paddingLeft
  }
})
console.log('  metrics:', JSON.stringify(m))
// 侧栏右缘 → 正文文字左缘 的空白
const gap = m.textLeft - m.sidebarRight
check('正文自适应铺满内容区', m.viewerWidth >= m.contentWidth - 12, `viewer ${m.viewerWidth} / content ${m.contentWidth}(差值为滚动条)`)
check('迁移生效:max-width 不再是 820px', m.maxWidth !== '820px', `max-width=${m.maxWidth}`)
check('侧栏与正文间空白 < 100px', gap < 100, `gap=${gap}px`)
check('留白仍存在(不贴边)', gap > 15, `gap=${gap}px`)

await win.screenshot({ path: 'tests/shots/20-wide-layout.png' })
// 顺带看窄窗自适应
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.unmaximize()
  w.setSize(900, 700)
})
await new Promise((r) => setTimeout(r, 1200))
const narrow = await win.evaluate(() => {
  const v = document.getElementById('viewer').getBoundingClientRect()
  const c = document.getElementById('content').getBoundingClientRect()
  return { v: Math.round(v.width), c: Math.round(c.width), pad: getComputedStyle(document.getElementById('viewer')).paddingLeft }
})
console.log('  narrow:', JSON.stringify(narrow))
check('窄窗不溢出且内边距收紧', narrow.v <= narrow.c + 1 && parseFloat(narrow.pad) <= 32, JSON.stringify(narrow))
await win.screenshot({ path: 'tests/shots/21-narrow-layout.png' })

console.log(ok ? 'WIDE-LAYOUT: ALL OK' : 'WIDE-LAYOUT: FAIL')
await app.close()
process.exit(ok ? 0 : 1)
