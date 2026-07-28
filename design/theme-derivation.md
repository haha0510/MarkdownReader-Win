# Theme Derivation Spec (from macOS MarkdownReader)

Source of truth (reference repo, read-only):
- `Sources/MarkdownReaderKit/Models/ThemeDefinition.swift` — base model + 33 presets + custom overrides + resolution
- `Sources/MarkdownReaderKit/Services/ThemeColors.swift` — token derivation (`ThemeColors.from`), CSS var emission, syntax-highlight CSS
- `Sources/MarkdownReaderKit/Extensions/ColorExtensions.swift` — hex parsing, perceived brightness, NSColor blend wrapper
- `Sources/MarkdownReader/Resources/css/markdown.css` + `css/scroll.css` — where the emitted CSS variables are consumed

---

## 1. Base model: `ThemeDefinition`

Every theme = **5 base colors + 1 contrast int + 7 optional typography strings**:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | stable id, e.g. `"buddy-dark"` |
| `name` | string | display name, e.g. `"Default Dark"` |
| `type` | `"light"` \| `"dark"` | declared theme type (in `themes.json` exported as `dark: boolean`) |
| `surface` | hex string | page/background color |
| `ink` | hex string | body text color |
| `accent` | hex string | accent / link color |
| `success` | hex string | success green |
| `danger` | hex string | danger red |
| `contrast` | int 0–100 | contrast level; feeds every derived token (see §4) |
| `bodyFontFamily` | string? | CSS font-family raw value; `null`/absent = use markdown.css default |
| `headingFontFamily` | string? | same |
| `codeFontFamily` | string? | same |
| `bodyFontSize` | string? | e.g. `"18px"` |
| `lineHeight` | string? | e.g. `"1.555"`, `"1.75rem"`, `"1.5em"` |
| `letterSpacing` | string? | e.g. `"-0.003em"`, `"-1.5px"`, `"0"` |
| `borderRadius` | string? | none of the 33 presets set this |

### Presets (33 total; ordering matters — see `themes.json`)

- `darkThemes` array: 20 entries — indices 0–14 native dark, 15–19 MPE dark (ids prefixed `mpe-`).
- `lightThemes` array: 13 entries — indices 0–7 native light, 8–12 MPE light.
- `allThemes = darkThemes + lightThemes` (dark first, exactly the order in `themes.json`).
- Default theme per mode: `darkThemes[0]` = `buddy-dark`, `lightThemes[0]` = `buddy-light`.
- Lookup: by exact `id`; list per type returns the corresponding array.
- App-wide fallback (Environment default) = `buddy-dark`.

### Hex parsing (`Color(hex:)`)

1. Trim whitespace/newlines; strip all `#`.
2. 3-digit form is expanded by doubling each char (`"1af"` → `"11aaff"`).
3. Must then be exactly 6 hex digits, parsed as one 24-bit int; otherwise parse fails (`nil`).
4. Channels: `r = (v >> 16) & 0xFF`, `g = (v >> 8) & 0xFF`, `b = v & 0xFF`; component = `x / 255.0` (sRGB, alpha 1).
5. On parse failure `ThemeColors.from` falls back to: surface→black, ink→white, accent→blue, success→green, danger→red (never happens for presets; only relevant if user-supplied custom hex is invalid — validate input instead).

### Custom overrides (`ThemeCustomOverrides`) and resolution

User customization stores **only** the overridden fields (all 13 value fields nullable: `surface, ink, accent, success, danger, contrast, bodyFontFamily, headingFontFamily, codeFontFamily, bodyFontSize, lineHeight, letterSpacing, borderRadius`). Resolution is field-by-field:

```
resolved.field = custom.field ?? base.field      // for every field; id/name/type always from base
```

`isCustomized` = any of the 13 fields non-null. The Settings "contrast" slider is a continuous 0–100 slider whose value is truncated to Int and written to `custom.contrast` (reads show the resolved value).

---

## 2. Color math primitives (must match exactly)

All math is per-channel linear interpolation on **sRGB components in 0..1** (NOT HSL, NOT gamma-corrected linear light):

```
mix(a, b, f)      = per channel: a*(1 - f) + b*f          // Swift Color.mixed(with:fraction:)
lighter(x, amt)   = mix(x, white(#ffffff), amt)
darker(x, amt)    = mix(x, black(#000000), amt)
opacity(x, a)     = same RGB, alpha = a
perceivedBrightness(x) = 0.299*r + 0.587*g + 0.114*b       // components 0..1
```

### Serialization (exact)

- `cssHex(color)` → `#%02x%02x%02x` (lowercase), each channel = `Int(component * 255)` — **truncation toward zero, not rounding**. Alpha is **discarded**.
- `cssRGBA(color)` → `rgba(R, G, B, A)` where R/G/B = truncated ints as above and `A` = alpha formatted `%.2f` (2 decimals, round-to-nearest), e.g. `rgba(232, 232, 227, 0.71)`. Opaque colors serialize with `1.00`.

TypeScript parity for a mixed channel (given 0–255 ints `av`, `bv`):

```ts
const ch = Math.trunc(((av / 255) * (1 - f) + (bv / 255) * f) * 255);
```

Keep this exact op order/truncation if bit-exact parity with the Mac app is desired; `Math.round` differs by ±1 on many channels. Straight base colors round-trip losslessly (e.g. `#18181a` in → `#18181a` out).

### `NSColor.blended(withFraction: f, of: other)` (used ONLY in syntax-highlight CSS, §5)

Semantics: `(1-f)*self + f*other`, but Apple performs it after converting to its calibrated/generic RGB space (different gamma than sRGB), so results can differ from a plain sRGB lerp by a few units per channel. For the clone, implement it as plain sRGB `mix(self, other, f)` — visually indistinguishable; exact Mac parity is not achievable cross-platform for these few syntax colors.

---

## 3. Derived tokens — `ThemeColors.from(theme)`

Inputs: `c = contrast / 100.0` (Double), `isDark = (theme.type == "dark")` (**declared type**, not computed brightness). `surface/ink/accent/success/danger` pass through unchanged.

Full token list and exact formulas:

| Token | CSS var | Format | Dark formula | Light formula |
|---|---|---|---|---|
| `surface` | `--surface` | hex | passthrough | passthrough |
| `ink` | `--ink` | hex | passthrough | passthrough |
| `accent` | `--accent` | hex | passthrough | passthrough |
| `success` | `--success` | hex | passthrough | passthrough |
| `danger` | `--danger` | hex | passthrough | passthrough |
| `bgElevated` | `--bg-elevated` | hex | `mix(surface, ink, 0.08 + c*0.08)` | `mix(surface, ink, 0.16 + c*0.12)` |
| `bgSubtle` | `--bg-subtle` | hex | `mix(surface, ink, 0.02 + c*0.02)` | `mix(surface, ink, 0.08 + c*0.08)` |
| `bgMuted` | `--bg-muted` | hex | `mix(surface, ink, 0.04 + c*0.03)` | `mix(surface, ink, 0.12 + c*0.10)` |
| `fgSecondary` | `--fg-secondary` | rgba | `opacity(ink, 0.65 + c*0.10)` | same as dark |
| `fgMuted` | `--fg-muted` | rgba | `opacity(ink, 0.42 + c*0.13)` | `opacity(ink, 0.45 + c*0.10)` |
| `accentHover` | `--accent-hover` | hex | `lighter(accent, 0.12)` = `mix(accent, #ffffff, 0.12)` | `darker(accent, 0.08)` = `mix(accent, #000000, 0.08)` |
| `accentSoft` | `--accent-soft` | rgba (alpha 1.00) | `mix(#000000, accent, 0.20 + c*0.08)` — note base is **pure black**, not surface | `mix(surface, accent, 0.11 + c*0.04)` |
| `border` | `--border` | rgba | `opacity(ink, 0.06 + c*0.04)` | same as dark |
| `borderSubtle` | `--border-subtle` | rgba | `opacity(ink, 0.04 + c*0.02)` | same as dark |

Notes:
- `accentSoft` is an **opaque** color (serialized `rgba(r, g, b, 1.00)`); the rgba-vs-hex split above is purely how the app emits CSS, keep it for parity.
- Tokens depending on contrast `c`: `bgElevated, bgSubtle, bgMuted, fgSecondary, fgMuted, accentSoft, border, borderSubtle` (+ syntax `comment` via `fgMuted`). Independent of `c`: the 5 base colors and `accentHover` and all other syntax colors.
- Typography fields (`bodyFontFamily` … `borderRadius`) are carried through unchanged as optional strings.

### Emitted CSS custom properties block (exact template)

The app injects a `<style id="mr-theme-style">` element (theme block replaces any markdown.css defaults because it comes later in the cascade):

```css
:root {
  --surface: #rrggbb;
  --ink: #rrggbb;
  --accent: #rrggbb;
  --success: #rrggbb;
  --danger: #rrggbb;
  --bg-elevated: #rrggbb;
  --bg-subtle: #rrggbb;
  --bg-muted: #rrggbb;
  --fg-secondary: rgba(r, g, b, a);
  --fg-muted: rgba(r, g, b, a);
  --accent-hover: #rrggbb;
  --accent-soft: rgba(r, g, b, 1.00);
  --border: rgba(r, g, b, a);
  --border-subtle: rgba(r, g, b, a);
  /* each of the following lines only present when the theme defines it: */
  --font-body: <bodyFontFamily>;
  --font-heading: <headingFontFamily>;
  --font-code: <codeFontFamily>;
  --font-size-base: <bodyFontSize>;
  --line-height: <lineHeight>;
  --letter-spacing: <letterSpacing>;
  --border-radius: <borderRadius>;
}
```

### markdown.css defaults for absent typography vars

```css
--font-body:  -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
--font-heading: (same stack as --font-body);
--font-code:  "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
--font-size-base: 16px;
--font-size-code: 14px;      /* fixed; not theme-controllable */
--line-height: 1.6;
--heading-line-height: 1.3;  /* fixed */
--letter-spacing: 0;
--border-radius: 6px;
```

Also used by markdown.css but injected by the renderer (not the theme system): `--content-max-width` (fallback `980px`) and `--content-padding` (no fallback).

---

## 4. Worked example — `buddy-dark` (surface `#18181a`, ink `#e8e8e3`, accent `#339cff`, success `#40c977`, danger `#fa423e`, contrast 60 ⇒ c = 0.6, dark)

Exact emitted values (verified against the truncation rule):

```
--surface:        #18181a
--ink:            #e8e8e3
--accent:         #339cff
--success:        #40c977
--danger:         #fa423e
--bg-elevated:    #323233        (f = 0.128)
--bg-subtle:      #1e1e20        (f = 0.032)
--bg-muted:       #242425        (f = 0.058)
--fg-secondary:   rgba(232, 232, 227, 0.71)   (0.65 + 0.06)
--fg-muted:       rgba(232, 232, 227, 0.50)   (0.42 + 0.078 = 0.498 → "0.50")
--accent-hover:   #4ba7ff        (mix with white, 0.12)
--accent-soft:    rgba(12, 38, 63, 1.00)      (mix(black, accent, 0.248))
--border:         rgba(232, 232, 227, 0.08)   (0.084 → "0.08")
--border-subtle:  rgba(232, 232, 227, 0.05)   (0.052 → "0.05")
```

---

## 5. Syntax-highlight CSS (`codeHighlightCSS`) — Prism.js token colors

Injected alongside the theme vars; its `pre` rule **overrides** markdown.css's `pre { background: var(--bg-elevated) }`.

`isDarkCode = perceivedBrightness(surface) < perceivedBrightness(ink)` — computed from colors here, **not** the declared type (agrees with declared type for all 33 presets).

Color derivations (`mix` = sRGB lerp; items marked ⚠blended use `NSColor.blended` — implement as plain `mix`, see §2):

| Name | Dark (`isDarkCode`) | Light |
|---|---|---|
| `codeFg` | hex of `opacity(ink, 0.85)` — **alpha is discarded by cssHex, so effectively = ink hex** | hex of `opacity(ink, 0.88)` — same quirk, = ink hex |
| `codeBg` | `mix(surface, ink, 0.06)` | `mix(surface, ink, 0.04)` |
| `keyword` | `accent` (hex) | same |
| `string` | `lighter(success, 0.15)` = `mix(success, #ffffff, 0.15)` | ⚠blended `mix(success, ink, 0.15)` |
| `number` | ⚠blended `mix(accent, danger, 0.25)` | same |
| `comment` | `cssRGBA(fgMuted)` (semi-transparent ink, contrast-dependent) | same |
| `functionName` | ⚠blended `mix(accent, ink, 0.4)` | same |
| `variable` | ⚠blended `mix(ink, success, 0.15)` | same |
| `className` | `success` (hex) | same |
| `tag` | ⚠blended `mix(accent, success, 0.4)` | same |
| `attr` | ⚠blended `mix(accent, danger, 0.3)` | same |
| `deleted` | `danger` (hex) | same |
| `inserted` | `success` (hex) | same |
| `builtin` | ⚠blended `mix(accent, ink, 0.3)` | same |

Exact emitted CSS template:

```css
pre { color: <codeFg>; background: <codeBg>; }
.token.keyword { color: <keyword>; font-weight: 600; }
.token.string, .token.regex { color: <string>; }
.token.number { color: <number>; }
.token.comment, .token.block-comment, .token.doc-comment { color: <comment>; font-style: italic; }
.token.function, .token.function-name { color: <functionName>; }
.token.variable, .token.constant, .token.property { color: <variable>; }
.token.class-name { color: <className>; }
.token.tag { color: <tag>; }
.token.attr-value, .token.attribute { color: <attr>; }
.token.deleted { color: <deleted>; }
.token.inserted { color: <inserted>; }
.token.boolean { color: <keyword>; font-weight: 600; }
.token.builtin { color: <builtin>; }
.token.operator, .token.punctuation { color: <codeFg>; }
```

buddy-dark sRGB-lerp reference values: codeFg `#e8e8e3`, codeBg `#242426`, keyword `#339cff`, string `#5cd18b`, number ≈`#6485ce`, functionName ≈`#7bbaff`, variable ≈`#cee5d2`, className `#40c977`, tag ≈`#38aec9`, attr ≈`#6f81c5`, builtin ≈`#69b3ff`, comment `rgba(232, 232, 227, 0.50)` (≈ = blended-based, few-units tolerance vs Mac).

---

## 6. Token consumption map (semantic usage)

### 6a. Rendered markdown (WebView, `markdown.css`)

| Element | Rule |
|---|---|
| `body` | `color: var(--ink); background: var(--surface); font-family: var(--font-body); line-height: var(--line-height); letter-spacing: var(--letter-spacing)`; `html { font-size: var(--font-size-base) }` |
| `.markdown-preview` | `max-width: var(--content-max-width, 980px); margin: 0 auto; padding: var(--content-padding)` |
| `h1–h6` | `color: var(--ink)`; `font-family: var(--font-heading)`; weight 600; `line-height: var(--heading-line-height)`; margins 24px top / 16px bottom; h1 `2em` + `border-bottom: 1px solid var(--border)` + `padding-bottom: .3em`; h2 `1.5em` + same border; h3 `1.25em`; h4 `1em`; h5 `.875em`; h6 `.85em` + `color: var(--fg-muted)` |
| link `a` | `color: var(--accent)`, no underline; `a:hover` → `color: var(--accent-hover)` + underline |
| inline `code` | `background: var(--bg-muted); border-radius: var(--border-radius); font: var(--font-size-code) var(--font-code); padding: .2em .4em` |
| `pre` (code block bg) | markdown.css: `background: var(--bg-elevated); border: 1px solid var(--border); border-radius: calc(var(--border-radius) + 2px); padding: 16px; line-height 1.5` — background/color then overridden by codeHighlightCSS `pre { color: codeFg; background: codeBg }` (border stays) |
| copy button `.mr-copy-btn` | `color: var(--fg-muted)`; hover `background: var(--bg-muted); color: var(--ink)`; active `background: var(--border)`; copied state `color: var(--success)`; hidden until `pre:hover` (opacity 0→1, 0.2s) |
| `blockquote` | `color: var(--fg-secondary); border-left: 4px solid var(--border); padding: 0 1em` |
| table | `th, td`: `border: 1px solid var(--border); padding: 6px 13px`; `th`: `background: var(--bg-elevated)`, weight 600; `tr`: `background: var(--surface); border-top: 1px solid var(--border)`; even rows `tr:nth-child(2n)`: `background: var(--bg-subtle)` |
| `hr` | `height: 1px; background: var(--border); margin: 24px 0` |
| `img` | `border-radius: var(--border-radius)` |
| `del` | `color: var(--fg-muted)` |
| checkbox | `accent-color: var(--accent)`; checked: border+background `var(--accent)`; 14px, scale(1.15) |
| mermaid/plantuml container | `background: var(--bg-elevated); border: 1px solid var(--border); border-radius: calc(var(--border-radius) + 2px); padding: 16px` |
| mermaid/plantuml error | hardcoded: `border: 1px solid #e74c3c; background: rgba(231, 76, 60, 0.08); color: #e74c3c` |
| plantuml loading text | `color: var(--fg-muted)` |
| `mark` | `background: var(--accent-soft); color: var(--ink); border-radius: calc(var(--border-radius) - 3px)` |
| footnotes block | `color: var(--fg-secondary); border-top: 1px solid var(--border)`; ref links `var(--accent)`; backref `var(--fg-muted)` → hover `var(--accent)` |
| admonitions | base: `border-left: 4px solid var(--accent); background: var(--accent-soft); border-radius: var(--border-radius)`; title `color: var(--ink)` weight 600. Variants: note/important → accent + accent-soft; tip → `border-left-color: var(--success); background: var(--bg-subtle)`; warning → `border-left-color: #e0a800` (hardcoded) + bg-subtle; caution → `border-left-color: var(--danger)` + bg-subtle |
| in-page search highlight | `.mr-search-highlight`: `background: rgba(255, 166, 0, 0.3)` (hardcoded orange), radius 2px; current match `.mr-search-current`: `rgba(255, 166, 0, 0.6)` |

### 6b. `scroll.css`

| Element | Rule |
|---|---|
| scrollbar | `::-webkit-scrollbar` 8px wide/high; track transparent; thumb `background: var(--border)`, radius 4px; thumb hover `background: var(--fg-muted)` |
| text selection | `::selection { background: var(--accent-soft); color: var(--ink) }` |
| outline jump highlight | `.outline-highlight { background: var(--accent-soft); border-radius: 4px; transition: background .3s ease }`; `.fade-out` → transparent |
| heading anchor offset | `h1[id]…h6[id] { scroll-margin-top: 20px }` |

### 6c. Native chrome (SwiftUI views — verified usages, for the Electron shell UI)

- Sidebar (file tree): background = `bgSubtle`; selected/keyboard-focused row highlight = `accentSoft`; row/secondary labels = `fgSecondary`, dimmed/meta = `fgMuted`.
- Detail (content) container + Outline panel + command palette + raw editor: background = `surface` (detail area drawn as rounded rect over the window; window root also `surface`).
- Dividers/strokes everywhere (title bar bottom line, capsule outlines, palette border, find bar border) = `border` (1px).
- Command palette: selected row background = `accentSoft`; muted hints = `fgMuted`.
- Find/replace bar: `surface` at 95% opacity, fields on `bgSubtle`, error state text/border = `danger`.
- Secondary text = `fgSecondary`; muted/disabled text = `fgMuted`; dirty-file dot / active accents = `accent`; contrast slider labels use `fgMuted`/`fgSecondary`.

---

## 7. Reimplementation checklist (TypeScript)

1. `resolveTheme(base, overrides)` → merged definition (§1).
2. `deriveTokens(def)` → 14 color tokens per §3 (branch on declared `dark`), plus 7 optional typography passthroughs.
3. `tokensToCssVars(tokens)` → exact `:root` block per §3 (hex vs rgba split, `%.2f` alpha, lowercase hex, truncated channels).
4. `codeHighlightCss(def, tokens)` → §5 template (branch on perceived brightness).
5. Inject both into the preview document as `<style id="mr-theme-style">` after markdown.css/scroll.css.
6. Expose the same vars to the Electron shell UI (sidebar/palette/etc. per §6c).
7. Contrast slider 0–100 (integer), writes `overrides.contrast`; all other custom fields nullable with "reset to theme default" = set null.
