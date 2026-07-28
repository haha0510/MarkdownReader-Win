// 目录监控 — chokidar v4;结构变化去抖重建树,md 内容变化即时通知
import { watch, FSWatcher } from 'chokidar'
import path from 'path'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { MD_EXTENSIONS } from '@shared/types'
import { readTree } from './files'
import { resetAllowedRoots } from './protocol'

let getSender: () => WebContents | null = () => null
let watcher: FSWatcher | null = null
let currentRoot: string | null = null
let debounceTimer: NodeJS.Timeout | null = null

const norm = (p: string): string => p.replace(/\\/g, '/')

export function initWatcher(sender: () => WebContents | null): void {
  getSender = sender
}

function send(channel: string, payload: unknown): void {
  const wc = getSender()
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

// 任意结构事件 → 去抖 300ms → 全量 readTree → EvTreeChanged
function scheduleTreeRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const root = currentRoot
    if (!root) return
    readTree(root)
      .then((tree) => send(IPC.EvTreeChanged, tree))
      .catch(() => {
        // 根目录被删等情况:忽略,等下一次事件
      })
  }, 300)
}

// 切换监控根目录;null = 停止
export async function setWatchRoot(rootDir: string | null): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    const w = watcher
    watcher = null
    await w.close().catch(() => {})
  }
  currentRoot = rootDir
  // mdr:// 授权面跟随监控根收缩(避免整个会话累积历史目录)
  resetAllowedRoots(rootDir)
  if (!rootDir) return

  const rootAbs = path.resolve(rootDir)
  // v4 不支持 glob:直接传目录,用函数式 ignored 跳过隐藏目录/node_modules
  watcher = watch(rootAbs, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ignored: (p: string) => {
      const abs = path.resolve(p)
      if (abs === rootAbs) return false // 根自身永不忽略
      const base = path.basename(abs)
      return base.startsWith('.') || base === 'node_modules'
    }
  })

  watcher.on('all', (event, p) => {
    // markdown 文件内容变化 → 立即推送(外部修改检测)
    if (event === 'change' && MD_EXTENSIONS.includes(path.extname(p).toLowerCase())) {
      send(IPC.EvFileChanged, norm(path.resolve(p)))
    }
    // 纯内容变化不影响目录结构,不必重建树(避免每次 Ctrl+S 后侧栏重绘)
    if (event !== 'change') scheduleTreeRefresh()
  })
  watcher.on('error', () => {
    // Windows 上偶发 EPERM,忽略避免主进程崩溃
  })
}

export async function stopWatcher(): Promise<void> {
  await setWatchRoot(null)
}
