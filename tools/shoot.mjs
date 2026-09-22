/**
 * Screenshot driver for the theme's verification loop.
 *
 * Launches nothing itself; talks to an already running headless Chrome over the
 * DevTools protocol using Node's built-in fetch + WebSocket, so the loop needs no
 * browser-automation dependency. Usage:
 *
 *   node tools/shoot.mjs --url <url> --out <png> [--width 1440] [--height 900]
 *                        [--wait 6000] [--eval "<js>"] [--port 9222]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 ? args[index + 1] : fallback
}

const url = arg('url')
const out = arg('out')
const width = Number(arg('width', 1440))
const height = Number(arg('height', 900))
const wait = Number(arg('wait', 6000))
const port = Number(arg('port', 9222))
const evaluate = arg('eval', null)

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
let page = targets.find((target) => target.type === 'page')
if (page === undefined) throw new Error('shoot: no page target; is Chrome running with --remote-debugging-port?')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
const events = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id === undefined) {
    const method = message.method
    if (method === 'Runtime.consoleAPICalled') {
      const args = message.params.args.map((a) => String(a.value ?? a.description ?? a.type).slice(0, 400)).join(' ')
      events.push(`[console.${message.params.type}] ${args.slice(0, 900)}`)
    } else if (method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      events.push(`[exception] ${details.text} ${String(details.exception?.description ?? '').slice(0, 700)}`)
    } else if (method === 'Log.entryAdded') {
      events.push(`[log.${message.params.entry.level}] ${String(message.params.entry.text).slice(0, 300)}`)
    }
    return
  }
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
  else entry.resolve(message.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
})
if (args.includes('--dark')) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
}
await send('Page.navigate', { url })
await new Promise((resolve) => setTimeout(resolve, 900))
events.length = 0 // drop the outgoing page's teardown noise; keep only this load
await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait - 900)))

if (evaluate !== null) {
  const result = await send('Runtime.evaluate', { expression: evaluate, returnByValue: true, awaitPromise: true })
  console.log(JSON.stringify(result.result?.value ?? result, null, 2))
}

// Park the pointer so the field's scatter/light-follow can be observed.
const move = arg('move', null)
if (move !== null) {
  const [x, y] = move.split(',').map(Number)
  for (const step of [0, 1, 2, 3]) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x - 40 + step * 12,
      y: y - 30 + step * 9,
      buttons: 0,
      pointerType: 'mouse',
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  await new Promise((resolve) => setTimeout(resolve, Number(arg('settle', 450))))
}

if (out !== null) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`shoot: wrote ${out}`)
}

if (events.length > 0) {
  console.log('--- page log ---')
  for (const line of events) console.log(line)
}

socket.close()
process.exit(0)

