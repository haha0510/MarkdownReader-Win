// 设置弹窗 — 每次改动即时 api.setSettings 持久化并回写 store(主题/字号由 F/D 监听生效)
import { store } from '@/state'
import { bus } from '@/bus'
import { t } from '@/i18n'
import { themes } from '@/theme/themes'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings } from '@shared/types'
import type { RendererApi } from '@shared/ipc'

const api = (window as unknown as { api: RendererApi }).api

/** 缺失 key 时回退本地三语(参考项目无对应文案的少量标签) */
function tf(key: string, zhHans: string, zhHant: string, en: string): string {
  const s = t(key)
  if (s !== key) return s
  const lang = store.get().lang
  return lang === 'zh-Hans' ? zhHans : lang === 'zh-Hant' ? zhHant : en
}

export function initSettingsUI(): void {
  const overlay = document.getElementById('settings-overlay') as HTMLElement
  const modal = document.getElementById('settings-modal') as HTMLElement

  function apply(patch: Partial<Settings>): void {
    void api.setSettings(patch).then((s) => store.set({ settings: s }))
  }

  // ── 控件构造 ──
  function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const r = document.createElement('div')
    r.className = 'st-row'
    const lab = document.createElement('label')
    lab.textContent = label
    const ctl = document.createElement('div')
    ctl.className = 'st-control'
    ctl.appendChild(control)
    if (hint) {
      const h = document.createElement('div')
      h.className = 'st-hint muted'
      h.textContent = hint
      ctl.appendChild(h)
    }
    r.append(lab, ctl)
    return r
  }

  function section(title: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'st-section'
    el.textContent = title
    return el
  }

  function makeSelect(opts: Array<{ value: string; label: string }>, value: string): HTMLSelectElement {
    const sel = document.createElement('select')
    for (const o of opts) {
      const opt = document.createElement('option')
      opt.value = o.value
      opt.textContent = o.label
      sel.appendChild(opt)
    }
    sel.value = value
    if (sel.value !== value && sel.options.length > 0) sel.selectedIndex = 0
    return sel
  }

  function numInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const i = document.createElement('input')
    i.type = 'number'
    i.min = String(min)
    i.max = String(max)
    i.step = String(step)
    i.value = String(value)
    i.addEventListener('change', () => {
      let v = Number(i.value)
      if (!Number.isFinite(v)) v = value
      v = Math.min(max, Math.max(min, v))
      const dec = String(step).includes('.') ? String(step).split('.')[1].length : 0
      v = Number(v.toFixed(dec)) // 消除步进浮点尾差
      i.value = String(v)
      onChange(v)
    })
    return i
  }

  // ── 渲染整个弹窗(打开/重置时重建)──
  function render(): void {
    const s = store.get().settings
    modal.textContent = ''

    // 头部
    const header = document.createElement('div')
    header.className = 'st-header'
    const title = document.createElement('span')
    title.className = 'st-title'
    title.textContent = t('sidebarSettingsButton')
    const closeBtn = document.createElement('button')
    closeBtn.className = 'st-close'
    closeBtn.title = t('settingsBackToApp')
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', close)
    header.append(title, closeBtn)

    const body = document.createElement('div')
    body.className = 'st-body'

    // ── 外观 ──
    body.appendChild(section(t('settingsTabAppearance')))

    // 主题:auto + 浅色/深色分组
    const themeSel = document.createElement('select')
    const autoOpt = document.createElement('option')
    autoOpt.value = 'auto'
    autoOpt.textContent = t('win.themeFollowSystem')
    themeSel.appendChild(autoOpt)
    const gLight = document.createElement('optgroup')
    gLight.label = t('settingsAppearanceModeLight')
    const gDark = document.createElement('optgroup')
    gDark.label = t('settingsAppearanceModeDark')
    for (const th of themes) {
      const o = document.createElement('option')
      o.value = th.id
      o.textContent = th.name
      ;(th.dark ? gDark : gLight).appendChild(o)
    }
    themeSel.append(gLight, gDark)
    themeSel.value = s.theme
    if (themeSel.value !== s.theme) themeSel.value = 'auto'
    body.appendChild(row(t('settingsAppearanceThemeTitle'), themeSel))

    // auto 时的明/暗主题选择
    const lightSel = makeSelect(
      themes.filter((th) => !th.dark).map((th) => ({ value: th.id, label: th.name })),
      s.lightTheme
    )
    const darkSel = makeSelect(
      themes.filter((th) => th.dark).map((th) => ({ value: th.id, label: th.name })),
      s.darkTheme
    )
    const lightRow = row(t('win.themeLight'), lightSel)
    const darkRow = row(t('win.themeDark'), darkSel)
    body.append(lightRow, darkRow)
    const syncAutoRows = (): void => {
      const isAuto = themeSel.value === 'auto'
      lightRow.hidden = !isAuto
      darkRow.hidden = !isAuto
    }
    syncAutoRows()
    themeSel.addEventListener('change', () => {
      apply({ theme: themeSel.value })
      syncAutoRows()
    })
    lightSel.addEventListener('change', () => apply({ lightTheme: lightSel.value }))
    darkSel.addEventListener('change', () => apply({ darkTheme: darkSel.value }))

    // 正文字号 / 行高
    body.appendChild(
      row(tf('win.fontSize', '正文字号', '內文字號', 'Content font size'), numInput(s.fontSize, 12, 28, 1, (v) => apply({ fontSize: v })))
    )
    body.appendChild(
      row(tf('win.lineHeight', '行高', '行高', 'Line height'), numInput(s.lineHeight, 1.2, 2.6, 0.1, (v) => apply({ lineHeight: v })))
    )

    // 渲染宽度:0 = 跟随窗口
    const widths = [0, 680, 760, 820, 900, 1000, 1200]
    if (!widths.includes(s.contentWidth)) {
      widths.push(s.contentWidth)
      widths.sort((a, b) => a - b)
    }
    const widthSel = makeSelect(
      widths.map((w) => ({ value: String(w), label: w === 0 ? t('settingsGeneralMaxWidthFollowsWindow') : `${w} px` })),
      String(s.contentWidth)
    )
    widthSel.addEventListener('change', () => apply({ contentWidth: Number(widthSel.value) }))
    body.appendChild(row(t('settingsGeneralRenderedWidthTitle'), widthSel))

    // 编辑器
    body.appendChild(
      row(t('settingsAppearanceSourceFontSize'), numInput(s.editorFontSize, 10, 24, 1, (v) => apply({ editorFontSize: v })))
    )
    const wrap = document.createElement('input')
    wrap.type = 'checkbox'
    wrap.checked = s.editorWordWrap
    wrap.addEventListener('change', () => apply({ editorWordWrap: wrap.checked }))
    body.appendChild(row(tf('win.editorWordWrap', '自动换行', '自動換行', 'Word wrap'), wrap))

    // 自动保存(编辑停顿后写回本地文件)
    const autoSave = document.createElement('input')
    autoSave.type = 'checkbox'
    autoSave.checked = s.autoSave
    autoSave.addEventListener('change', () => apply({ autoSave: autoSave.checked }))
    body.appendChild(row(t('win.autoSave'), autoSave, t('win.autoSaveHint')))

    // ── 通用 ──
    body.appendChild(section(t('settingsTabGeneral')))

    const langSel = makeSelect(
      [
        { value: 'auto', label: t('languageAuto') },
        { value: 'zh-Hans', label: t('languageZhCN') },
        { value: 'zh-Hant', label: t('languageZhTW') },
        { value: 'en', label: t('languageEn') }
      ],
      s.language
    )
    langSel.addEventListener('change', () => {
      void api.setSettings({ language: langSel.value as Settings['language'] }).then((ns) => {
        store.set({ settings: ns })
        // 无未保存修改则直接重载生效;否则提示稍后手动重载
        if (!store.get().dirty) location.reload()
        else bus.emit('toast', { message: t('win.languageReloadHint'), kind: 'info' })
      })
    })
    body.appendChild(row(t('settingsGeneralLanguageTitle'), langSel))

    const puml = document.createElement('input')
    puml.type = 'text'
    puml.placeholder = 'https://www.plantuml.com/plantuml'
    puml.value = s.plantumlServer
    puml.spellcheck = false
    puml.addEventListener('change', () => apply({ plantumlServer: puml.value.trim() }))
    body.appendChild(
      row(
        tf('win.plantumlServer', 'PlantUML 服务器', 'PlantUML 伺服器', 'PlantUML server'),
        puml,
        tf('win.plantumlEmptyHint', '留空则禁用 PlantUML 渲染', '留空則停用 PlantUML 渲染', 'Leave empty to disable PlantUML')
      )
    )

    // ── AI 助手 ──
    body.appendChild(section(t('win.settingsAi')))

    // 文本输入辅助:即时保存到指定 settings 键(复用 apply 保存机制)
    function aiText(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
      const i = document.createElement('input')
      i.type = 'text'
      i.placeholder = placeholder
      i.value = value
      i.spellcheck = false
      i.addEventListener('change', () => onChange(i.value.trim()))
      return i
    }

    const aiBase = aiText(s.aiBaseUrl, 'https://api.deepseek.com', (v) => apply({ aiBaseUrl: v }))
    body.appendChild(row(t('win.settingsAiBaseUrl'), aiBase))

    // 密钥:type=password(panels.css 仅样式化 text/number,这里补内联样式与其它输入一致)
    const aiKey = document.createElement('input')
    aiKey.type = 'password'
    aiKey.value = s.aiApiKey
    aiKey.spellcheck = false
    aiKey.autocomplete = 'off'
    aiKey.style.cssText =
      'width:100%;height:28px;padding:0 8px;font-size:13px;font-family:inherit;color:var(--ui-fg);background:var(--ui-bg);border:1px solid var(--ui-border);border-radius:6px;outline:none'
    aiKey.addEventListener('change', () => apply({ aiApiKey: aiKey.value.trim() }))
    body.appendChild(row(t('win.settingsAiKey'), aiKey))

    const aiModel = aiText(s.aiModel, 'deepseek-chat', (v) => apply({ aiModel: v }))
    body.appendChild(row(t('win.settingsAiModel'), aiModel))

    const aiLang = aiText(s.aiTargetLang, '', (v) => apply({ aiTargetLang: v }))
    body.appendChild(row(t('win.settingsAiTargetLang'), aiLang))

    // 测试连接:用输入框实时值组装 cfg(而非旧 store)
    const testBtn = document.createElement('button')
    testBtn.className = 'st-reset'
    testBtn.type = 'button'
    testBtn.textContent = t('win.settingsAiTest')
    const testStatus = document.createElement('span')
    testStatus.className = 'st-hint'
    const testWrap = document.createElement('div')
    testWrap.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:8px'
    testWrap.append(testBtn, testStatus)
    testBtn.addEventListener('click', () => {
      const cfg = {
        baseUrl: aiBase.value.trim(),
        apiKey: aiKey.value.trim(),
        model: aiModel.value.trim()
      }
      testBtn.disabled = true
      testBtn.textContent = t('win.aiThinking')
      testStatus.textContent = ''
      testStatus.style.color = ''
      void api
        .aiTest(cfg)
        .then((r) => {
          if (r.ok) {
            testStatus.textContent = t('win.settingsAiTestOk')
            testStatus.style.color = 'var(--ui-accent)'
          } else {
            testStatus.textContent = t('win.settingsAiTestFail', { msg: r.error ?? '' })
            testStatus.style.color = 'var(--ui-danger)'
          }
        })
        .catch((e: unknown) => {
          testStatus.textContent = t('win.settingsAiTestFail', { msg: e instanceof Error ? e.message : String(e) })
          testStatus.style.color = 'var(--ui-danger)'
        })
        .finally(() => {
          testBtn.disabled = false
          testBtn.textContent = t('win.settingsAiTest')
        })
    })
    body.appendChild(row('', testWrap))

    // 分区提示
    const aiHint = document.createElement('div')
    aiHint.className = 'st-hint muted'
    aiHint.style.cssText = 'padding:4px 0 8px'
    aiHint.textContent = t('win.settingsAiHint')
    body.appendChild(aiHint)

    // 底部:重置默认
    const footer = document.createElement('div')
    footer.className = 'st-footer'
    const resetBtn = document.createElement('button')
    resetBtn.className = 'st-reset'
    resetBtn.textContent = t('win.resetSettings')
    resetBtn.addEventListener('click', () => {
      void api.setSettings({ ...DEFAULT_SETTINGS }).then((ns) => {
        store.set({ settings: ns })
        render() // 重建控件反映默认值
      })
    })
    footer.appendChild(resetBtn)

    modal.append(header, body, footer)
  }

  function open(): void {
    render()
    overlay.hidden = false
  }
  function close(): void {
    overlay.hidden = true
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
  bus.on('show-settings', () => {
    if (overlay.hidden) open()
    else close()
  })
  bus.on('close-overlays', close)
}
