# Markdown Reader for Windows

> 不是又一个全能编辑器,只是一个安静的阅读器。
>
> [davidhoo/MarkdownReader](https://github.com/davidhoo/MarkdownReader)(macOS)的 Windows 移植版,Electron + TypeScript 实现。

## 功能

| 功能 | 说明 |
|------|------|
| 三栏布局 | 目录树 + 渲染视图 + 大纲导航,面板可拖拽调宽、可折叠 |
| GFM 渲染 | markdown-it:表格、任务列表、删除线、自动链接、脚注 |
| 代码高亮 | highlight.js,40+ 语言,配色跟随主题 |
| 数学公式 | KaTeX,行内 `$...$` 与块级 `$$...$$` |
| Mermaid 图表 | 本地渲染,流程图/时序图/甘特图等,明暗主题自动适配 |
| PlantUML | 经渲染服务器出 SVG(默认 plantuml.com,可换私有服务或禁用) |
| 本地图片 | 自定义 `mdr://` 协议加载文档相对路径图片,限制在打开目录内 |
| 33 套主题 | 与原版一致的 5 基色主题体系(20 深色 + 13 浅色),可跟随系统明暗 |
| 大纲导航 | 标题层级提取、点击跳转、滚动位置联动高亮 |
| 实时编辑 | 原文模式(CodeMirror 6),Ctrl+S 保存,脏标记,逐文件撤销栈 |
| 命令面板 | Ctrl+P 模糊搜索目录内文件 |
| 页内查找 | Ctrl+F,匹配计数、上一个/下一个、大小写开关 |
| 目录树操作 | 右键新建/重命名/删除(回收站)/在资源管理器中显示,内联改名 |
| 文件监控 | 外部修改自动刷新;目录结构变化自动更新树 |
| 会话恢复 | 记住上次目录、文件、滚动位置、窗口大小与布局 |
| PDF 导出 | Ctrl+Alt+E,打印背景、隐藏界面元素 |
| 多语言 | 简体中文 / 繁體中文 / English,跟随系统或手动指定 |
| 文件关联 | 安装版关联 .md/.markdown,双击即开;支持拖拽打开 |

## 快捷键

| 快捷键 | 功能 | | 快捷键 | 功能 |
|--------|------|-|--------|------|
| `Ctrl+O` | 打开文件 | | `Ctrl+Shift+E` | 渲染模式 |
| `Ctrl+Shift+O` | 打开文件夹 | | `Ctrl+Shift+R` | 原文(编辑)模式 |
| `Ctrl+N` | 新建文件 | | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 缩放 |
| `Ctrl+S` | 保存 | | `Ctrl+F` | 查找 |
| `Ctrl+Alt+E` | 导出 PDF | | `F3` / `Shift+F3` | 查找下/上一个 |
| `Ctrl+,` | 设置 | | `Ctrl+P` | 命令面板 |
| `Ctrl+\` | 侧栏开关 | | `Ctrl+Shift+\` | 大纲开关 |

## 开发

```bash
npm install        # 依赖(.npmrc 已配置 Electron 国内镜像)
npm run dev        # 开发模式(HMR)
npm run build      # 构建到 out/
npm run e2e        # Playwright 驱动真实应用的端到端测试(需先 build)
npm run dist       # 打包 NSIS 安装包 + 便携版到 dist/
```

## 架构

```
src/
├─ shared/     类型与 IPC 通道契约(main/preload/renderer 三方共享)
├─ main/       主进程:窗口、文件系统、chokidar 监控、mdr:// 协议、
│              设置/会话持久化、菜单加速键、PDF 导出、页内查找
├─ preload/    contextBridge 暴露 window.api(sandbox + contextIsolation)
└─ renderer/   无框架 DOM 渲染器
   ├─ state.ts / bus.ts     极简响应式 store + 事件总线
   ├─ markdown/             markdown-it 管线、mermaid、plantuml
   ├─ theme/                33 主题 + 派生算法(还原原版 5 基色 → 语义 token)
   ├─ components/           标题栏/文件树/大纲/阅读器/编辑器/查找/面板/设置
   └─ i18n/                 三语字典(自参考项目提取,191+ 键)
```

设计规格提取自参考项目,见 `design/`(主题色值、派生公式、渲染行为、UI 规格、i18n 全量文案)。

## 许可

MIT(参考项目同为 MIT)
