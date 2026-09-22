/**
 * Render the whale sampling grid as ASCII, using the same browser code path the
 * theme uses (`Image` + canvas + luminance threshold), so the dot-matrix shape
 * can be checked without a screenshot.
 *
 *   node tools/whale-shape.mjs [--port 9222] [--size 60] [--cutoff 0.2]
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 ? args[index + 1] : fallback
}
const port = Number(arg('port', 9222))
const size = Number(arg('size', 60))
const cutoff = Number(arg('cutoff', 0.2))
const svg = readFileSync(new URL('../assets/deepseek-whale.svg', import.meta.url), 'utf8')
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const expression = `(async () => {
  const svg = ${JSON.stringify(svgUrl)}
  const size = ${size}
  const cutoff = ${cutoff}
  const image = new Image()
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = svg })
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size)
  const ratio = Math.min(size / image.width, size / image.height)
  const w = image.width * ratio, h = image.height * ratio
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h)
  const data = ctx.getImageData(0, 0, size, size).data
  const rows = []
  let count = 0
  for (let y = 0; y < size; y++) {
    let line = ''
    for (let x = 0; x < size; x++) {
      const o = 4 * (y * size + x)
      const lum = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255
      line += lum > cutoff ? '#' : '.'
      if (lum > cutoff) count++
    }
    rows.push(line)
  }
  return { naturalWidth: image.width, naturalHeight: image.height, count, rows }
})()`

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith('http://127.0.0.1:3099'))
if (page === undefined) throw new Error('whale-shape: no test-page target')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id === undefined) return
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
  else entry.resolve(message.result)
})
const result = await new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(
    JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }),
  )
})
const value = result.result?.value
if (value === undefined) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`artwork ${value.naturalWidth}x${value.naturalHeight}, ${value.count} cells above ${cutoff}`)
  for (const row of value.rows) console.log(row)
}
socket.close()
process.exit(0)
