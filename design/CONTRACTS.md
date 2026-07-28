# CONTRACTS — 模块契约(并行实现必读)

本项目是 macOS 应用 MarkdownReader 的 Windows 移植(Electron + TypeScript,无前端框架,原生 DOM)。
**本文件 + `src/shared/types.ts` + `src/shared/ipc.ts` + `src/renderer/index.html` + `src/renderer/src/state.ts` + `src/renderer/src/bus.ts` 是唯一事实来源。**
这些契约文件不允许修改(发现真问题记录在最终报告里),你只能新建/编写你名下的文件。

参考规格(先读,按你模块的需要):`design/ui-spec.md`、`design/rendering-spec.md`、`design/theme-derivation.md`、`design/themes.json`、`design/i18n.json`。

## 0. 全局约定

- TypeScript strict;渲染器代码不使用任何框架,直接 DOM。
- 路径别名:`@shared/*` → `src/shared/*`;`@/*` → `src/renderer/src/*`(vite + tsconfig 已配)。
- 渲染器 sandbox:`contextIsolation: true`、`nodeIntegration: false`。渲染器只能通过 `window.api`(RendererApi,见 ipc.ts)访问系统。
- 所有面向用户的字符串必须走 i18n:`t('key')`(见第 6 节),不得硬编码中文/英文。
- 所有颜色必须走 CSS 变量(第 4 节),不得硬编码色值(阴影/透明遮罩可用 rgba 黑白)。
- 注释用中文,简洁。
- 每个组件模块导出唯一入口 `initXxx()`,由 `app.ts` 统一调用;模块间只通过 `store`/`bus`/DOM 通信,不互相 import(markdown/* 库模块除外,viewer 可以 import 它)。

## 1. 模块归属(每个 agent 只写自己名下的文件)

| Agent | 文件 |
|---|---|
| A main | `src/main/index.ts`(入口:窗口/单实例/argv)、`src/main/ipc.ts`、`src/main/files.ts`、`src/main/watcher.ts`、`src/main/store.ts`(settings/session 持久化)、`src/main/menu.ts`、`src/main/protocol.ts`、`src/main/pdf.ts`、`src/preload/index.ts` |
| B markdown | `src/renderer/src/markdown/render.ts`、`markdown/mermaid.ts`、`markdown/plantuml.ts`、`src/renderer/src/styles/markdown.css` |
| C shell | `src/renderer/src/app.ts`、`components/titlebar.ts`、`components/welcome.ts`、`components/resize.ts`、`components/toast.ts`、`keyboard.ts`、`i18n/index.ts`、`i18n/strings.ts`(由 design/i18n.json 生成)、`styles/base.css`、`styles/layout.css` |
| D viewer | `components/viewer.ts`、`components/editor.ts`、`components/findbar.ts`、`styles/viewer.css` |
| E panels | `components/filetree.ts`、`components/outline.ts`、`components/palette.ts`、`components/settings.ts`、`styles/panels.css` |
| F theme | `theme/themes.ts`(由 design/themes.json 生成)、`theme/apply.ts`、`styles/hljs.css` |

CSS 引入方式:每个 agent 的 .css 由自己名下的某个 .ts `import` 引入(vite 会打包);`app.ts` 引入 `base.css` 和 `layout.css`。

## 2. 启动时序(app.ts 责任,C 实现,其他 agent 依赖此顺序)

1. `initI18n()` — 读 settings.language + api.getLocale() 解析 `store.lang`。
2. `api.getSettings()` / `api.getSession()` → 写入 store(zoom、mode、sidebar/outline 可见性与宽度、rootDir、openFile 等从 session 恢复)。
3. `initTheme()`(F)— 应用主题 CSS 变量,之后 emit `theme-changed`。
4. `initTitlebar() initWelcome() initResize() initToast() initFiletree() initOutline() initPalette() initSettingsUI() initViewer() initEditor() initFindbar() initKeyboard()`。
5. 恢复会话:若 session.rootDir 存在 → bus.emit('open-folder', rootDir);再若 openFile 存在 → bus.emit('open-file', openFile)。
6. 注册 `api.onMenuAction` 分发(转成 bus 事件或直接调 store)、`api.onOpenPath`、`api.onFileChanged`、`api.onTreeChanged`、`api.onSystemThemeChanged`。
7. 空态时显示 welcome(`store.currentFile == null` ⇔ #welcome 可见,#viewer-scroll/#editor 隐藏)。
8. 一切就绪后调用 `api.ready()` — 主进程此后才会推送 EvOpenPath(文件关联/命令行启动参数)。

**open-file 流程(C 在 app.ts 实现,D/E 消费结果):**
`bus('open-file', path)` → 若 dirty 先 confirm(用 t() 文案 + window.confirm)→ `api.readFile` → `store.set({currentFile, content, mtimeMs, dirty:false, outline:[]})` → `api.allowRoot(其目录)` → `api.setTitle` → bus.emit('file-loaded') → session 持久化(openFile、recentRoots)。viewer/editor 监听 `file-loaded` 自行刷新;单文件打开(无 rootDir)时 sidebar 显示该文件所在目录?否——保持 tree 为空,welcome 隐藏。
**open-folder 流程:** `api.readTree` → `store.set({rootDir, tree})` → `api.watch(rootDir)` → `api.allowRoot(rootDir)` → session 持久化。

## 3. DOM 契约

`index.html` 的骨架 id 固定(见文件)。各组件只能操作自己名下的容器:

- titlebar(C):`#titlebar` 内已有按钮 id;`#doc-title` 文本、`#doc-dirty` 显隐由 C 监听 store 维护。窗口控制按钮是系统 titleBarOverlay,`#overlay-spacer` 宽度 = `env(titlebar-area-*)` 之外的保留区,C 用 CSS 处理(`-webkit-app-region: drag` 让 titlebar 可拖动,按钮 no-drag)。
- filetree(E):`#filetree`;行 DOM:`.ft-row[data-path][data-dir]` > `.ft-twist` + `.ft-icon` + `.ft-name`,选中 `.selected`,缩进用 `--depth` CSS 变量(`style="--depth: n"`)。
- outline(E):`#outline-list`;行:`.ol-item[data-id][data-level]`,活跃 `.active`。E 监听 store.outline / store.activeHeadingId。
- viewer(D):渲染目标 `#viewer`(class `markdown-body` 已带);滚动容器是 `#viewer-scroll`。D 监听 `file-loaded` 与 store.mode,调 B 的 `renderMarkdown()`,把 `outline` 写回 store,滚动时计算 activeHeadingId 写回 store,emit `rendered`。
- editor(D):挂载于 `#editor`(CodeMirror 6);内容变化 → `store.set({content, dirty:true})`。
- findbar(D):`#findbar` 内自建输入框/按钮;调 `api.findStart/findStop`,显示 `EvFindResult` 计数。注意:查找时聚焦 findbar 输入框,`findNext` 用已存文本。
- palette(E):`#palette-overlay` 显隐 + `#palette` 内容(输入框 + 结果列表 `.pal-item`);列出 tree 中所有 md 文件,子序列模糊匹配 + 简单评分(连续命中/词首加分),↑↓ Enter Esc,选中 → bus('open-file')。
- settings(E):`#settings-overlay`/`#settings-modal`;字段见 types.Settings + design/ui-spec.md;改动即时生效:`api.setSettings(patch)` → `store.set({settings})`(theme/fontSize 等由 F/D 监听 store.settings 响应)。含"重置默认"。
- welcome(C):`#welcome` 内容:应用名 + 提示 + "打开文件/打开文件夹"两按钮 + 最近打开列表(session.recentRoots,点击打开)。
- toast(C):`bus('toast', {message, kind})` → `#toast-container` 追加,3s 自动消失。
- 右键菜单:统一用 `api.popupMenu(items)`(原生菜单,返回点击 id),不自绘。

## 4. CSS 变量目录(F 负责在 `:root` 上设置;所有人只消费)

UI 铬:`--ui-bg --ui-fg --ui-fg-muted --ui-accent --ui-accent-fg --ui-border --ui-hover --ui-active --ui-selection --ui-titlebar-bg --ui-sidebar-bg --ui-panel-bg --ui-popover-bg --ui-danger --ui-scrollbar --ui-scrollbar-hover`
正文:`--md-bg --md-fg --md-heading --md-link --md-border --md-code-bg --md-code-fg --md-inline-code-bg --md-blockquote-fg --md-blockquote-border --md-table-stripe --md-hr --md-mark-bg`
代码高亮(hljs 类 → 变量映射在 F 的 `styles/hljs.css`):`--hl-comment --hl-keyword --hl-string --hl-number --hl-function --hl-title --hl-attr --hl-tag --hl-literal --hl-builtin --hl-type --hl-meta --hl-addition-bg --hl-deletion-bg`
布局/排版(非主题,D/C 按 store 维护):`--md-font-size --md-line-height --md-max-width --editor-font-size --sidebar-width --outline-width`
其余固定值:`--ui-radius: 8px`、`--ui-font: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif`、`--mono-font: "Cascadia Code", Consolas, "Courier New", monospace`(C 在 base.css 定义)。
F 同时负责:`color-scheme` 属性、`<html>` 上 `data-dark="true|false"`、调 `api.setOverlay` 同步标题栏、KaTeX/mermaid 需要的前景色变量 `--md-fg` 即可。

## 5. bus 事件目录

见 `src/renderer/src/bus.ts` 注释。补充载荷:`open-file`/`open-folder`/`scroll-to-heading`/`reveal-in-tree` 为 string;`toast` 为 `{message, kind}`。`close-overlays`:palette/settings/findbar 各自监听并关闭自己。`theme-changed`:B 的 mermaid 模块监听并按当前主题重渲染图表。

## 6. i18n(C 提供,全员消费)

`import { t } from '@/i18n'` — `t(key: string, params?: Record<string, string | number>): string`,占位符为具名 `{name}`(与参考项目一致,如 `{version}` `{ext}`),按 params 替换。
`i18n/strings.ts` 由 C 从 `design/i18n.json` 生成(key 与文案逐字保留)。缺 key 时返回 key 本身并 console.warn。语言解析:settings.language === 'auto' 时按 api.getLocale():zh-CN/zh-SG→zh-Hans,zh-TW/zh-HK/zh-MO→zh-Hant,其他→en。**新增 UI 若参考项目没有对应 key,在 strings.ts 里补 `win.*` 前缀的新 key(三语都要给)。**

## 7. 快捷键(C 的 keyboard.ts 统一处理 + 主进程菜单加速键双保险)

Ctrl+O 打开文件、Ctrl+Shift+O 打开文件夹、Ctrl+N 新建、Ctrl+S 保存、Ctrl+Alt+E 导出 PDF、Ctrl+, 设置、Ctrl+\ 侧栏、Ctrl+Shift+\ 大纲、Ctrl+Shift+E 渲染模式、Ctrl+Shift+R 原文模式、Ctrl+= / Ctrl+- / Ctrl+0 缩放、Ctrl+F 查找、F3 / Shift+F3(及 Ctrl+G / Ctrl+Shift+G)查找下/上一个、Ctrl+P 命令面板、Esc 关闭浮层。
主进程菜单(A)对以上注册加速键 → `EvMenuAction`;keyboard.ts 对 `EvMenuAction` 和本地 keydown 都分发到同一处理函数(需去重:本地 keydown 处理过的事件 `preventDefault` 后菜单不会再触发,Windows 上二者不冲突,按菜单事件优先实现即可,keydown 只处理菜单没覆盖的 Esc/F3/方向键场景)。

## 8. 主题 & 缩放语义

- zoom 只作用于正文/编辑器:D 把 `--md-font-size` 设为 `settings.fontSize * zoom` px(编辑器同理),不用 webFrame.setZoomFactor。范围 0.5–3.0,步进 0.1,session 持久化。
- F 的 `applyTheme()`:输入 theme id(或 auto+systemDark)→ 从 themes.ts 查 ThemeDef → 按 design/theme-derivation.md 派生全部 CSS 变量写到 `document.documentElement.style` → data-dark → setOverlay → emit('theme-changed')。store.settings 或 store.systemDark 变化时自动重应用。
- mermaid 主题:dark ? 'dark' : 'default',主题切换时重渲染当前图表(B 缓存源码)。

## 9. 主进程行为要点(A)

- 窗口:`titleBarStyle:'hidden'` + `titleBarOverlay:{height:40}`,min 720×480,默认 1200×800,恢复 session.windowBounds(校验在屏幕内);`backgroundColor` 用 session 存的上次主题背景(新增 session 字段不要;直接用 '#1e1e1e' 若 nativeTheme.shouldUseDarkColors else '#ffffff')。
- 单实例锁;第二实例 argv 中的 .md/目录路径 → `EvOpenPath` + 窗口前置。首实例启动 argv 同理(渲染器 ready 后再发,用 `ipcMain.once('renderer-ready')` 或首个 SessionGet 后 setTimeout 发)。
- `mdr://` 协议(`protocol.handle`):URL 形如 `mdr://local/<encodeURIComponent(绝对路径)>`;仅允许读取 `ProtocolAllowRoot` 注册过的根目录之内的文件;按扩展名给 mime;越界/不存在返回 404。`registerSchemesAsPrivileged`(standard:false, stream 支持即可,supportFetchAPI: true)在 app ready 前调用。
- watcher:chokidar 监控 rootDir(忽略 node_modules/.git/隐藏目录,depth 合理),事件去抖 300ms → 重新 readTree → `EvTreeChanged`;当前打开文件内容变化(add/change 且 path===session.openFile 不必判断,全部 change 事件转发 `EvFileChanged`)。
- settings.json / session.json 存 `app.getPath('userData')`,写入原子(先写 tmp 再 rename),读失败回默认值。
- 菜单:注册第 7 节加速键(菜单不可见也要 `Menu.setApplicationMenu`,Windows 下 hidden titlebar 无菜单栏,但加速键生效);另注册 F12/Ctrl+Shift+I 开 DevTools(仅 dev)。
- PDF:`ExportPdf` → 显示保存对话框(默认名 suggestedName + '.pdf')→ `webContents.printToPDF({printBackground:true, preferCSSPageSize:false, margins 默认})`。渲染器侧(D)导出前给 body 加 `.exporting-pdf` class……不,简化:主进程直接 printToPDF 当前页面,viewer.css 提供 `@media print`:隐藏 titlebar/sidebar/outline/findbar,正文全宽。
- `dialog:open`:file kind filter `[{name:'Markdown', extensions:['md','markdown','mdown','mkd','mdx']}]`。
- 外部修改弹窗逻辑在渲染器(C):未 dirty 自动重载 + toast;dirty 则 confirm。
- 删除一律 `shell.trashItem`。

## 10. 验收基线(集成后逐条过)

打开文件夹→树→点开文件→渲染正确(GFM 表格/任务列表/代码高亮/KaTeX/mermaid);大纲点击跳转+滚动高亮;Ctrl+P 模糊搜文件;Ctrl+F 查找计数;原文模式编辑→Ctrl+S 保存→渲染模式内容更新;主题切换全 UI 生效;缩放;设置持久化;重启恢复(目录、文件、滚动位置、窗口大小);外部改文件自动刷新;右键新建/重命名/删除;导出 PDF;拖拽 .md/文件夹到窗口打开;zh/en 界面。
