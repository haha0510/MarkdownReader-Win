// 渲染 ↔ 编辑 双向位置同步 + 大纲全模式可用 验证(需先 npm run build)
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const UD = join(ROOT, 'tests', '.userdata')
const TD = resolve(ROOT, 'testdocs').replaceAll('\\', '/')
const DEMO = `${TD}/功能演示.md`
const demoOriginal = readFileSync(DEMO, 'utf8') // 留底,结束前恢复原内容

rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeFileSync(
  join(UD, 'session.json'),
  JSON.stringify({
    rootDirs: [TD],
    openFile: DEMO,
    openTabs: [DEMO],
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
win.on('console', (m) => {
  if (m.type() === 'error') console.log('  [renderer error]', m.text().slice(0, 200))
})
await win.waitForLoadState('domcontentloaded')
await sleep(2500) // 等初始渲染 + mermaid

/** 编辑器滚动容器 scrollTop(scrollDOM 即 .cm-scroller) */
const editorScrollTop = () =>
  win.evaluate(() => document.querySelector('#editor .cm-scroller')?.scrollTop ?? -1)
/** 大纲当前活跃行文本 */
const activeText = () =>
  win.evaluate(() => document.querySelector('#outline-list .ol-item.active')?.textContent ?? '')
/** 轮询直到条件满足或超时,返回最后一次取值(渲染/measure 有异步余量,减少偶发) */
async function waitValue(fn, cond, timeout = 4000) {
  const t0 = Date.now()
  let v = await fn()
  while (!cond(v) && Date.now() - t0 < timeout) {
    await sleep(200)
    v = await fn()
  }
  return v
}

try {
  // 1. 渲染模式点大纲「数学公式」(既有能力,作为后续步骤的前置)。
  // 注:不用「小节 C」——它距文末不足一屏,平滑滚动触底后 viewer 既有的
  // 「滚动到底激活最后一个标题」规则会把活跃项定为「HTML 内联」(既有行为,非本次改动)。
  await win.locator('#outline-list .ol-item', { hasText: '数学公式' }).first().click()
  await sleep(900)
  check('1 渲染模式大纲点击后活跃项为「数学公式」', (await activeText()).includes('数学公式'), await activeText())

  // 2. 切编辑模式:应定位到「数学公式」附近而不是文档开头
  await win.keyboard.press('Control+Shift+r')
  await sleep(800)
  const st2 = await waitValue(editorScrollTop, (v) => v > 200)
  check('2 进入编辑模式定位到阅读位置(scrollTop>200)', st2 > 200, `scrollTop=${st2}`)
  check('2 大纲活跃项仍为「数学公式」', (await activeText()).includes('数学公式'), await activeText())

  // 3. 编辑模式点大纲「基础排版」:向上跳转 + 活跃项切换
  await win.locator('#outline-list .ol-item', { hasText: '基础排版' }).first().click()
  await sleep(600)
  const st3 = await editorScrollTop()
  check('3 编辑模式大纲点击向上跳转(scrollTop 明显变小)', st3 < st2 - 500, `${st2} -> ${st3}`)
  check('3 活跃项切换为「基础排版」', (await activeText()).includes('基础排版'), await activeText())

  // 4. 文末新增标题 → 大纲去抖(600ms)后出现新条目
  await win.locator('#editor .cm-content').click()
  await win.keyboard.press('Control+End')
  await win.keyboard.type('\n\n## 编辑同步测试标题\n')
  await sleep(1200)
  const hasNew = await waitValue(
    () =>
      win.evaluate(() =>
        [...document.querySelectorAll('#outline-list .ol-item')].some((el) =>
          (el.textContent ?? '').includes('编辑同步测试标题')
        )
      ),
    (v) => v === true,
    3000
  )
  check('4 编辑新增标题出现在大纲', hasNew === true)

  // 5. 点大纲新标题 → 跳到文末区域
  await win.locator('#outline-list .ol-item', { hasText: '编辑同步测试标题' }).first().click()
  await sleep(600)
  const st5 = await editorScrollTop()
  check('5 点击新标题跳到文末区域(scrollTop 变大)', st5 > st3 + 500, `${st3} -> ${st5}`)
  check('5 活跃项为新标题', (await activeText()).includes('编辑同步测试标题'), await activeText())

  // 6. Ctrl+S 保存清 dirty(防退出确认框),再恢复测试文档原内容(触发外部修改自动重载)
  await win.keyboard.press('Control+s')
  await sleep(800)
  writeFileSync(DEMO, demoOriginal)
  await sleep(1500) // watcher 300ms 去抖 + 自动重载

  // 7. 切回渲染模式:应回到阅读位置附近(会话滚动比例/活跃标题),而不是顶部
  await win.keyboard.press('Control+Shift+e')
  await sleep(800)
  const vst = await waitValue(
    () => win.evaluate(() => document.querySelector('#viewer-scroll')?.scrollTop ?? -1),
    (v) => v > 200,
    5000
  )
  check('7 切回渲染模式恢复阅读位置(viewer scrollTop>200)', vst > 200, `scrollTop=${vst}`)
} catch (e) {
  fail++
  console.log('  EXCEPTION:', e.message)
}

// 双保险:异常中断时也恢复测试文档
writeFileSync(DEMO, demoOriginal)

console.log(`\nEDITSYNC: ${pass} PASS, ${fail} FAIL ${fail ? '' : '— ALL OK'}`)
await app.close()
process.exit(fail ? 1 : 0)
