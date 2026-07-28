// PDF 导出 — 保存对话框 + printToPDF 当前页面(打印样式由 viewer.css @media print 控制)
import { BrowserWindow, dialog } from 'electron'
import { promises as fsp } from 'fs'

export async function exportPdf(
  win: BrowserWindow,
  suggestedName: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const base = (suggestedName || 'document').replace(/\.pdf$/i, '')
    const r = await dialog.showSaveDialog(win, {
      defaultPath: base + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false }
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: false,
      margins: { marginType: 'default' }
    })
    await fsp.writeFile(r.filePath, data)
    return { ok: true, path: r.filePath.replace(/\\/g, '/') }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
