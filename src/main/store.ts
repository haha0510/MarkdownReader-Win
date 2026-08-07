// settings.json / session.json 持久化 — 原子写入,session 去抖 300ms
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { SessionState, Settings } from '@shared/types'
import { DEFAULT_SESSION, DEFAULT_SETTINGS } from '@shared/types'

let settings: Settings | null = null
let sessionState: SessionState | null = null
let sessionTimer: NodeJS.Timeout | null = null

/** 仅用于持久化文件的内部迁移标记,不暴露给渲染器 Settings。 */
const SETTINGS_LAYOUT_VERSION = 1
type StoredSettings = Partial<Settings> & { _layoutVersion?: number }

function fileOf(name: string): string {
  return path.join(app.getPath('userData'), name)
}

// 读取 JSON,失败/损坏时回默认值;浅合并保证新增字段有默认
function loadJson<T extends object>(name: string, defaults: T): T {
  try {
    const raw = fs.readFileSync(fileOf(name), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...defaults, ...(parsed as Partial<T>) }
    }
  } catch {
    // 首次运行或文件损坏 → 默认值
  }
  return { ...defaults }
}

// 原子写:先写 .tmp 再 rename(Windows 上 rename 覆盖目标)
function writeJsonAtomic(name: string, data: unknown): void {
  try {
    const file = fileOf(name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.error('[store] write failed:', name, e)
  }
}

function loadSettings(): Settings {
  let parsed: StoredSettings | null = null
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(fileOf('settings.json'), 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) parsed = raw as StoredSettings
  } catch {
    // 首次运行或文件损坏 → 默认值
  }

  const layoutVersion = parsed?._layoutVersion ?? 0
  const { _layoutVersion: _ignored, ...storedValues } = parsed ?? {}
  const loaded: Settings = { ...DEFAULT_SETTINGS, ...storedValues }

  // v0.3 之前默认渲染宽度为 820px。只迁移一次,避免以后误伤用户主动选择的 820px。
  if (parsed && layoutVersion < SETTINGS_LAYOUT_VERSION) {
    if (loaded.contentWidth === 820) loaded.contentWidth = 0
    writeJsonAtomic('settings.json', { ...loaded, _layoutVersion: SETTINGS_LAYOUT_VERSION })
  }
  return loaded
}

export function getSettings(): Settings {
  if (!settings) settings = loadSettings()
  return settings
}

// 浅合并 patch 并立即持久化(设置修改低频)
export function setSettings(patch: Partial<Settings>): Settings {
  settings = { ...getSettings(), ...patch }
  writeJsonAtomic('settings.json', { ...settings, _layoutVersion: SETTINGS_LAYOUT_VERSION })
  return settings
}

export function getSession(): SessionState {
  if (!sessionState) {
    sessionState = loadJson('session.json', DEFAULT_SESSION)
    // 兼容旧版:v0.x 的 session.json 用单数 rootDir(string);升级为 rootDirs 数组
    const legacy = sessionState as SessionState & { rootDir?: string | null }
    if (typeof legacy.rootDir === 'string' && legacy.rootDir && sessionState.rootDirs.length === 0) {
      sessionState.rootDirs = [legacy.rootDir]
    }
    delete legacy.rootDir
  }
  return sessionState
}

// 浅合并 patch,写盘去抖 300ms(滚动位置等高频更新)
export function setSession(patch: Partial<SessionState>): void {
  sessionState = { ...getSession(), ...patch }
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    sessionTimer = null
    if (sessionState) writeJsonAtomic('session.json', sessionState)
  }, 300)
}

// 退出前同步冲刷未写入的 session
export function flushStore(): void {
  if (sessionTimer) {
    clearTimeout(sessionTimer)
    sessionTimer = null
    if (sessionState) writeJsonAtomic('session.json', sessionState)
  }
}
