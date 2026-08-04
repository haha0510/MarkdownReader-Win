// 目录监控 — chokidar v4;多根工作区:单 watcher 监控路径数组;结构变化去抖重建全部树,md 内容变化即时通知
import { watch, FSWatcher } from 'chokidar'
import path from 'path'
import type { WebContents } from 'electron'
import type { FileNode } from '@shared/types'
import { IPC } from '@shared/ipc'
import { MD_EXTENSIONS } from '@shared/types'
import { readTree } from './files'
import { resetAllowedRoots } from './protocol'

let getSender: () => WebContents | null = () => null
let watcher: FSWatcher | null = null
/** 当前监控的根目录列表(与渲染器 rootDirs 顺序一致) */
let currentRoots: string[] = []
/** root(原始形式)→ 上次成功读取的树;某根临时读失败时兜底,保证载荷与 roots 对齐 */
const lastTrees = new Map<string, FileNode>()
let debounceTimer: NodeJS.Timeout | null = null

const norm = (p: string): string => p.replace(/\\/g, '/')

export function initWatcher(sender: () => WebContents | null): void {
  getSender = sender
}

function send(channel: string, payload: unknown): void {
  const wc = getSender()
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

// 任意结构事件 → 去抖 300ms → 对每个 root 全量 readTree → EvTreeChanged(FileNode[],与 roots 顺序一致)
function scheduleTreeRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const roots = currentRoots
    if (roots.length === 0) return
    void Promise.all(
      roots.map(async (root) => {
        try {
          const tree = await readTree(root)
          lastTrees.set(root, tree)
          return tree
        } catch {
          // 根目录被删/暂不可读:兜底用上次成功的树,首次即失败则给空 children 占位,
          // 保持数组与 roots 一一对应(渲染器按下标对齐,不做收缩)
          return (
            lastTrees.get(root) ?? {
              name: path.basename(root) || root,
              path: norm(path.resolve(root)),
              isDir: true,
              children: []
            }
          )
        }
      })
    ).then((trees) => {
      if (roots === currentRoots) send(IPC.EvTreeChanged, trees)
    })
  }, 300)
}

// 切换监控根目录集合;null/空数组 = 停止
export async function setWatchRoots(roots: string[] | null): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    const w = watcher
    watcher = null
    await w.close().catch(() => {})
  }
  currentRoots = roots ?? []
  lastTrees.clear()
  // mdr:// 授权面跟随监控根收缩(避免整个会话累积历史目录)
  resetAllowedRoots(currentRoots)
  if (currentRoots.length === 0) return

  const rootAbsList = currentRoots.map((r) => path.resolve(r))
  // v4 不支持 glob:直接传目录数组,用函数式 ignored 跳过隐藏目录/node_modules
  watcher = watch(rootAbsList, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ignored: (p: string) => {
      const abs = path.resolve(p)
      if (rootAbsList.includes(abs)) return false // 根自身永不忽略
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
  await setWatchRoots(null)
}
