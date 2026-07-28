// 本文件由 scripts/gen-themes.mjs 依据 design/themes.json 自动生成 — 勿手改。
// 共 33 个主题,顺序与源一致(暗色在前)。

/** 主题元信息(主题列表/选择器用) */
export interface ThemeInfo {
  id: string
  name: string
  dark: boolean
}

/** 5 基色(#rrggbb) */
export interface ThemeColors {
  surface: string
  ink: string
  accent: string
  success: string
  danger: string
}

/** 可选排版覆盖(原始 CSS 值;缺省 = 用默认) */
export interface ThemeTypography {
  bodyFontFamily?: string
  headingFontFamily?: string
  codeFontFamily?: string
  bodyFontSize?: string
  lineHeight?: string
  letterSpacing?: string
  borderRadius?: string
}

/** 完整主题定义:基色 + 对比度(0-100) + 排版 */
export interface FullTheme extends ThemeInfo {
  colors: ThemeColors
  contrast: number
  typography: ThemeTypography
}

/** 参考项目默认主题 id */
export const DEFAULT_DARK: string = 'buddy-dark'
export const DEFAULT_LIGHT: string = 'buddy-light'

/** 全部主题完整数据(源顺序) */
export const fullThemes: FullTheme[] = [
  {
    id: "buddy-dark",
    name: "Default Dark",
    dark: true,
    colors: { surface: "#18181a", ink: "#e8e8e3", accent: "#339cff", success: "#40c977", danger: "#fa423e" },
    contrast: 60,
    typography: {}
  },
  {
    id: "codex-dark",
    name: "Codex Dark",
    dark: true,
    colors: { surface: "#111111", ink: "#ffffff", accent: "#0169cc", success: "#40c977", danger: "#fa423e" },
    contrast: 60,
    typography: {}
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: true,
    colors: { surface: "#282a36", ink: "#f8f8f2", accent: "#ff79c6", success: "#50fa7b", danger: "#ff5555" },
    contrast: 60,
    typography: {}
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    dark: true,
    colors: { surface: "#1e1e2e", ink: "#cdd6f4", accent: "#cba6f7", success: "#a6e3a1", danger: "#f38ba8" },
    contrast: 58,
    typography: {}
  },
  {
    id: "catppuccin-macchiato",
    name: "Catppuccin Macchiato",
    dark: true,
    colors: { surface: "#181825", ink: "#cad3f8", accent: "#c7a4f5", success: "#a6da95", danger: "#ed8796" },
    contrast: 58,
    typography: {}
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    colors: { surface: "#2e3440", ink: "#d8dee9", accent: "#88c0d0", success: "#a3be8c", danger: "#bf616a" },
    contrast: 55,
    typography: {}
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    dark: true,
    colors: { surface: "#282c34", ink: "#abb2bf", accent: "#4d78cc", success: "#98c379", danger: "#e06c75" },
    contrast: 60,
    typography: {}
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: true,
    colors: { surface: "#1a1b26", ink: "#a9b1d6", accent: "#7aa2f7", success: "#9ece6a", danger: "#f7768e" },
    contrast: 58,
    typography: {}
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    dark: true,
    colors: { surface: "#282828", ink: "#ebdbb2", accent: "#fe8019", success: "#b8bb26", danger: "#fb4934" },
    contrast: 55,
    typography: {}
  },
  {
    id: "kanagawa",
    name: "Kanagawa Wave",
    dark: true,
    colors: { surface: "#1f1f28", ink: "#dcd7ba", accent: "#658594", success: "#76956a", danger: "#c34043" },
    contrast: 55,
    typography: {}
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    dark: true,
    colors: { surface: "#191724", ink: "#e0def4", accent: "#ebbcba", success: "#31748f", danger: "#eb6f92" },
    contrast: 58,
    typography: {}
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    dark: true,
    colors: { surface: "#0d1117", ink: "#e6edf3", accent: "#1f6feb", success: "#3fb950", danger: "#f85149" },
    contrast: 50,
    typography: {}
  },
  {
    id: "material-palenight",
    name: "Material Palenight",
    dark: true,
    colors: { surface: "#292d3e", ink: "#eeffff", accent: "#80cbc4", success: "#c3e88d", danger: "#ff5370" },
    contrast: 58,
    typography: {}
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    dark: true,
    colors: { surface: "#0b0e14", ink: "#bfbdb6", accent: "#e6b450", success: "#c2d94c", danger: "#f07178" },
    contrast: 55,
    typography: {}
  },
  {
    id: "vitesse-dark",
    name: "Vitesse Dark",
    dark: true,
    colors: { surface: "#121212", ink: "#dbd7ca", accent: "#4d9375", success: "#80a665", danger: "#cb7676" },
    contrast: 55,
    typography: {}
  },
  {
    id: "mpe-atom-material",
    name: "Atom Material",
    dark: true,
    colors: { surface: "#263238", ink: "#eeffff", accent: "#82aaff", success: "#c3e88d", danger: "#f07178" },
    contrast: 55,
    typography: { bodyFontFamily: "'Helvetica Neue',Helvetica,'Segoe UI',Arial,freesans,sans-serif", codeFontFamily: "Menlo,Monaco,Consolas,'Courier New',monospace" }
  },
  {
    id: "mpe-gothic",
    name: "Gothic",
    dark: true,
    colors: { surface: "#0e0e0e", ink: "#c7c7c7", accent: "#fe5e3a", success: "#40c977", danger: "#b33b2e" },
    contrast: 55,
    typography: { bodyFontFamily: "Raleway,sans-serif", lineHeight: "1.75rem" }
  },
  {
    id: "mpe-monokai",
    name: "Monokai",
    dark: true,
    colors: { surface: "#282828", ink: "#f8f8f2", accent: "#a6e22e", success: "#a6e22e", danger: "#f92672" },
    contrast: 55,
    typography: { bodyFontFamily: "'Helvetica Neue',Helvetica,'Segoe UI',Arial,freesans,sans-serif", codeFontFamily: "Menlo,Monaco,Consolas,'Courier New',monospace" }
  },
  {
    id: "mpe-night",
    name: "Night",
    dark: true,
    colors: { surface: "#363b40", ink: "#b8bfc6", accent: "#e0e0e0", success: "#dedede", danger: "#fa423e" },
    contrast: 55,
    typography: { bodyFontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", headingFontFamily: "'Lucida Grande',Corbal,Georgia,serif", codeFontFamily: "Monaco,Consolas,'Andale Mono','DejaVu Sans Mono',monospace", letterSpacing: "-1.5px" }
  },
  {
    id: "mpe-solarized-dark",
    name: "Solarized Dark (MPE)",
    dark: true,
    colors: { surface: "#002b36", ink: "#839496", accent: "#268bd2", success: "#859900", danger: "#dc322f" },
    contrast: 55,
    typography: { bodyFontFamily: "'Helvetica Neue',Helvetica,'Segoe UI',Arial,freesans,sans-serif", codeFontFamily: "Menlo,Monaco,Consolas,'Courier New',monospace" }
  },
  {
    id: "buddy-light",
    name: "Default Light",
    dark: false,
    colors: { surface: "#ffffff", ink: "#1c1c1a", accent: "#339cff", success: "#00a240", danger: "#ba2623" },
    contrast: 45,
    typography: {}
  },
  {
    id: "codex-light",
    name: "Codex Light",
    dark: false,
    colors: { surface: "#ffffff", ink: "#1a1c1f", accent: "#0169cc", success: "#00a240", danger: "#ba2623" },
    contrast: 45,
    typography: {}
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    dark: false,
    colors: { surface: "#eff1f5", ink: "#4c4f69", accent: "#8839ef", success: "#40a02b", danger: "#d20f39" },
    contrast: 45,
    typography: {}
  },
  {
    id: "github-light",
    name: "GitHub Light",
    dark: false,
    colors: { surface: "#ffffff", ink: "#1f2328", accent: "#0969da", success: "#1a7f37", danger: "#cf222e" },
    contrast: 42,
    typography: {}
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    dark: false,
    colors: { surface: "#fbf1c7", ink: "#3c3836", accent: "#af3a03", success: "#79740e", danger: "#9d0006" },
    contrast: 45,
    typography: {}
  },
  {
    id: "kanagawa-lotus",
    name: "Kanagawa Lotus",
    dark: false,
    colors: { surface: "#f2ecbc", ink: "#5c5144", accent: "#c47247", success: "#6f894e", danger: "#c34043" },
    contrast: 45,
    typography: {}
  },
  {
    id: "one-light",
    name: "One Light",
    dark: false,
    colors: { surface: "#fafafa", ink: "#383a42", accent: "#526fff", success: "#50a14f", danger: "#e45649" },
    contrast: 45,
    typography: {}
  },
  {
    id: "rose-pine-dawn",
    name: "Rose Pine Dawn",
    dark: false,
    colors: { surface: "#faf4ed", ink: "#575279", accent: "#d7827e", success: "#286983", danger: "#b4637a" },
    contrast: 42,
    typography: {}
  },
  {
    id: "mpe-atom-light",
    name: "Atom Light",
    dark: false,
    colors: { surface: "#ffffff", ink: "#555555", accent: "#0088cc", success: "#00a240", danger: "#ba2623" },
    contrast: 42,
    typography: { bodyFontFamily: "'Helvetica Neue',Helvetica,'Segoe UI',Arial,freesans,sans-serif", codeFontFamily: "Menlo,Monaco,Consolas,'Courier New',monospace" }
  },
  {
    id: "mpe-medium",
    name: "Medium",
    dark: false,
    colors: { surface: "#ffffff", ink: "#333333", accent: "#1a99da", success: "#00a240", danger: "#ba2623" },
    contrast: 42,
    typography: { bodyFontFamily: "'San Francisco',Roboto,'Segoe UI','Helvetica Neue','Lucida Grande',sans-serif", codeFontFamily: "Consolas,Menlo,Monaco,monospace,serif", bodyFontSize: "18px", lineHeight: "1.555", letterSpacing: "-0.003em" }
  },
  {
    id: "mpe-newsprint",
    name: "Newsprint",
    dark: false,
    colors: { surface: "#fbfbfb", ink: "#333333", accent: "#b05a3a", success: "#00a240", danger: "#ba2623" },
    contrast: 42,
    typography: { bodyFontFamily: "'PT Serif','Times New Roman',Times", lineHeight: "1.5em" }
  },
  {
    id: "mpe-solarized-light",
    name: "Solarized Light (MPE)",
    dark: false,
    colors: { surface: "#fdf6e3", ink: "#657b83", accent: "#268bd2", success: "#859900", danger: "#dc322f" },
    contrast: 42,
    typography: { bodyFontFamily: "'Helvetica Neue',Helvetica,'Segoe UI',Arial,freesans,sans-serif", codeFontFamily: "Menlo,Monaco,Consolas,'Courier New',monospace" }
  },
  {
    id: "mpe-vue",
    name: "Vue",
    dark: false,
    colors: { surface: "#ffffff", ink: "#304455", accent: "#42b983", success: "#42b983", danger: "#ba2623" },
    contrast: 42,
    typography: { bodyFontFamily: "Source Sans Pro,Helvetica Neue,Arial,sans-serif", headingFontFamily: "Dosis,Source Sans Pro,Helvetica Neue,Arial,sans-serif", letterSpacing: "0" }
  }
]

/** 主题元信息列表(源顺序) */
export const themes: ThemeInfo[] = fullThemes.map((t) => ({ id: t.id, name: t.name, dark: t.dark }))

const byId: Map<string, FullTheme> = new Map(fullThemes.map((t) => [t.id, t]))

/** 按 id 查找主题 */
export function getTheme(id: string): FullTheme | undefined {
  return byId.get(id)
}
