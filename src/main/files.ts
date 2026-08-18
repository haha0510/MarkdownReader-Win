// 文件系统操作 — 目录树、读写、新建/重命名/删除。路径输出一律正斜杠。
import { promises as fsp } from 'fs'
import path from 'path'
import { shell } from 'electron'
import type { FileContent, FileNode } from '@shared/types'
import { MD_EXTENSIONS, isTextPath } from '@shared/types'
import type { SearchHit } from '@shared/ipc'
import { getSettings } from './store'

const norm = (p: string): string => p.replace(/\\/g, '/')

const isMdFile = (name: string): boolean => MD_EXTENSIONS.includes(path.extname(name).toLowerCase())

// 目录树/搜索共用的文件过滤:md 恒显示;代码/文本文件按 settings.showCodeFiles
const isShownFile = (name: string): boolean =>
  isMdFile(name) || (getSettings().showCodeFiles && isTextPath(name))

// 跳过隐藏项与 node_modules
const skipName = (name: string): boolean => name.startsWith('.') || name === 'node_modules'

// 目录在前,名称按 zh locale 不分大小写排序
const cmpNode = (a: FileNode, b: FileNode): number =>
  a.name.localeCompare(b.name, 'zh', { numeric: true, sensitivity: 'base' })

async function buildChildren(dir: string): Promise<FileNode[]> {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return [] // 无权限等错误 → 空目录
  }
  const dirs: FileNode[] = []
  const files: FileNode[] = []
  for (const ent of entries) {
    if (skipName(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      dirs.push({ name: ent.name, path: norm(full), isDir: true, children: await buildChildren(full) })
    } else if (ent.isFile() && isShownFile(ent.name)) {
      files.push({ name: ent.name, path: norm(full), isDir: false })
    }
    // 符号链接一律跳过(isDirectory/isFile 均为 false)
  }
  dirs.sort(cmpNode)
  files.sort(cmpNode)
  return [...dirs, ...files]
}

// 递归读取目录树;root 必须是目录
export async function readTree(rootDir: string): Promise<FileNode> {
  const abs = path.resolve(rootDir)
  const st = await fsp.stat(abs)
  if (!st.isDirectory()) throw new Error('root is not a directory: ' + rootDir)
  return {
    name: path.basename(abs) || norm(abs),
    path: norm(abs),
    isDir: true,
    children: await buildChildren(abs)
  }
}

export async function readFile(p: string): Promise<FileContent> {
  const content = await fsp.readFile(p, 'utf8')
  const st = await fsp.stat(p)
  return { content, mtimeMs: st.mtimeMs }
}

export async function writeFile(p: string, content: string): Promise<{ mtimeMs: number }> {
  await fsp.writeFile(p, content, 'utf8')
  const st = await fsp.stat(p)
  return { mtimeMs: st.mtimeMs }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

// 新建文件/文件夹;重名时自动追加序号(文件序号加在扩展名前)
export async function createEntry(
  dirPath: string,
  name: string,
  kind: 'file' | 'folder'
): Promise<{ path: string }> {
  if (!name.trim() || /[\\/:*?"<>|]/.test(name)) throw new Error('invalid name: ' + name)
  let target = path.join(dirPath, name)
  if (await exists(target)) {
    const ext = kind === 'file' ? path.extname(name) : ''
    const base = ext ? name.slice(0, -ext.length) : name
    for (let i = 2; ; i++) {
      target = path.join(dirPath, `${base} ${i}${ext}`)
      if (!(await exists(target))) break
    }
  }
  if (kind === 'folder') {
    await fsp.mkdir(target)
  } else {
    // wx:已存在则失败,兜底防竞态
    await fsp.writeFile(target, '', { encoding: 'utf8', flag: 'wx' })
  }
  return { path: norm(target) }
}

// 同目录重命名;newName 不允许包含路径分隔符
export async function renameEntry(p: string, newName: string): Promise<{ path: string }> {
  if (!newName.trim() || /[\\/:*?"<>|]/.test(newName)) throw new Error('invalid name: ' + newName)
  const target = path.join(path.dirname(path.resolve(p)), newName)
  // 大小写改名(同一文件)放行;其余重名拒绝
  const sameFile = norm(path.resolve(p)).toLowerCase() === norm(target).toLowerCase()
  if (!sameFile && (await exists(target))) throw new Error('target already exists: ' + newName)
  await fsp.rename(p, target)
  return { path: norm(target) }
}

// 移动文件/目录到目标目录(目标路径 = destDir + basename(src))
export async function moveEntry(srcPath: string, destDir: string): Promise<{ path: string }> {
  const src = path.resolve(srcPath)
  const dest = path.resolve(destDir)
  const srcSt = await fsp.stat(src) // src 不存在则此处抛错
  const destSt = await fsp.stat(dest)
  if (!destSt.isDirectory()) throw new Error('destination is not a directory: ' + destDir)
  // 禁止把目录移入自身或其子孙(win32 路径大小写不敏感,统一小写前缀判断)
  if (srcSt.isDirectory()) {
    const srcLow = norm(src).toLowerCase()
    const destLow = norm(dest).toLowerCase()
    if (destLow === srcLow || destLow.startsWith(srcLow + '/'))
      throw new Error('cannot move a folder into itself: ' + path.basename(src))
  }
  const target = path.join(dest, path.basename(src))
  // 同位置移动 = 无操作
  if (norm(target).toLowerCase() === norm(src).toLowerCase()) return { path: norm(src) }
  if (await exists(target)) throw new Error('target already exists: ' + path.basename(src))
  try {
    await fsp.rename(src, target)
  } catch (err) {
    // 跨盘(EXDEV)时 rename 失败:复制 + 删除兜底
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.cp(src, target, { recursive: true })
      await fsp.rm(src, { recursive: true, force: true })
    } else {
      throw err
    }
  }
  return { path: norm(target) }
}

// 递归收集根目录下全部可搜索文件路径(与目录树同过滤:md ∪ 代码/文本;跳过隐藏项与 node_modules)
async function collectMdFiles(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return // 无权限等错误 → 跳过
  }
  for (const ent of entries) {
    if (skipName(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) await collectMdFiles(full, out)
    else if (ent.isFile() && isShownFile(ent.name)) out.push(full)
  }
}

const SEARCH_MAX_TOTAL = 200 // 总命中上限
const SEARCH_MAX_PER_FILE = 20 // 单文件命中上限
const SEARCH_MAX_FILE_SIZE = 2 * 1024 * 1024 // 超过 2MB 的文件跳过

// 全文搜索:大小写不敏感的普通子串匹配,逐文件顺序读取(避免并发读爆)
export async function searchContent(roots: string[], query: string): Promise<SearchHit[]> {
  const q = query.toLowerCase()
  const hits: SearchHit[] = []
  if (!q) return hits
  for (const root of roots) {
    const mdFiles: string[] = []
    try {
      const abs = path.resolve(root)
      const st = await fsp.stat(abs)
      if (!st.isDirectory()) continue
      await collectMdFiles(abs, mdFiles)
    } catch {
      continue // 根不可读 → 跳过
    }
    for (const file of mdFiles) {
      if (hits.length >= SEARCH_MAX_TOTAL) return hits
      let content: string
      try {
        const st = await fsp.stat(file)
        if (st.size > SEARCH_MAX_FILE_SIZE) continue
        content = await fsp.readFile(file, 'utf8')
      } catch {
        continue
      }
      const lines = content.split(/\r?\n/)
      let inFile = 0
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(q)) continue
        hits.push({ path: norm(file), line: i, preview: lines[i].trim().slice(0, 200) })
        if (++inFile >= SEARCH_MAX_PER_FILE || hits.length >= SEARCH_MAX_TOTAL) break
      }
    }
  }
  return hits
}

// 删除 → 回收站
export async function deleteEntry(p: string): Promise<void> {
  await shell.trashItem(path.normalize(path.resolve(p)))
}
