// 目录树内拖拽移动 验证:README.md 拖入 子目录,再拖回根
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
    openFile: null,
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
// 起始状态守卫:README.md 必须在根,不在子目录
if (!existsSync(join(ROOT, 'testdocs', 'README.md'))) {
  console.error('precondition failed: testdocs/README.md missing')
  process.exit(1)
}
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// dragTo 对 Electron 的 HTML5 DnD 不稳定 → 直接在页面内派发 dragstart/dragover/drop
async function dragRow(srcPath, destPath) {
  await win.evaluate(
    ([src, dest]) => {
      const rowOf = (p) =>
        [...document.querySelectorAll('#filetree .ft-row')].find((r) => r.dataset.path === p)
      const srcRow = rowOf(src)
      const destRow = rowOf(dest)
      if (!srcRow || !destRow) throw new Error('row not found: ' + (srcRow ? dest : src))
      const dt = new DataTransfer()
      const fire = (el, type) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
      fire(srcRow, 'dragstart')
      fire(destRow, 'dragover')
      fire(destRow, 'drop')
      fire(srcRow, 'dragend')
    },
    [srcPath, destPath]
  )
}

const SRC = TD + '/README.md'
const SUB = TD + '/子目录'

// 1) 根下 README.md → 子目录
await dragRow(SRC, SUB)
await sleep(1500)
check('moved into 子目录', existsSync(join(ROOT, 'testdocs', '子目录', 'README.md')))
check('gone from root', !existsSync(join(ROOT, 'testdocs', 'README.md')))

// 2) 拖回根区块行(.ft-root)
await dragRow(SUB + '/README.md', TD)
await sleep(1500)
check('moved back to root', existsSync(join(ROOT, 'testdocs', 'README.md')))
check('gone from 子目录', !existsSync(join(ROOT, 'testdocs', '子目录', 'README.md')))

console.log(ok ? 'DND: ALL OK' : 'DND: FAIL')
await app.close()
process.exit(ok ? 0 : 1)
