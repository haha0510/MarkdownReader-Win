// 从 assets/icon.svg 生成 build/icon.png(512,electron-builder 会转 ico)与 build/icon.ico
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('build', { recursive: true })
const svg = 'assets/icon.svg'

await sharp(svg).resize(512, 512).png().toFile('build/icon.png')

// 自组 .ico(含 16/24/32/48/64/128/256,PNG 压缩条目)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer()))
const count = pngs.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(count, 4)
const entries = []
let offset = 6 + 16 * count
pngs.forEach((buf, i) => {
  const e = Buffer.alloc(16)
  const s = sizes[i]
  e.writeUInt8(s === 256 ? 0 : s, 0)
  e.writeUInt8(s === 256 ? 0 : s, 1)
  e.writeUInt8(0, 2) // palette
  e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(buf.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += buf.length
  entries.push(e)
})
writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...pngs]))
console.log('build/icon.png + build/icon.ico generated')
