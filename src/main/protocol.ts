// mdr:// 自定义协议 — 只允许读取已注册根目录内的本地资源
// URL 形如 mdr://local/<encodeURIComponent(绝对路径)>
import { net, protocol } from 'electron'
import { promises as fsp } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

// 已允许的根目录(resolve 后的原始形式)
const allowedRoots = new Set<string>()

export function allowRoot(dir: string): void {
  if (typeof dir === 'string' && dir.trim()) allowedRoots.add(path.resolve(dir))
}

/** 切换工作区时收缩授权面:清空累积的旧根,只保留当前多根列表(null/空数组 仅清空) */
export function resetAllowedRoots(roots: string[] | null): void {
  allowedRoots.clear()
  for (const dir of roots ?? []) allowRoot(dir)
}

// target 是否位于某个已允许根之内;win32 大小写不敏感,用 path.relative 判断而非 startsWith
function isAllowed(target: string): boolean {
  const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  const t = fold(target)
  for (const root of allowedRoots) {
    const rel = path.relative(fold(root), t)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true
  }
  return false
}

// 扩展名 → MIME(svg 必须 image/svg+xml)
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

// app ready 之后调用(registerSchemesAsPrivileged 在 index.ts 的 ready 之前)
export function registerProtocol(): void {
  protocol.handle('mdr', async (request) => {
    try {
      const u = new URL(request.url)
      if (u.host.toLowerCase() !== 'local') return new Response('Forbidden', { status: 403 })
      const decoded = decodeURIComponent(u.pathname.replace(/^\//, ''))
      if (!decoded) return new Response('Not Found', { status: 404 })
      const target = path.resolve(decoded)
      if (!isAllowed(target)) return new Response('Forbidden', { status: 403 })
      const st = await fsp.stat(target).catch(() => null)
      if (!st || !st.isFile()) return new Response('Not Found', { status: 404 })

      // 用 net.fetch 流式读取本地文件,强制按扩展名覆盖 MIME
      const mime = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
      const resp = await net.fetch(pathToFileURL(target).toString(), {
        bypassCustomProtocolHandlers: true
      })
      if (!resp.ok) return new Response('Not Found', { status: 404 })
      const headers = new Headers(resp.headers)
      headers.set('Content-Type', mime)
      return new Response(resp.body, { status: 200, headers })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
