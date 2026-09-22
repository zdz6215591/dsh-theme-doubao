import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Extract the hero character from the reference poster as a transparent PNG.
 *
 * Two steps, because PowerShell owns the image I/O and Node owns the pixel maths:
 *
 *   1. dump the source to raw BGRA:
 *      pwsh tools/pixdump.ps1 -Src <poster.png> -Raw <work>/src.raw -Out '' -W 0 -H 0 -Stride 0
 *   2. node tools/cutout.mjs [--work <dir>] [--t0 14] [--t1 30] [--degree 3] ...
 *      → <work>/out.raw plus previews; encode with pixdump again:
 *      pwsh tools/pixdump.ps1 -Src '' -Raw <work>/out.raw -Out <work>/out.png -W <w> -H <h> -Stride 0
 *
 * The poster's blue backdrop is a smooth gradient, so it is modelled with a
 * degree-3 polynomial per channel fitted by iteratively reweighted least squares,
 * then keyed by distance to that model, un-mixed at soft edges, despilled, and
 * finally cleaned of border-connected low-alpha shadow pixels.
 */
const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const num = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const str = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : dflt
}

const work = str('work', join(here, '..', '_work'))
mkdirSync(work, { recursive: true })

const meta = readFileSync(`${work}/src.raw.meta`, 'utf8').trim().split(/\s+/).map(Number)
const [W, H, stride] = meta
const src = readFileSync(`${work}/src.raw`)

const x0 = num('x0', 0)
const y0 = num('y0', 560)
const x1 = num('x1', W)
const y1 = num('y1', 1248)
const T0 = num('t0', 14)
const T1 = num('t1', 30)
const padX = num('padx', 14)
const padY = num('pady', 14)
const degree = num('degree', 2)
const distKeep = num('distkeep', 1.8)
const blueKill = num('bluekill', 34)

const px = (x, y) => {
  const o = y * stride + x * 4
  return [src[o + 2], src[o + 1], src[o]]
}

// --- basis terms for a 2D polynomial in normalized coords ---
const cx = (x0 + x1) / 2, sx = (x1 - x0) / 2
const cy = (y0 + y1) / 2, sy = (y1 - y0) / 2
const terms = []
if (degree >= 1) terms.push([1, 0], [0, 1])
if (degree >= 2) terms.push([1, 1], [2, 0], [0, 2])
if (degree >= 3) terms.push([2, 1], [1, 2], [3, 0], [0, 3])
const basis = [[0, 0], ...terms]
const nt = basis.length
const basisAt = (x, y) => {
  const u = (x - cx) / sx, v = (y - cy) / sy
  const out = new Float64Array(nt)
  for (let i = 0; i < nt; i++) out[i] = Math.pow(u, basis[i][0]) * Math.pow(v, basis[i][1])
  return out
}

// --- IRLS polynomial fit of each channel over the crop ---
const cw = x1 - x0, ch = y1 - y0
const N = cw * ch
const samples = new Float64Array(N * 3)
const basisCache = new Array(N)
{
  let k = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++, k++) {
      const c = px(x, y)
      samples[k * 3] = c[0]; samples[k * 3 + 1] = c[1]; samples[k * 3 + 2] = c[2]
      basisCache[k] = basisAt(x, y)
    }
  }
}
const weights = new Float64Array(N).fill(1)
const coeffs = [null, null, null]
const solve = (A, b) => {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
    ;[A[i], A[p]] = [A[p], A[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    const d = A[i][i]
    if (Math.abs(d) < 1e-12) continue
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = A[r][i] / d
      if (f === 0) continue
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]
      b[r] -= f * b[i]
    }
  }
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : b[i] / A[i][i]
  return out
}
for (let iter = 0; iter < 8; iter++) {
  for (let c = 0; c < 3; c++) {
    const A = Array.from({ length: nt }, () => new Float64Array(nt))
    const b = new Float64Array(nt)
    for (let k = 0; k < N; k++) {
      const w = weights[k]
      if (w === 0) continue
      const bs = basisCache[k]
      const v = samples[k * 3 + c]
      for (let i = 0; i < nt; i++) {
        const bi = bs[i] * w
        b[i] += bi * v
        for (let j = i; j < nt; j++) A[i][j] += bi * bs[j]
      }
    }
    for (let i = 0; i < nt; i++) for (let j = 0; j < i; j++) A[i][j] = A[j][i]
    coeffs[c] = solve(A, b)
  }
  // residuals -> robust weights
  const sigma = num('sigma', 22)
  for (let k = 0; k < N; k++) {
    const bs = basisCache[k]
    let r2 = 0
    for (let c = 0; c < 3; c++) {
      let f = 0
      for (let i = 0; i < nt; i++) f += coeffs[c][i] * bs[i]
      const d = samples[k * 3 + c] - f
      r2 += d * d
    }
    const r = Math.sqrt(r2)
    weights[k] = r > sigma ? 0 : 1 - (r / sigma) * (r / sigma)
  }
}

const model = (x, y) => {
  const bs = basisAt(x, y)
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    let f = 0
    for (let i = 0; i < nt; i++) f += coeffs[c][i] * bs[i]
    out[c] = f
  }
  return out
}

// --- key out the background ---
const out = Buffer.alloc(cw * ch * 4)
let minX = cw, minY = ch, maxX = -1, maxY = -1
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) {
    const [br, bg, bb] = model(x, y)
    const [pr, pg, pb] = px(x, y)
    const dR = Math.abs(pr - br), dG = Math.abs(pg - bg), dB = Math.abs(pb - bb)
    let dist = Math.max(dR, Math.max(dG, dB))
    const extra = (pb - Math.max(pr, pg)) - (bb - Math.max(br, bg))
    dist = Math.max(dist, extra * 0.9)
    let a = (dist - T0) / (T1 - T0)
    a = a < 0 ? 0 : a > 1 ? 1 : a
    if (a < 0.12) a = 0
    if (pb - Math.max(pr, pg) > blueKill) a = 0
    let r = pr, g = pg, b = pb
    if (a > 0.12 && a < 0.999) {
      r = Math.min(255, Math.max(0, (pr - (1 - a) * br) / a))
      g = Math.min(255, Math.max(0, (pg - (1 - a) * bg) / a))
      b = Math.min(255, Math.max(0, (pb - (1 - a) * bb) / a))
      const cap = Math.max(r, g) + 6
      if (b > cap) b = Math.max(g, b * 0.5 + cap * 0.5)
    }
    const o = ((y - y0) * cw + (x - x0)) * 4
    out[o] = Math.round(b); out[o + 1] = Math.round(g); out[o + 2] = Math.round(r); out[o + 3] = Math.round(a * 255)
    if (a > 0.35) {
      if (x - x0 < minX) minX = x - x0
      if (x - x0 > maxX) maxX = x - x0
      if (y - y0 < minY) minY = y - y0
      if (y - y0 > maxY) maxY = y - y0
    }
  }
}
console.log(`content box ${minX + x0},${minY + y0} - ${maxX + x0},${maxY + y0}`)

const ox = Math.max(0, minX - padX), oy = Math.max(0, minY - padY)
const ox1 = Math.min(cw, maxX + 1 + padX), oy1 = Math.min(ch, maxY + 1 + padY)
const tw = ox1 - ox, th = oy1 - oy
const crop = Buffer.alloc(tw * th * 4)
for (let y = 0; y < th; y++) {
  out.copy(crop, y * tw * 4, ((oy + y) * cw + ox) * 4, ((oy + y) * cw + ox + tw) * 4)
}

// --- shadow cleanup: drop border-connected low-alpha pixels that are far from the solid body ---
{
  const INF = 1e9
  const dist = new Float32Array(tw * th).fill(INF)
  const queue = new Int32Array(tw * th)
  let qh = 0, qt = 0
  for (let i = 0; i < tw * th; i++) {
    if (crop[i * 4 + 3] >= 250) { dist[i] = 0; queue[qt++] = i }
  }
  const W2 = tw
  while (qh < qt) {
    const i = queue[qh++]
    const x = i % W2, y = (i - x) / W2
    const d0 = dist[i]
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue
        const n = ny * W2 + nx
        const nd = d0 + (dx === 0 || dy === 0 ? 1 : 1.4142)
        if (nd < dist[n]) { dist[n] = nd; queue[qt++] = n }
      }
    }
  }
  const visited = new Uint8Array(tw * th)
  qh = 0; qt = 0
  const push = (i) => { if (visited[i] === 0) { visited[i] = 1; queue[qt++] = i } }
  for (let x = 0; x < tw; x++) { push(x); push((th - 1) * tw + x) }
  for (let y = 0; y < th; y++) { push(y * tw); push(y * tw + tw - 1) }
  while (qh < qt) {
    const i = queue[qh++]
    if (crop[i * 4 + 3] >= 220) continue
    const x = i % W2, y = (i - x) / W2
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue
      push(ny * W2 + nx)
    }
  }
  let cleaned = 0
  for (let i = 0; i < tw * th; i++) {
    if (visited[i] === 1 && crop[i * 4 + 3] < 220 && dist[i] > distKeep) { crop[i * 4 + 3] = 0; cleaned++ }
  }
  console.log(`shadow cleanup: cleared ${cleaned} px`)
}
writeFileSync(`${work}/out.raw`, crop)
writeFileSync(`${work}/out.raw.meta`, `${tw} ${th} ${tw * 4}\n`)
console.log(`cropped ${tw}x${th}`)

const composite = (bg) => {
  const buf = Buffer.alloc(tw * th * 4)
  for (let i = 0; i < tw * th; i++) {
    const a = crop[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) buf[i * 4 + c] = Math.round(crop[i * 4 + c] * a + bg[c] * (1 - a))
    buf[i * 4 + 3] = 255
  }
  return buf
}
for (const [name, bg] of [['preview_white', [255, 255, 255]], ['preview_dark', [16, 20, 28]], ['preview_blue', [214, 228, 244]]]) {
  writeFileSync(`${work}/${name}.raw`, composite(bg))
  writeFileSync(`${work}/${name}.raw.meta`, `${tw} ${th} ${tw * 4}\n`)
}
{
  const buf = Buffer.alloc(tw * th * 4)
  for (let i = 0; i < tw * th; i++) {
    const a = crop[i * 4 + 3]
    buf[i * 4] = a; buf[i * 4 + 1] = a; buf[i * 4 + 2] = a; buf[i * 4 + 3] = 255
  }
  writeFileSync(`${work}/preview_alpha.raw`, buf)
  writeFileSync(`${work}/preview_alpha.raw.meta`, `${tw} ${th} ${tw * 4}\n`)
}
console.log('done')



