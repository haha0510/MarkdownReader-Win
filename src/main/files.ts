// 文件系统操作 — 目录树、读写、新建/重命名/删除。路径输出一律正斜杠。
import { promises as fsp } from 'fs'
import path from 'path'
import { shell } from 'electron'
import type { FileContent, FileNode } from '@shared/types'
import { MD_EXTENSIONS } from '@shared/types'

const norm = (p: string): string => p.replace(/\\/g, '/')

const isMdFile = (name: string): boolean => MD_EXTENSIONS.includes(path.extname(name).toLowerCase())

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
    } else if (ent.isFile() && isMdFile(ent.name)) {
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

// 删除 → 回收站
export async function deleteEntry(p: string): Promise<void> {
  await shell.trashItem(path.normalize(path.resolve(p)))
}
