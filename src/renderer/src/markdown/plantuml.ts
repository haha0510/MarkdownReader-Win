// PlantUML 围栏代码块 → 服务器渲染 <img> 的 HTML 片段。
// 注意:plantuml-encoder 的浏览器入口(browser 字段)依赖未安装的 pako,
// 因此直接引入其自带 pako 的 UMD dist 包(纯同步 encode,无额外依赖)。
// @ts-ignore -- dist 产物无类型声明
import plantumlEncoderUntyped from 'plantuml-encoder/dist/plantuml-encoder.min.js'

const plantumlEncoder = plantumlEncoderUntyped as { encode(puml: string): string }

/** HTML 属性转义 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 生成 PlantUML 图块 HTML:<div class="plantuml-block"><img …></div>
 * server 为空(禁用)或编码失败时返回 null,调用方回退为普通代码块。
 */
export function plantumlBlockHtml(code: string, server: string): string | null {
  const base = server.trim().replace(/\/+$/, '')
  if (!base) return null
  let encoded: string
  try {
    encoded = plantumlEncoder.encode(code)
  } catch {
    return null
  }
  const url = `${base}/svg/${encoded}`
  return `<div class="plantuml-block"><img src="${escapeAttr(url)}" alt="PlantUML"></div>\n`
}
