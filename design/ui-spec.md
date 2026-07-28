# MarkdownReader — UI Spec (extracted from macOS reference, for Windows Electron clone)

Source: `D:\claude\_ref_MarkdownReader` (SwiftUI, v2.2.1). All values in pt (macOS points) — treat 1pt = 1px CSS.
All colors are theme tokens (surface/ink/accent/success/danger + derived: bgElevated/bgSubtle/bgMuted/fgSecondary/fgMuted/accentHover/accentSoft/border/borderSubtle). Never hardcode; see theme-spec. Default themeId = `"buddy-dark"`.

---

## 1. Three-column layout & window chrome

### 1.1 Window

| Property | Value |
|---|---|
| Default size | 900 × 600 |
| Min size | 650 × 450 (`frame(minWidth: 650, minHeight: 450)`) |
| Title bar | Hidden system title bar (`hiddenTitleBar` + fullSizeContentView); frameless window on Windows |
| Window background | `bgSubtle` token |
| Window title (taskbar/OS) | `"Markdown Reader"`; dir open → `"Markdown Reader — <dirName>"`; single-file → `"Markdown Reader — <fileName>"`; unsaved untitled → `"Markdown Reader — <untitledFileName>"` |
| Traffic lights | Custom-drawn: 3 circles 12px diameter, spacing 8, colors systemRed/systemYellow/systemGreen; icons (xmark/minus/plus, 8px bold, black 50%) appear only on hover over the group; actions close/minimize/zoom. Leading padding 12. (Windows: replace with standard right-side min/max/close caption buttons; drop the traffic-light strip.) |
| Fullscreen | traffic-light reserve space 76px normal / 32px fullscreen (macOS-only detail) |

### 1.2 Column structure (normal mode)

`HStack(spacing: 0)`: **[Sidebar] [ResizeHandle 8px] [Detail (contains TitleBar + content + optional Outline)]**

Sidebar stays mounted always; hidden = width 0 + clipped + hit-testing off (avoids rebuild flicker).

| Panel | Default | Min | Max | Notes |
|---|---|---|---|---|
| Sidebar | 240 | 150 | 400 | Auto-hide threshold: drag below **140** → hide and reset width to 240. First launch: **hidden** (`isSidebarVisible=false`). Opening a directory forces it visible (restores 240 if width < 150). Opening a single file hides it. |
| Outline | 200 | 150 | 350 | Hidden by default (`isOutlineVisible=false`). Toggling visible resets width to 200. |
| Detail (content) | flexible | 400 | — | |

Resize behavior:
- Sidebar handle: 8px-wide invisible strip between sidebar and detail; cursor `resizeLeftRight` (ew-resize); mousedown/drag updates width live; on mouseup: `width < 140` → animate hide (spring 0.25s) + reset to 240; else clamp to [150,400].
- Outline handle: same, mirrored (drag left = wider); on release clamp to [150,350]; no auto-hide threshold.
- Sidebar/Outline toggle animation: spring, duration 0.25s. Settings-mode swap animation: easeInOut 0.2s.

### 1.3 Detail area visual

- Background `surface`; rounded corners **top-left 10, bottom-left 10 only** (right corners 0) — the detail "card" floats on the `bgSubtle` window background.
- Left edge outline: 1px stroke in `border` token following the two left rounded corners (LeftEdgeShape, radius 10).
- 1px horizontal rule in `border` under the TitleBar.
- Sidebar background: `bgSubtle`. Outline panel background: `surface` (visually part of detail card).

### 1.4 TitleBar (custom, inside Detail, height 50px, is a window-drag region)

Left → right:
1. **Only when sidebar hidden**: traffic lights (pad-left 12) + sidebar-toggle button (icon `sidebar.leading`, 14px, `fgSecondary`, pad-left 8, tooltip `"Toggle Sidebar (⌘\)"`) + open button (`folder.fill` 14px, tooltip `"Open (⌘O)"`, pad-left 4) + new-file button (`doc.badge.plus` 14px, tooltip `"New File"`, pad-left 4). (When sidebar is visible these three buttons + traffic lights live in the sidebar header instead.)
2. **File path** (when a document is open): full absolute path, 12px, `fgMuted`, 1 line, middle truncation, pad-left 12. Untitled docs show just the file name. Next to it a **copy-path button** (`doc.on.doc` 10px `fgMuted`, tooltip `"Copy Path"`, pad-left 2); on click copies path and shows a toast capsule top-center of titlebar for 1.5s: checkmark.circle.fill 11px + `"Path Copied"` 12px, `fgSecondary` on `surface` capsule, 1px `border` stroke, shadow black 15% r3 y1, fades/moves in 0.2s.
3. `Spacer`
4. **Display-mode segmented control** (see §9): 2 segments `"Rendered"` / `"Raw"` (zh-CN: `渲染` / `编辑`), width 140, pad-right 8. Hidden when no document or when file is plain-text (non-markdown .txt) mode.
5. **Action button group** (HStack spacing 8, pad-right 12, all icons 14px, plain buttons):
   - Reload `arrow.clockwise` in `accent` — only rendered when the open file was modified externally; tooltip `"Reload"`. Click: if dirty & !skipFileModifiedAlert → confirm dialog (title `"File Modified Externally"`, msg `"The file has been modified by another application. Reloading will discard your current changes."`, checkbox `"Don't remind me again"`, buttons Reload(destructive)/Cancel); else reload directly.
   - Save `arrow.down.doc.fill` — `accent` when dirty, `fgMuted` + disabled when clean; tooltip `"Save (⌘S)"`. **This is the dirty indicator in the title bar** (plus `*` in the file tree row).
   - Export PDF `square.and.arrow.up`, `fgMuted`, tooltip `"Export PDF"`.
   - Outline toggle `sidebar.right` — `accent` when outline visible, `fgSecondary` when doc open, `fgMuted`+disabled when no doc; tooltip `"Toggle Outline"`.

### 1.5 Sidebar header (height 50px, drag region)

Traffic lights (pad-left 12) → sidebar-toggle (`sidebar.leading`, pad-left 8) → open (`folder.fill`, pad-left 4) → new file (`doc.badge.plus`, pad-left 4). All 14px `fgSecondary` plain buttons. 1px `border` rule below (settings-mode sidebar only; normal sidebar has no rule).

### 1.6 Sidebar footer

Fixed Settings button: `gearshape` 14px + text `"Settings"` 13px, both `fgSecondary`, padding h12 v8, full-width hit area, tooltip `"Settings (⌘,)"`. Opens in-window settings mode.

### 1.7 UI chrome font sizes (summary)

| Element | Size |
|---|---|
| Titlebar path / toast text | 12 |
| Titlebar & sidebar icon buttons | 14 |
| File-tree row text, settings labels, palette filename | 13 |
| Outline rows | 13 / 12.5 / 12 / 11.5 by level |
| Section descriptions, hex values, find-bar buttons | 11 |
| Palette secondary path | 11 |
| Palette search input | 14 |
| Find-bar inputs | 12 monospace |

---

## 2. File tree (Sidebar)

### 2.1 Content & filtering

- Root: the opened directory itself is shown as the single top-level node (its name), **expanded by default**.
- Markdown-like extensions shown with markdown icon: `md, markdown, mdown, mkd, mkdown, txt` (`.txt` gets markdown icon in tree; on load its content is sniffed — heuristic scoring of headings/fences/links/lists, threshold ≥ 2 — non-markdown .txt opens in raw-only "plain text mode").
- "True markdown" set (used by palette / open routing / default-opener): `md, markdown, mdown, mkd, mkdown` (case-insensitive).
- Hidden files (dotfiles): excluded unless setting `showHiddenFiles` (default false).
- Non-markdown files: **shown greyed** by default (`showNonMarkdownFiles` default **true**); when false they are filtered out. Directories are always shown, including empty ones.
- Clicking a greyed non-markdown file shows an error view (unsupported type), not a crash.
- Live FS watching: whole tree auto-refreshes on external changes, preserving expansion set + selection; if root deleted → error message.

### 2.2 Sorting

Directories first, then files; within each group ascending `localizedStandardCompare` (Finder-style natural sort: case-insensitive, numeric-aware — implement with `String.prototype.localeCompare(b, undefined, {numeric:true, sensitivity:'base'})`).

### 2.3 Row rendering

HStack spacing 6, vertical padding 4, 1 line:
- Icon (16px frame): directory `folder.fill` colored `ink`; markdown file `doc.text` colored `fgSecondary`; other file `doc` colored `fgMuted`.
- Name: `ink` for dirs & markdown, `fgSecondary` for other files.
- Dirty marker: literal `*` in `accent` after name when file has unsaved edits.
- Right side: `macwindow` icon 10px `fgMuted` + tooltip `"Open in another window"` when file is owned by another window (multi-window; row height unchanged).
- Selection highlight (file rows and dir label rows): `accentSoft` fill, corner radius 6, insets left 28 / right 6 / vertical 2 (leaves the disclosure-chevron gutter unhighlighted).
- Directory rows use disclosure chevron (native DisclosureGroup); clicking anywhere on a directory row toggles expand/collapse. Clicking a file row selects it and loads it in detail.

### 2.4 Keyboard navigation (tree must be focused)

- `↑`/`↓`: move through the flattened list of *visible* nodes. Landing on a file selects+opens it. Landing on a directory toggles its expansion (quirk of reference impl: selection pointer doesn't advance onto directories since only files become `selectedFileURL`).
- `Enter`: on selected file → open; on directory → toggle expand.
- No type-ahead, no Left/Right collapse keys in reference (nice-to-have on Windows: ←/→ collapse/expand).

### 2.5 Context menus (exact labels en / zh-CN / zh-TW)

**Directory row** (order + separators):
1. `New File` / `新建文档` / `新增檔案` (icon doc.badge.plus) → create untitled file inside this dir
2. `New Subdirectory` / `新建子目录` / `新增子目錄` (folder.badge.plus)
3. ---
4. `Reveal in Finder` / `在访达中打开` / `在 Finder 中打開` (folder) → (Windows: "Show in Explorer")
5. ---
6. `Copy Path` / `复制路径` / `複製路徑` (doc.on.doc) → absolute path to clipboard
7. ---
8. `Rename` / `重命名` / `重新命名` (pencil)
9. `Move to…` / `移动到…` / `移動到…` (folder.and.arrow.down)
10. ---
11. `Move to Trash` / `移到废纸篓` / `移到垃圾桶` (trash)

**File row**:
1. `Reload` / `重新加载` / `重新載入` (arrow.clockwise) — disabled unless this file is the currently open one AND externally modified
2. `Copy Path`
3. ---
4. `Reveal in Finder`
5. ---
6. `New File` (creates in this file's parent dir)
7. ---
8. `Rename`
9. `Move to…`
10. ---
11. `Move to Trash`

### 2.6 File operations UX

- **New file**: name `Untitled.md`, on collision `Untitled 1.md`, `Untitled 2.md`, … Created empty, tree refreshes, new file auto-selected (opens). Toolbar new-file button behaves same (root dir; works even before saving — "untitled" docs exist in-memory until Cmd+S).
- **New subdirectory**: `New Folder`, `New Folder 1`, …; parent auto-expands.
- **Rename**: modal dialog (reference uses NSAlert, not inline row editing). Title `"Rename"`, message `Enter a new name for "{name}":`, text field 300×24 prefilled with full name; for files, the basename (without extension) is preselected. Buttons: `OK`(zh `确认`)=Enter default, `Cancel`(取消)=Esc. Validation: empty → `"Name cannot be empty."`; exists → `"An item with this name already exists."`. After rename: selection/expansion/open-document references are remapped.
- **Delete**: confirmation dialog, title `"Move to Trash"`, message file: `Are you sure you want to move "{name}" to the Trash?` dir: `Are you sure you want to move "{name}" and all its contents to the Trash?`; buttons `Move to Trash`(Enter) / `Cancel`(Esc). Sends to OS trash/Recycle Bin (recoverable), never permanent delete.
- **Move to…**: OS folder-picker (prompt `"Select Destination Folder"`) starting at root; rejects moving into itself/descendant; rejects if same name exists at target (`"An item with this name already exists."`).
- **Drag & drop**: no reordering inside the tree. Dropping files/folders from OS onto the window opens them (folder → new root; .md → open file; multiple URLs → first reuses window, rest open new windows; unsupported type → alert `Unsupported file type (.{ext}). Only Markdown files can be opened.`). While drag-hovering the detail area shows overlay: rounded-rect radius 8, `accent` stroke 2px, inset 4.
- Welcome hint also advertises drop: `"or drag a file or folder here"`.

### 2.7 Sidebar alternate states

- Loading: centered spinner + `"Loading..."` / `加载中...`
- Error: error view with message
- Empty dir (no md files anywhere): centered `folder` icon 32px `fgMuted` + `"No Markdown files in this directory"` / `该目录下无 Markdown 文件` (subheadline, `fgSecondary`)
- Single-file mode: list containing exactly one row (doc.text 14px + filename 13px + dirty `*`), selected style `accentSoft`.

---

## 3. Outline panel (right)

- Parses H1–H6 from ATX (`# x`) and Setext (`===`/`---`) headings; headings inside fenced code blocks are skipped. Data model: `{level, title, lineNumber}`.
- **Header**: `list.bullet.indent` icon 12px + `"Outline"` / `大纲` 12px semibold, both `fgMuted`, padding h12 v8, left-aligned; 1px divider below.
- **Rows** (LazyVStack spacing 0, list vertical padding 4): leading indent = `min(level−1, 5) × 14 + 8` px; then 4×4px circle bullet `fgMuted`; then title, left padding 6, vertical padding 4, right padding 8; 1 line, tail truncation.
  - Font size: H1 13, H2 12.5, H3 12, H4–H6 11.5.
  - Color: H1 `ink`, H2 `fgSecondary`, H3+ `fgMuted`.
  - Levels > 6 would not indent further (indent capped at 5 steps).
- **Active item (scrollspy)**: rendered view reports the topmost visible heading (`onVisibleHeadingChanged` → lineNumber); the row whose `lineNumber` matches gets `accentSoft` background, corner radius 4. Pressed state: `bgMuted`. (Reference has no hover fill despite the name — active + pressed only; adding a subtle hover on Windows is acceptable.)
- **Click**: request scroll-to-line(lineNumber) — rendered mode scrolls WebView to element with matching `data-line`; raw mode scrolls textarea to that line. Scroll request auto-clears (raw after 0.5s, rendered after 2.5s).
- **Empty state**: centered `text.badge.checkmark` icon 20px + `"No headings"` / `暂无标题` 11px, both `fgMuted`.
- Panel bg `surface`; toggled via titlebar button only (no keyboard shortcut in reference).

---

## 4. Command palette (Cmd/Ctrl+P) — file search only (no command mode)

### 4.1 Appearance

- Overlay: full-window `black @ 20%`; click outside closes. Fade in/out 0.15s.
- Panel: width **520**, horizontally centered, top offset **58px** from window top (just below the 50px titlebar). `surface` bg, corner radius 10, 1px `border` stroke, shadow black 20% radius 12 y 4.
- Search row: `magnifyingglass` 14px `fgMuted` + borderless TextField placeholder `"Search files by name…"` / `按名称搜索文件…` (14px) + clear button `xmark.circle.fill` 12px when text non-empty. Padding h12 v10. 1px divider below.
- Results (only when query non-empty): scroll list max-height **320**, max **20** results.
- Result row: `doc.text` 13px in 18px frame (selected `ink` else `fgSecondary`); column: filename 13px `ink` + relative path 11px `fgMuted` (middle truncation), vertical spacing 2; row padding h12 v7; selected row bg `accentSoft`.
- No-results state: `doc.text.magnifyingglass` 12px + `"No results found"` / `未找到结果` 13px `fgMuted`, padding v8 h12.
- Empty query: only the search box shows (no list).

### 4.2 Keyboard

- Search field auto-focused on open. `↑`/`↓` move selection with wrap-around both ends; selected row scrolls into view (centered, 0.1s ease). `Enter` opens selection; `Esc` closes; reopening resets query to "".

### 4.3 Search algorithm (fuzzy scoring; candidates = all *true-markdown* files under root, recursive, cached until root changes)

Lowercase query vs lowercase `fileName` and `relativePath`. First matching rule wins (if/else chain):

| Rule | Base | Bonus |
|---|---|---|
| relativePath == query | 1200 | — |
| relativePath startsWith query | 900 | + max(0, 100 − path.length) |
| fileName startsWith query | 1000 | + max(0, 100 − name.length) |
| fileName contains query | 500 | + max(0, 50 − matchIndex) |
| fileName fuzzy-subsequence | 300 | + maxConsecutiveRun×15 + max(0, 40 − firstMatchIndex) |
| relativePath contains query | 100 | + max(0, 30 − matchIndex) |
| relativePath fuzzy-subsequence | 80 | + maxConsecutiveRun×15 + max(0, 20 − firstMatchIndex) |
| no match | excluded | |

Then subtract `10 × pathDepth` (depth = number of `/` in relativePath); clamp matched scores at ≥ 0. Sort score desc, take 20. Fuzzy-subsequence = chars of query appear in order (skips allowed); track longest consecutive run and first match index (999 if none).

### 4.4 Direct-path opening (on Enter, before list selection)

- Query starting `/` or `~` (Windows: also drive letters `C:\`): if existing directory → open as root; if existing markdown file → open file.
- Otherwise resolved relative to current root: dir → open as root; markdown file → open.
- Files inside current root select in-tree; outside root route through window coordinator (may focus other window that owns the file).

---

## 5. Find / Replace bar

### 5.1 Placement & frame

Floating panel anchored **top-right of the document content area**: margins top 8, right 16. Width **400**, auto height. Appear/disappear: opacity + slide-from-top, easeInOut 0.2s.
Panel: `surface @ 95%` bg, corner radius 8, 1px `border` stroke, shadow black 20% radius 16 y 6, padding h8 v6.

### 5.2 Layout — 3 columns (top-aligned, spacing 6)

1. **Chevron column**: toggle button 16×24, icon `chevron.right` (collapsed) / `chevron.down` (expanded), 10px semibold `fgSecondary`. Toggles the replace row.
2. **Input column** (vertical, spacing 2 when expanded):
   - Search field: plain text input, 12px **monospace**, padding h6 v4, bg `bgSubtle`, radius 4, 1px border — `border` normally, `danger` when query non-empty and 0 matches. Right-overlaid match counter (see below). Enter ⇒ find next. Auto-focused on open.
   - Replace field (only when expanded): identical styling, placeholder `"Replace"` / `替换`.
   - Placeholders: `"Search"` / `搜索`.
3. **Button column**:
   - Row 1 (spacing 4): three option toggles + prev + next + close.
     - Option toggle: 24×22, text label 11px medium monospace, radius 3. Labels **`Aa`** (tooltip `"Match Case"` / `区分大小写`), **`W*`** (`"Match Whole Word"` / `全词匹配`), **`.*`** (`"Use Regular Expression"` / `使用正则表达式`). ON: text `accent` + bg `accent @ 15%`; OFF: text `fgMuted`, transparent.
     - Prev `chevron.up` 11px, Next `chevron.down` 11px, `fgSecondary`, disabled when 0 matches.
     - Close `xmark` 10px `fgMuted`.
   - Row 2 (only when expanded, height 24, spacing 4): `Replace` / `替换` and `Replace All` / `全部替换` buttons — text 11px, padding h6 v3, radius 3, 1px `border` outline, text `fgSecondary` in raw mode else `fgMuted`; **disabled unless raw mode AND matches > 0**.

### 5.3 Match counter

Overlaid right-inside search field, 11px, pad-right 6, only when query non-empty: `"{current}/{total}"` with current 1-based (e.g. `3/15`) in `fgMuted`; when 0 matches: localized `"No results"` / `无结果` in `danger`.

### 5.4 Search behavior

- Live re-search on every change of query or any option toggle.
- Implemented via regex: non-regex mode escapes the query; whole-word wraps `\b…\b`; case-insensitive flag unless `Aa` on. Invalid regex → silently zero results (danger outline). Matches computed over the raw markdown source in both modes.
- Navigation wraps modulo total (next from last → first). After re-search current index is clamped, not reset.
- Raw mode: all matches highlighted in editor (background tint), current match selected & scrolled to. Rendered mode: highlights driven by query params in webview; navigation scrolls to the source line of current match.
- Replace / Replace All: raw mode only; performs replacement in the text editor, updates document content (marks dirty), then re-runs search. No `$1` backreference support.
- Close (`Esc` or ×): clears highlights AND resets all state — query, replace text, all three option toggles, expansion collapse.

### 5.5 Shortcuts

Open find `Cmd+F`; open find-with-replace-expanded `Cmd+Option+F`; next `Cmd+G`; prev `Cmd+Shift+G`; `Esc` close. Find Next/Prev when bar closed re-opens it and searches.

---

## 6. Settings — complete field inventory (SettingsModel.swift)

Presentation: **in-window mode**, not a dialog. Left column swaps to settings nav (same width as sidebar, `bgSubtle` bg): 50px header w/ traffic lights + 1px rule; back button `‹ Back to App` (chevron 11px semibold + 12px text, `fgSecondary`, padding 16); nav items `General`(gearshape) / `Appearance`(paintbrush) — 13px text + 13px icon in 18px frame, selected: `ink` text + `accentSoft` bg radius 6, else `fgSecondary`; item padding h12 v6 inside, h8 v2 outside. Right column: scrollable content card with same left-rounded-10 + border styling as detail; content column min 480 / max 896 wide, centered, outer padding 40, inner section container padding 24. Section = title 13px semibold `ink` + optional description 11px `fgMuted` + control, vertical spacing 8; sections separated by 1px `border` rule with 12px vertical margins. Entered via Cmd+, or sidebar Settings button; exit via back button or Cmd+, again; state swap animated 0.2s.

Persistence: every field writes through to storage immediately on change (UserDefaults keys `com.markdownreader.<name>`; clone: JSON settings file / electron-store).

### 6.1 All persisted fields (20) + runtime (1)

| # | Field (storage key suffix) | Type | Allowed values / range | Default | UI control |
|---|---|---|---|---|---|
| 1 | `languagePref` | enum | `auto` \| `zh-CN` \| `zh-TW` \| `en` | `auto` | General → "Language": dropdown (menu) width 200. Auto entry renders as `Auto / Auto Detect (<detected language name>)`. Auto resolution: system lang zh-Hant or region TW/HK/MO → zh-TW; other zh → zh-CN; else en. |
| 2 | `defaultDisplayMode` | enum DisplayMode | `rendered` \| `raw` — **warning: reference persists Chinese rawValues `"渲染"`/`"编辑"`**; clone should store `"rendered"`/`"raw"` | `rendered` | General → "Default display mode": segmented control width 200, labels Rendered/Raw |
| 3 | `maxContentWidthFollowsWindow` | Bool | — | `false` | General → "Rendered Width" section, checkbox `"Follow window width"`; desc `"Control the maximum width of rendered content. When off, a fixed width is used."` Off = rendered content max-width fixed **980px** |
| 4 | `reopenLastLocation` | Bool | — | `false` | General → "Startup": checkbox `"Reopen last location on launch"` |
| 5 | `showHiddenFiles` | Bool | — | `false` | General → "File Tree": checkbox `"Show hidden files"`; change reloads tree |
| 6 | `showNonMarkdownFiles` | Bool | — | `true` | General → "File Tree": checkbox `"Show non-Markdown files"`; change reloads tree |
| 7 | `isDefaultMdOpener` | Bool (derived, cached) | — | live-detected from OS | General → "Default Markdown Opener": if true → green `checkmark.circle.fill` + text `"Markdown Reader is the default Markdown opener"` (12px); else button `"Set as Default"` with spinner while working and failure alert `"Failed to set as default opener. Please try again."` Registers `.md .markdown .mdown .mkd` |
| 8 | `enableQuickLookPreview` | Bool | — | `true` | General → "Quick Look Preview": checkbox. macOS-only; omit on Windows or repurpose |
| 9 | `enableCommandLine` | Bool (derived: is `mdr` installed) | — | detected (`/usr/local/bin/mdr` exists) | General → "Command Line Tool": checkbox (label switches to `"mdr command is available in Terminal"` when on) + progress spinner; install/uninstall with failure alerts. Windows analog: add CLI to PATH |
| 10 | `skipFileModifiedAlert` | Bool | — | `false` | **No direct settings row** — set by "Don't remind me again" checkbox inside the external-modification reload confirm |
| 11 | `appearanceMode` | enum | `light` \| `dark` \| `system` | `system` | Appearance → "Theme": 3 selectable cards in a row (spacing 12): icons sun.max / moon / desktopcomputer 16px, title 13px medium, desc 11px (`"Always use light appearance"` / `"Always use dark appearance"` / `"Follow system setting"`), card radius 12, padding 16, radio circle 12px top-right; selected: `accent` 2px border + extra `accent@30%` 3px ring; unselected 1px `border` |
| 12 | `themeId` | String | one of 33 preset ids (20 dark + 13 light; only those matching current light/dark type are listed) | `"buddy-dark"` | Appearance → "Color Scheme": **8-column grid**, spacing 8. Card: theme.surface bg, radius 6, mini preview bar 24px tall (accent 6px dot + ink@50% 18×2 line), theme name 10px in theme.ink; selected: `accent` 2px border + `accent@15%` wash + 8px check dot; unselected 0.5px border |
| 13 | `themeCustomOverrides` | struct (JSON) | `{surface?, ink?, accent?, success?, danger?: "#RRGGBB", contrast?: Int}` | empty | Appearance → "Custom Colors": 5 rows (Surface/Ink/Accent/Success/Danger; zh 背景色/文字色/强调色/成功色/危险色). Row = 24×24 swatch button (radius 4, 0.5px ink@15% border) opening native color picker (continuous live-preview, no alpha) + label 13px + clickable hex value 11px monospace uppercase (click → inline TextField width 72; submit validates exactly 6 hex digits, stores `#`+uppercase) + reset button `arrow.counterclockwise` 10px **only when that token is overridden**. **Selecting any preset scheme clears all overrides** |
| 14 | (part of overrides) `contrast` | Int | 0–100 | from theme definition | Appearance → "Contrast": slider 0–100 + row below: `"Low"` … live numeric value (caption monospace) … `"High"`; affects derived tokens live |
| 15 | `sourceFontSize` | Int | 10–24 (clamped) | `13` | Appearance → "Typography": stepper labeled `"{n} pt"`, row label `"Source font size"`; applies to raw editor |
| 16 | `contentPadding` | Int | 8–40 (clamped) | `20` | Appearance → "Typography": stepper `"{n} pt"`, label `"Content padding"`; applies to rendered view padding AND raw editor padding |
| 17 | `lastOpenedDirectory` | path? | — | nil | no UI; validated (must exist) on load |
| 18 | `lastOpenedFile` | path? | — | nil | no UI; validated on load. Only the last-active window writes 17/18 |
| 19 | `recentItems` | array [{url, isDirectory, timestamp}] | max 10, deduped by url, newest first, dead paths pruned on load | `[]` | File ▸ `"Open Recent"` submenu: sections `Files` / `Folders`, empty state `"No Recent Items"`, footer `"Clear Menu"` |
| 20 | `skippedVersion` / `lastUpdateCheckTime` | String? / Date? | — | nil | auto-update bookkeeping (no settings UI) |
| 21 | `systemIsDark` | Bool (runtime only) | — | OS state | not persisted; drives `system` appearance resolution |

Settings section order — General: Language, Default display mode, Rendered Width, Startup, File Tree, Default Opener, Quick Look, Command Line Tool. Appearance: Theme mode, Color Scheme, Custom Colors, Contrast, Typography.

---

## 7. Welcome / empty states

**Welcome (no directory & no file open)** — centered VStack spacing 16 on `surface`:
1. `folder` icon 48px `fgMuted`
2. `"Open a folder to get started"` — title2 (~22px) `ink`  (zh-CN `打开文件夹开始阅读`, zh-TW `開啟資料夾開始閱讀`)
3. `"Press Cmd+O or click Open in toolbar"` — subheadline (~11px) `fgSecondary` (zh-CN `按 Cmd+O 或点击工具栏中的打开按钮`) — Windows: say Ctrl+O
4. `"or drag a file or folder here"` — subheadline `fgMuted` (zh-CN `或拖拽文件/文件夹到此处`)
5. Button `"Open"` / `打开` — prominent (accent-filled), large control size, margin-top 8 → opens OS file/folder picker (accepts directory or .md file)

**Directory open, nothing selected**: centered `doc.text` 36px `fgMuted` + `"Select a file to preview"` / `选择文件以预览` subheadline `fgSecondary` (spacing 12).

**Empty directory** (detail area): `folder` icon + `"No Markdown files in this directory"`.

**Load error**: `exclamationmark.triangle` icon + localized error description (permission denied / encoding error / not found / unsupported type).

**Loading**: centered spinner (only when no document already shown).

---

## 8. Keyboard shortcuts (full menu map) + proposed Windows mapping

| macOS | Menu | Action | Windows proposal |
|---|---|---|---|
| Cmd+N | File ▸ New File | create untitled doc in current window | Ctrl+N |
| Cmd+Shift+N | File ▸ New Window | new blank window | Ctrl+Shift+N |
| Cmd+O | File ▸ Open… | OS picker (dir or .md) | Ctrl+O |
| — | File ▸ Open Recent ▸ (Files/Folders/Clear Menu) | reopen recent | — (same submenu) |
| Cmd+S | File ▸ Save | save current doc | Ctrl+S |
| Cmd+Shift+S | File ▸ Save As… | save panel | Ctrl+Shift+S |
| Cmd+Option+E | File ▸ Export PDF… | export current doc as PDF | Ctrl+Alt+E |
| Cmd+W | File ▸ Close Window | close (with unsaved-untitled guard) | Ctrl+W |
| Cmd+, | App ▸ Settings… | toggle in-window settings | Ctrl+, |
| — | App ▸ Check for Updates… | update check | — |
| — | App ▸ About Markdown Reader | about panel | — |
| Cmd+\ | View ▸ Toggle Sidebar | show/hide sidebar | Ctrl+\ |
| Cmd+P | View ▸ Command Palette | file-search palette | Ctrl+P |
| Cmd+Shift+E | View ▸ Rendered | switch to rendered mode | Ctrl+Shift+E |
| Cmd+Shift+R | View ▸ Raw | switch to raw mode | Ctrl+Shift+R |
| Cmd+= ("+") | View ▸ Zoom In | zoom step up (range 0.3–3.0, persists per session, restored on reload) | Ctrl+= |
| Cmd+- | View ▸ Zoom Out | zoom step down | Ctrl+- |
| Cmd+0 | View ▸ Actual Size | reset zoom to 1.0 | Ctrl+0 |
| Cmd+F | Find ▸ Find… | open find bar | Ctrl+F |
| Cmd+G | Find ▸ Find Next | next match | F3 (also keep Ctrl+G) |
| Cmd+Shift+G | Find ▸ Find Previous | previous match | Shift+F3 (also Ctrl+Shift+G) |
| Cmd+Option+F | Find ▸ Find and Replace… | find bar with replace row | Ctrl+H |
| Cmd+? (Cmd+Shift+/) | Help ▸ Markdown Reader Help | open help URL | F1 |
| — | Window ▸ Minimize / Zoom / Bring All to Front | window mgmt | system menu |

Non-menu keys: `Esc` closes palette / find bar; `Enter` submits palette selection & find-next & tree-open; `↑↓` navigate tree & palette. Menu items acting on a window are disabled when no window focused.
Note macOS "Cmd+," settings toggle; on Windows also expose via gear button. All shortcut hints baked into strings (`⌘O`, `⌘S`, `⌘\`, `⌘,`, "Press Cmd+O …") must be re-rendered as Ctrl forms in the clone.

---

## 9. Rendered / Raw display-mode toggle

- Control: segmented picker in titlebar, exactly 2 segments — `"Rendered"` | `"Raw"` (zh-CN `渲染` | `编辑` i.e. "Edit", zh-TW `渲染` | `編輯`), fixed width 140, right-aligned before action buttons.
- Visible only when a document is open; hidden entirely for plain-text-mode files (non-markdown `.txt` — those are raw-only).
- Default mode for each newly opened file = settings `defaultDisplayMode` (rendered by default). Per-file mode memory is intentionally **not** implemented (MD-04 ❌).
- Switching modes syncs position: raw→rendered uses current cursor/visible line to scroll rendered view to that `data-line`; rendered→raw uses last visible rendered line to place the raw scroll (MD-15 ✅). 
- Raw mode = editable plaintext editor: monospace font (`SF Mono` → Windows: `Consolas`/`Cascadia Mono`), font size = `sourceFontSize` (10–24, default 13), padding = `contentPadding`, word-wrap always on (no horizontal scrollbar), regex-based markdown syntax highlighting, per-file undo stacks, no line numbers. Edits mark doc dirty; Cmd/Ctrl+S saves.
- Rendered mode = webview: cmark-gfm→HTML with `data-line` + heading ids; GFM tables/task-lists/strikethrough; Mermaid (local, theme-synced), PlantUML (network, SVG), KaTeX (`$..$`, `$$..$$`), Prism highlight; images/CSS/JS via custom scheme; link clicks open external browser; links to local markdown files open in-app (routed like tree clicks); text selectable; content max-width 980px unless `maxContentWidthFollowsWindow`; padding = `contentPadding`.
- Menu shortcuts Cmd+Shift+E / Cmd+Shift+R switch modes directly (not a toggle).
- Both views stay mounted; raw editor is kept alive invisibly in rendered mode (preserves undo history), rendered webview instantiated only in rendered mode.

---

## 10. Misc interaction constants

| Thing | Value |
|---|---|
| Sidebar show/hide, outline show/hide animation | spring 0.25s |
| Settings mode swap, find-bar fade, path-copied toast | easeInOut 0.2s |
| Palette fade | easeOut 0.15s |
| Palette selection scroll | easeInOut 0.1s |
| Path-copied toast lifetime | 1.5s |
| Recent items cap | 10 |
| Palette results cap | 20 |
| Fixed rendered max content width | 980px |
| Zoom range | 0.3 – 3.0, reset = 1.0 |
| Dirty markers | `*` accent in tree row; save icon accent; unsaved-untitled reflected in window title |
| Unsaved-changes dialog | title `"Unsaved Changes"`, msg `"Your changes will be lost if you don't save them. Do you want to save before closing?"`, buttons Save / Don't Save / Cancel |
| File deleted externally w/ unsaved edits | dialog `"File Deleted"` — `The file "{name}" was deleted externally. You have unsaved changes.` buttons `Save As…`(default) / `Discard Changes` |
