/**
 * One-shot DOM probe for the theme's verification loop: prints the host layout
 * around the hero slot plus the theme's own inline styles, so a screenshot can be
 * read against the numbers that produced it.
 *
 *   node tools/probe.mjs --port 9222
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 ? args[index + 1] : fallback
}
const port = Number(arg('port', 9222))
const script = readFileSync(new URL('./probe-expression.js', import.meta.url), 'utf8')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith('http://127.0.0.1:3099'))
if (page === undefined) throw new Error('probe: no test-page target')
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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

const result = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true })
console.log(JSON.stringify(result.result?.value ?? result, null, 2))
socket.close()
process.exit(0)
