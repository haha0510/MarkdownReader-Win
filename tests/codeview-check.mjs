// 代码/文本文件查看与编辑 验证(需先 npm run build)
// 覆盖:树显示与代码图标、hljs 代码视图、大纲空态、编辑保存、全文搜索、命令面板、
// 设置「显示代码/文本文件」开关。测试文件写入 testdocs,结束时删除。
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const UD = join(ROOT, 'tests', '.userdata-codeview')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
const PY = `${TD}/demo.py`
const C = `${TD}/demo.c`

// ── 测试用代码文件(含中文注释)──
writeFileSync(
  PY,
  '# 演示:中文注释 codeview\ndef main():\n    print("hello codeview")\n\n\nif __name__ == "__main__":\n    main()\n',
  'utf8'
)
writeFileSync(
  C,
  '/* 演示:中文注释 */\n#include <stdio.h>\n\nint main(void) {\n    printf("hello codeview\\n");\n    return 0;\n}\n',
  'utf8'
)

rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TD],
    openFile: null,
    openTabs: [],
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

let pass = 0
let fail = 0
const check = (n, c, extra = '') => {
  c ? pass++ : fail++
  console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ` — ${extra}`}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  args: [ROOT],
  executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  env: { ...process.env, MDR_USER_DATA: UD }
})
const win = await app.firstWindow()
const pageErrors = []
win.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)))
win.on('console', (m) => {
  if (m.type() === 'error') console.log('  [renderer error]', m.text().slice(0, 200))
})
await win.waitForLoadState('domcontentloaded')
await sleep(2500)

try {
  // 1. 树中出现 demo.py / demo.c 且带代码图标类;md 文件仍为文档图标
  check('1 树中出现 demo.py', (await win.locator(`.ft-row[data-path="${PY}"]`).count()) === 1)
  check('1 树中出现 demo.c', (await win.locator(`.ft-row[data-path="${C}"]`).count()) === 1)
  check('1 demo.py 带代码图标类', (await win.locator(`.ft-row[data-path="${PY}"] .ft-icon.code`).count()) === 1)
  check('1 demo.c 带代码图标类', (await win.locator(`.ft-row[data-path="${C}"] .ft-icon.code`).count()) === 1)
  check(
    '1 README.md 保持文档图标(无 code 类)',
    (await win.locator(`.ft-row[data-path="${TD}/README.md"] .ft-icon:not(.code)`).count()) === 1
  )

  // 2. 点击 demo.py → 代码视图:pre.code-file + hljs 关键字高亮(def)
  await win.locator(`.ft-row[data-path="${PY}"]`).click()
  await sleep(1000)
  check('2 渲染视图出现 pre.code-file', (await win.locator('#viewer pre.code-file').count()) === 1)
  check(
    '2 python 语言映射(code.language-python)',
    (await win.locator('#viewer pre.code-file code.language-python').count()) === 1
  )
  check('2 def 关键字高亮(.hljs-keyword)', (await win.locator('#viewer pre.code-file .hljs-keyword').count()) >= 1)

  // 3. 大纲为空态且无渲染器异常
  check('3 大纲空态显示', (await win.locator('#outline-list .panel-empty').count()) === 1)
  check('3 无页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // 4. 编辑模式:CM 出现、可输入(dirty)、Ctrl+S 写盘
  await win.keyboard.press('Control+Shift+r')
  await sleep(800)
  check('4 编辑器显示', await win.locator('#editor .cm-editor').isVisible())
  await win.locator('#editor .cm-content').click()
  await win.keyboard.press('Control+End')
  await win.keyboard.type('\n# CODEVIEW-EDIT-MARK')
  await sleep(250)
  check('4 输入后出现脏标记', await win.locator('#doc-dirty').isVisible())
  await win.keyboard.press('Control+s')
  await sleep(900)
  check('4 Ctrl+S 写入磁盘', readFileSync(PY, 'utf8').includes('CODEVIEW-EDIT-MARK'))
  await win.keyboard.press('Control+Shift+e')
  await sleep(600)
  check('4 切回渲染模式仍为代码视图', (await win.locator('#viewer pre.code-file').count()) === 1)

  // 5. 全文搜索命中 demo.c
  await win.keyboard.press('Control+Shift+f')
  await sleep(400)
  await win.keyboard.type('stdio')
  await sleep(1200)
  const srFiles = await win.locator('#search-panel .sr-file').allTextContents()
  check('5 全文搜索 stdio 命中 demo.c', srFiles.some((s) => s.includes('demo.c')), srFiles.join(','))
  await win.keyboard.press('Escape')
  await sleep(300)

  // 6. 命令面板搜到 demo.py
  await win.keyboard.press('Control+p')
  await sleep(400)
  await win.keyboard.type('demo')
  await sleep(400)
  const palItems = await win.locator('#palette .pal-item').allTextContents()
  check('6 Ctrl+P 搜到 demo.py', palItems.some((s) => s.includes('demo.py')), palItems.join(','))
  await win.keyboard.press('Escape')
  await sleep(300)

  // 7. 设置关闭「显示代码/文本文件」→ 树中消失;重开 → 恢复
  await win.locator('#btn-settings').click()
  await sleep(400)
  check('7 设置项存在', (await win.locator('#st-show-code').count()) === 1)
  await win.locator('#st-show-code').click() // 关闭
  await sleep(900)
  check('7 关闭后 demo.py 消失', (await win.locator(`.ft-row[data-path="${PY}"]`).count()) === 0)
  check('7 关闭后 README.md 仍在', (await win.locator(`.ft-row[data-path="${TD}/README.md"]`).count()) === 1)
  await win.locator('#st-show-code').click() // 重开
  await sleep(900)
  check('7 重开后 demo.py 恢复', (await win.locator(`.ft-row[data-path="${PY}"]`).count()) === 1)
  await win.keyboard.press('Escape')
} catch (e) {
  fail++
  console.log('  EXCEPTION:', e.message)
} finally {
  // 清理测试文件(异常也执行)
  rmSync(PY, { force: true })
  rmSync(C, { force: true })
}

console.log(`\nCODEVIEW: ${pass} PASS, ${fail} FAIL ${fail ? '' : '— ALL OK'}`)
await app.close()
process.exit(fail ? 1 : 0)
