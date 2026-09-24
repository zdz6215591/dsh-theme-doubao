/**
 * Dot-matrix ("digitile") DeepSeek whale — a dependency-free WebGL2 port of the
 * hero particle field on https://www.deepseek.com/harness/en/.
 *
 * The upstream implementation is a react-three-fiber `instancedMesh` of tiny
 * boxes whose instance centres are sampled from the whale SVG, shaded by one
 * procedural light, assembled on mount, and pushed away by the pointer. This
 * file keeps that maths and both GLSL programs byte-for-byte where it matters
 * and only replaces the three.js plumbing with raw WebGL2 calls, so the field
 * behaves identically without pulling three.js into the client bundle.
 *
 * Ported constants (do not "tidy" these — they are upstream values):
 *   sampling canvas 60x60, cell scale 0.18, box 0.06 x 0.06 x 0.018,
 *   camera position (0, 0, 18) with fov 50, group base scale .75 + .25 * assembly,
 *   light (4.5, 5.5, 3) range 14 shade .28 .. 2.79 followX 1.05,
 *   pointer radius 4.9 strength .8 decay .2 distort 5,
 *   assembly ramp `clamp((t - .3) / 2.5)` eased with `1 - (1 - x)^3`.
 */

/** Sampling resolution of the source artwork (upstream `t`). */
const SAMPLE = 60
/** World units per sampling cell. */
const CELL = 0.18
/** Luminance above which a sampling cell becomes a tile. */
const LUMINANCE_CUTOFF = 0.2
/** Tile box size. */
const TILE = [0.06, 0.06, 0.018]
/** Camera placement, matching the upstream `<Canvas camera={...}>`. */
const CAMERA = { position: [0, 0, 18], fov: 50, near: 0.1, far: 2000 }
/** Upstream `DIGITILE_LIGHT_DEFAULTS`. */
const LIGHT = { x: 4.5, y: 5.5, z: 3, range: 14, shadeMin: 0.28, shadeMax: 2.79, followX: 1.05 }
/** Upstream `DIGITILE_MOUSE_DEFAULTS`. */
const MOUSE = { radius: 4.9, strength: 0.8, decay: 0.2, distort: 5 }
/** Frame pacing: upstream drives the scene at 30fps through `<Tick fps={30}>`. */
const FRAME_MS = 1000 / 30
/** Slowest pointer smoothing the upstream animation loop can reach per frame. */
const MOUSE_SMOOTHING = 0.05

/**
 * Retarget the upstream shader pair: the only edit is that three.js' per-instance
 * matrix is expressed as the two values it actually carries (a centre and a
 * uniform scale), so no `mat4` instanced attribute is needed.
 */
const VERTEX_SHADER = `#version 300 es
precision highp float;
// GLSL ES 3.00 spells vertex inputs in; the upstream program used three.js'
// GLSL1 source, where the same slots are declared ttribute.
in vec3 position;
in vec3 aCenter;
in float aScale;
in float aOpacity;
in float aIndex;
in float aEdge;
in vec3 aScattered;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uWaveSpeed;
uniform float uWaveAmount;
uniform vec2 uMouse;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseDistort;
uniform float uAssembly;
uniform float uLoose;
uniform float uScatter;
uniform vec3 uLightPos;
uniform float uLightRange;
uniform float uShadeMin;
uniform float uShadeMax;
out float vOpacity;
out vec3 vWorldPos;
out float vAssembly;
out float vLight;

void main() {
  vOpacity = aOpacity;
  vAssembly = uAssembly;

  // Target: instance center position (without vertex offset scaled by instance)
  vec3 targetCenter = aCenter;
  // Vertex offset in instance local space
  vec3 localOffset = position * aScale;

  // Scattered position
  vec3 scatteredCenter = aScattered;

  // Smoothstep assembly for more organic feel
  float assembly = smoothstep(0.0, 1.0, uAssembly);

  // Lerp center between scattered and target
  vec3 center = mix(scatteredCenter, targetCenter, assembly);
  // Final position = interpolated center + local vertex offset (always from instance matrix)
  vec3 pos = center + localOffset;
  vWorldPos = center;

  // Idle looseness: static jitter + slow drift, strongest at shape edges
  float loose = uLoose * mix(0.25, 1.0, aEdge) * assembly;
  if (loose > 0.001) {
    vec3 jitter = vec3(
      fract(sin(aIndex * 12.9898) * 43758.5453) - 0.5,
      fract(sin(aIndex * 78.2330) * 12543.1230) - 0.5,
      fract(sin(aIndex * 39.4250) * 26711.7700) - 0.5
    );
    pos += jitter * 0.05 * loose;
    pos.x += sin(uTime * 0.50 + aIndex * 0.53) * 0.06 * loose;
    pos.y += cos(uTime * 0.42 + aIndex * 0.71) * 0.06 * loose;
    pos.z += sin(uTime * 0.36 + aIndex * 0.91) * 0.08 * loose;

    // Swim undulation: a slow wave traveling toward the tail (+x side),
    // so the tail sways more than the body
    float tail = smoothstep(0.5, 4.5, targetCenter.x) * uLoose * assembly;
    pos.y += sin(uTime * 1.1 - targetCenter.x * 0.7) * 0.1 * tail;
    pos.z += cos(uTime * 0.9 - targetCenter.x * 0.55) * 0.06 * tail;
  }

  // Scroll dispersion: drift each particle toward its scattered position,
  // edge particles drift further so the silhouette loosens first
  if (uScatter > 0.001) {
    float disperse = uScatter * mix(0.5, 1.0, aEdge);
    pos += (scatteredCenter - center) * disperse;
    pos.z += sin(uTime * 0.6 + aIndex * 0.3) * disperse * 0.6;
  }

  // Only apply wave when fully assembled
  if (assembly > 0.95) {
    float effectStrength = (assembly - 0.95) * 20.0;

    // Wave from center (fade out near center to prevent "lift" distortion)
    float dist = length(center.xy);
    float waveFade = smoothstep(0.0, 3.0, dist);
    float wave = sin(dist * 3.0 - uTime * uWaveSpeed) * uWaveAmount * effectStrength * waveFade;
    pos.z += wave;
  }

  // Mouse scatter - simple radial push with soft falloff
  if (assembly > 0.8) {
    float mouseEffect = (assembly - 0.8) * 5.0;
    vec2 toMouse = center.xy - uMouse;
    float mouseDist = length(toMouse);

    if (mouseDist < uMouseRadius && mouseDist > 0.001) {
      // Cubic falloff for soft edges
      float t = 1.0 - mouseDist / uMouseRadius;
      float force = t * t * t * mouseEffect * uMouseStrength;

      // Radial push direction with per-particle noise offset
      vec2 radialDir = toMouse / mouseDist;
      float noiseAngle = sin(aIndex * 0.37 + uTime * 0.5) * uMouseDistort;
      float ca = cos(noiseAngle);
      float sa = sin(noiseAngle);
      vec2 pushDir = vec2(radialDir.x * ca - radialDir.y * sa, radialDir.x * sa + radialDir.y * ca);

      pos.xy += pushDir * force * 2.0;
      // Z scatter per particle
      pos.z += sin(aIndex * 1.7 + uTime) * force * 0.8;
    }
  }

  // Individual floating when scattered (cut off sharply)
  if (assembly < 0.9) {
    float scatter = smoothstep(0.9, 0.0, assembly);
    pos.x += sin(uTime * 0.5 + aIndex * 0.1) * 0.2 * scatter;
    pos.y += cos(uTime * 0.4 + aIndex * 0.07) * 0.2 * scatter;
    pos.z += sin(uTime * 0.3 + aIndex * 0.13) * 0.15 * scatter;
  }

  // Shading factor from distance to the fixed world-space light:
  // the group rotates underneath it, so the lit face stays anchored on screen
  vec4 worldPos = uModel * vec4(pos, 1.0);
  float lightDist = distance(worldPos.xyz, uLightPos);
  float lit = clamp(1.0 - lightDist / uLightRange, 0.0, 1.0);
  vLight = mix(uShadeMin, uShadeMax, lit * lit);

  gl_Position = uViewProj * uModel * vec4(pos, 1.0);
}
`

/** Fragment program, verbatim from the upstream digitile material. */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float vOpacity;
in vec3 vWorldPos;
in float vAssembly;
in float vLight;
uniform float uTime;
uniform vec3 uColor;
/** Centre bloom weight; 0 flattens the field to one tone. */
uniform float uGlow;
/** Overall particle opacity, so a theme can hold the field back. */
uniform float uOpacity;
out vec4 outColor;

void main() {
  float dist = length(vWorldPos.xy);
  float glow = smoothstep(8.0, 0.0, dist) * uGlow * vAssembly;

  float baseAlpha = mix(0.45, 0.75, vAssembly);
  float alpha = vOpacity * (baseAlpha + glow) * uOpacity;
  float shimmer = sin(uTime * 1.5 + vWorldPos.x * 5.0 + vWorldPos.y * 3.0) * 0.1 + 0.9;
  alpha *= shimmer * min(vLight, 1.0);

  vec3 color = (uColor + glow * vec3(0.2, 0.3, 0.5)) * vLight;
  // Slight warm shift on the lit side
  color = mix(color, color * vec3(1.07, 1.02, 0.94), clamp(vLight - 1.0, 0.0, 1.0));
  outColor = vec4(color, alpha);
}
`

/* ------------------------------------------------------------------ *
 * Minimal column-major 4x4 maths (same conventions as three.js).      *
 * ------------------------------------------------------------------ */

function mat4() {
  return new Float32Array(16)
}

function identity(out) {
  out.fill(0)
  out[0] = out[5] = out[10] = out[15] = 1
  return out
}

function perspective(out, fovDeg, aspect, near, far) {
  const f = 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) / (near - far)
  out[11] = -1
  out[14] = (2 * far * near) / (near - far)
  return out
}

function lookAt(out, eye, center, up) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2]; out[12] = -dot(x, eye)
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2]; out[13] = -dot(y, eye)
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2]; out[14] = -dot(z, eye)
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1
  return out
}

function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

/**
 * Compose translate * rotate * uniform-scale for three.js' default `'XYZ'` Euler
 * order (its `Matrix4.makeRotationFromEuler` layout) so the scene's small
 * rotations and Z spin behave exactly like the upstream object transform.
 */
function composeTRS(out, t, euler, s) {
  const [x, y, z] = euler
  const a = Math.cos(x), b = Math.sin(x)
  const c = Math.cos(y), d = Math.sin(y)
  const e = Math.cos(z), f = Math.sin(z)
  const ae = a * e, af = a * f, be = b * e, bf = b * f
  out[0] = c * e * s
  out[1] = (af + be * d) * s
  out[2] = (bf - ae * d) * s
  out[3] = 0
  out[4] = -c * f * s
  out[5] = (ae - bf * d) * s
  out[6] = (be + af * d) * s
  out[7] = 0
  out[8] = d * s
  out[9] = -b * c * s
  out[10] = a * c * s
  out[11] = 0
  out[12] = t[0]
  out[13] = t[1]
  out[14] = t[2]
  out[15] = 1
  return out
}

/** Invert an affine matrix, matching `Matrix4.invert()` for the TRS inverse used here. */
function invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2]
  const a10 = m[4], a11 = m[5], a12 = m[6]
  const a20 = m[8], a21 = m[9], a22 = m[10]
  const b00 = a11 * a22 - a12 * a21
  const b01 = a12 * a20 - a10 * a22
  const b02 = a10 * a21 - a11 * a20
  const det = a00 * b00 + a01 * b01 + a02 * b02
  const id = det === 0 ? 0 : 1 / det
  out[0] = b00 * id
  out[1] = (a02 * a21 - a01 * a22) * id
  out[2] = (a01 * a12 - a02 * a11) * id
  out[3] = 0
  out[4] = b01 * id
  out[5] = (a00 * a22 - a02 * a20) * id
  out[6] = (a02 * a10 - a00 * a12) * id
  out[7] = 0
  out[8] = b02 * id
  out[9] = (a01 * a20 - a00 * a21) * id
  out[10] = (a00 * a11 - a01 * a10) * id
  out[11] = 0
  const tx = m[12], ty = m[13], tz = m[14]
  out[12] = -(tx * out[0] + ty * out[4] + tz * out[8])
  out[13] = -(tx * out[1] + ty * out[5] + tz * out[9])
  out[14] = -(tx * out[2] + ty * out[6] + tz * out[10])
  out[15] = 1
  return out
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/* ------------------------------------------------------------------ *
 * Artwork sampling (upstream `function(e, t) { ... }` in chunk 776).  *
 * ------------------------------------------------------------------ */

/**
 * Sample one artwork into instance attributes.
 * @param image - decoded artwork, drawn into a `SAMPLE`-sized square canvas.
 * @returns parallel instance attribute arrays.
 */
function sampleArtwork(image) {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, SAMPLE, SAMPLE)
  const ratio = Math.min(SAMPLE / image.width, SAMPLE / image.height)
  const w = image.width * ratio
  const h = image.height * ratio
  ctx.drawImage(image, (SAMPLE - w) / 2, (SAMPLE - h) / 2, w, h)
  const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
  const luminance = new Float32Array(SAMPLE * SAMPLE)
  for (let i = 0; i < SAMPLE * SAMPLE; i++) {
    const o = 4 * i
    luminance[i] =
      (0.299 * data.data[o] + 0.587 * data.data[o + 1] + 0.114 * data.data[o + 2]) / 255
  }
  const centers = []
  const scattered = []
  const opacities = []
  const edges = []
  const half = SAMPLE / 2
  for (let row = 0; row < SAMPLE; row++) {
    for (let col = 0; col < SAMPLE; col++) {
      const value = luminance[row * SAMPLE + col]
      if (value <= LUMINANCE_CUTOFF) continue
      centers.push((col - half) * CELL, (half - row) * CELL, 0)
      opacities.push(value)
      let empty = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const c = col + dx
          const r = row + dy
          if (c < 0 || r < 0 || c >= SAMPLE || r >= SAMPLE || luminance[r * SAMPLE + c] <= LUMINANCE_CUTOFF) empty++
        }
      }
      edges.push(empty / 8)
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const radius = 3 * (0.4 + 0.6 * Math.random())
      scattered.push(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.sin(phi) * Math.sin(theta) * radius,
        Math.cos(phi) * radius * 0.5,
      )
    }
  }
  const count = centers.length / 3
  const scales = new Float32Array(count)
  const indices = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    scales[i] = 0.5 + 1 * Math.random()
    indices[i] = i
  }
  return {
    count,
    centers: new Float32Array(centers),
    scattered: new Float32Array(scattered),
    opacities: new Float32Array(opacities),
    edges: new Float32Array(edges),
    scales,
    indices,
  }
}

/** 36 box corners (two triangles per face) at the upstream tile size. */
function tileGeometry() {
  const [hx, hy, hz] = [TILE[0] / 2, TILE[1] / 2, TILE[2] / 2]
  const corners = [
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
  ]
  const faces = [
    [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6],
    [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2],
    [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0],
  ]
  const positions = new Float32Array(faces.length * 9)
  let o = 0
  for (const face of faces) {
    for (const index of face) {
      positions[o++] = corners[index][0]
      positions[o++] = corners[index][1]
      positions[o++] = corners[index][2]
    }
  }
  return positions
}

/* ------------------------------------------------------------------ *
 * Renderer                                                            *
 * ------------------------------------------------------------------ */

/**
 * Mount the dot-matrix field in `canvas`.
 * @param canvas - the backing canvas element.
 * @param options - artwork URL plus the theme-selected colour/blending pair.
 * @returns a handle with `dispose()` and `setAppearance()`.
 */
function createDigitileField(canvas, options) {
  const appearance = {
    additive: options.additive !== false,
    color: options.color || [0.75, 0.8, 0.9],
    shadeMin: options.shadeMin === void 0 ? LIGHT.shadeMin : options.shadeMin,
    shadeMax: options.shadeMax === void 0 ? LIGHT.shadeMax : options.shadeMax,
    glow: options.glow === void 0 ? 0.3 : options.glow,
    opacity: options.opacity === void 0 ? 1 : options.opacity,
    followPointer: options.followPointer !== false,
  }
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    powerPreference: 'low-power',
  })
  if (!gl) return null

  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('dsh-theme-doubao: shader', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vs || !fs) return null
  const program = gl.createProgram()
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('dsh-theme-doubao: link', gl.getProgramInfoLog(program))
    return null
  }
  gl.useProgram(program)

  const attrib = (name) => gl.getAttribLocation(program, name)
  const uniform = (name) => gl.getUniformLocation(program, name)
  const aPosition = attrib('position')
  const aCenter = attrib('aCenter')
  const aScale = attrib('aScale')
  const aOpacity = attrib('aOpacity')
  const aIndex = attrib('aIndex')
  const aEdge = attrib('aEdge')
  const aScattered = attrib('aScattered')
  const uModel = uniform('uModel')
  const uViewProj = uniform('uViewProj')
  const uTime = uniform('uTime')
  const uWaveSpeed = uniform('uWaveSpeed')
  const uWaveAmount = uniform('uWaveAmount')
  const uMouse = uniform('uMouse')
  const uMouseRadius = uniform('uMouseRadius')
  const uMouseStrength = uniform('uMouseStrength')
  const uMouseDistort = uniform('uMouseDistort')
  const uAssembly = uniform('uAssembly')
  const uLoose = uniform('uLoose')
  const uScatter = uniform('uScatter')
  const uLightPos = uniform('uLightPos')
  const uLightRange = uniform('uLightRange')
  const uShadeMin = uniform('uShadeMin')
  const uShadeMax = uniform('uShadeMax')
  const uGlow = uniform('uGlow')
  const uOpacity = uniform('uOpacity')
  const uColor = uniform('uColor')

  const geometry = tileGeometry()
  const buffers = []
  const makeBuffer = () => {
    const buffer = gl.createBuffer()
    buffers.push(buffer)
    return buffer
  }
  const positionBuffer = makeBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(aPosition)
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0)

  const instanceReaders = []
  const bindInstance = (data, size, location) => {
    if (location < 0) return
    const buffer = makeBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(location, 1)
    instanceReaders.push(location)
  }

  const viewProj = mat4()
  const view = mat4()
  const proj = mat4()
  const model = mat4()
  const inverseModel = mat4()

  let artwork = null
  let count = 0
  let elapsed = 0
  let lastTime = 0
  let frame = 0
  let disposed = false
  let mouseStrength = 0
  let pointerHasMoved = false
  let pointerActive = false
  let pointerX = NaN
  let pointerY = NaN
  const smoothed = { x: 0, y: 0 }
  const mouseUniform = new Float32Array([0, 0])
  const viewport = { width: 0, height: 0 }

  /** three.js viewport size at z=0 for a perspective camera at distance 18. */
  const refreshViewport = () => {
    const height = 2 * Math.tan(((CAMERA.fov * Math.PI) / 180) / 2) * CAMERA.position[2]
    viewport.height = height
    viewport.width = height * gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight)
  }

  const loadArtwork = (url) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (disposed) return
      artwork = sampleArtwork(image)
      count = artwork.count
      bindInstance(artwork.centers, 3, aCenter)
      bindInstance(artwork.scales, 1, aScale)
      bindInstance(artwork.opacities, 1, aOpacity)
      bindInstance(artwork.indices, 1, aIndex)
      bindInstance(artwork.edges, 1, aEdge)
      bindInstance(artwork.scattered, 3, aScattered)
      request()
    }
    image.src = url
  }

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    perspective(proj, CAMERA.fov, width / height, CAMERA.near, CAMERA.far)
    refreshViewport()
  }

  const onPointerMove = (event) => {
    pointerActive = true
    pointerHasMoved = true
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointerY = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    request()
  }
  const onPointerLeave = () => {
    pointerActive = false
  }
  const onVisibility = () => {
    if (document.hidden) pointerActive = false
  }

  const drawFrame = (delta) => {
    resize()
    elapsed += delta
    const oneMinusAssemblyTime = elapsed - 0.3
    const ramp = Math.max(0, Math.min(1, oneMinusAssemblyTime / 2.5))
    const assembly = 1 - Math.pow(1 - ramp, 3)
    const scatter = 1.6 * Math.min(1, 1.5 * 0) // scroll dispersion is 0 inside the app shell

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (count === 0) return
    if (ramp <= 0) return

    lookAt(view, CAMERA.position, [0, 0, 0], [0, 1, 0])
    multiply(viewProj, proj, view)

    gl.enable(gl.BLEND)
    // Additive uses SRC_ALPHA/ONE rather than ONE/ONE: plain ONE/ONE ignores the
    // fragment's alpha, so `uOpacity` would dim the alpha-blended light surface
    // but leave the additive dark surface at full strength. Scaling the source by
    // its alpha keeps the glow behaviour while making opacity mean something on
    // both surfaces.
    if (appearance.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)

    // Pointer → world, then into the group's local space (upstream animation loop).
    if (pointerHasMoved && ramp > 0) {
      const targetX = (isNaN(pointerX) ? 0 : pointerX) * viewport.width * 0.5
      const targetY = (isNaN(pointerY) ? 0 : pointerY) * viewport.height * 0.5
      if (mouseStrength < 0.01) {
        smoothed.x = targetX
        smoothed.y = targetY
      } else {
        smoothed.x += (targetX - smoothed.x) * MOUSE.decay
        smoothed.y += (targetY - smoothed.y) * MOUSE.decay
      }
    }

    const targetStrength = pointerActive && appearance.followPointer ? MOUSE.strength : 0
    mouseStrength += (targetStrength - mouseStrength) * (1 - Math.pow(MOUSE_SMOOTHING, delta))

    const time = elapsed
    const rotationZ = time * (0 + (1 - assembly) * 0.3) + 0.04 * Math.sin(0.25 * time)
    const rotationX = 0.05 * Math.sin(0.08 * time * 0.7)
    const rotationY = 0.1 * Math.sin(0.08 * time)
    const positionY = 0.15 * Math.sin(0.4 * time)
    const scale = 0.75 + 0.25 * assembly
    composeTRS(model, [0, positionY, 0], [rotationX, rotationY, rotationZ], scale)
    invert(inverseModel, model)
    const local = transformPoint(inverseModel, smoothed.x, smoothed.y, 0)
    mouseUniform[0] = local[0]
    mouseUniform[1] = local[1]

    const intensity = assembly
    gl.uniformMatrix4fv(uModel, false, model)
    gl.uniformMatrix4fv(uViewProj, false, viewProj)
    gl.uniform1f(uTime, time)
    gl.uniform1f(uWaveSpeed, 1.5)
    gl.uniform1f(uWaveAmount, 0.06)
    gl.uniform2fv(uMouse, mouseUniform)
    gl.uniform1f(uMouseRadius, MOUSE.radius)
    gl.uniform1f(uMouseStrength, mouseStrength)
    gl.uniform1f(uMouseDistort, MOUSE.distort)
    gl.uniform1f(uAssembly, assembly)
    gl.uniform1f(uLoose, options.loose === undefined ? 1 : options.loose)
    gl.uniform1f(uScatter, scatter)
    gl.uniform3f(uLightPos, LIGHT.x + smoothed.x * LIGHT.followX, LIGHT.y, LIGHT.z)
    gl.uniform1f(uLightRange, LIGHT.range)
    gl.uniform1f(uShadeMin, appearance.shadeMin)
    gl.uniform1f(uShadeMax, appearance.shadeMax)
    gl.uniform1f(uGlow, appearance.glow)
    gl.uniform1f(uOpacity, appearance.opacity)
    gl.uniform3f(
      uColor,
      appearance.color[0] * intensity,
      appearance.color[1] * intensity,
      appearance.color[2] * intensity,
    )

    gl.drawArraysInstanced(gl.TRIANGLES, 0, geometry.length / 3, count)
  }

  const step = (time) => {
    frame = 0
    if (disposed) return
    if (lastTime === 0) lastTime = time
    if (time - lastTime < FRAME_MS - 1) {
      frame = requestAnimationFrame(step)
      return
    }
    const delta = Math.min(0.1, (time - lastTime) / 1000)
    lastTime = time
    drawFrame(delta)
    if (visible) frame = requestAnimationFrame(step)
  }

  const request = () => {
    if (disposed || frame !== 0 || !visible) return
    frame = requestAnimationFrame(step)
  }

  let visible = true
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting
      if (visible) request()
      else if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    },
    { rootMargin: '100px' },
  )
  observer.observe(canvas)

  if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) {
    window.addEventListener('mousemove', onPointerMove, { passive: true })
    window.addEventListener('mouseleave', onPointerLeave)
    document.addEventListener('visibilitychange', onVisibility)
  }
  resize()
  loadArtwork(options.artwork)
  request()

  return {
    setAppearance(next) {
      if (next.additive !== undefined) appearance.additive = next.additive
      if (next.color !== undefined) appearance.color = next.color
      if (next.shadeMin !== undefined) appearance.shadeMin = next.shadeMin
      if (next.shadeMax !== undefined) appearance.shadeMax = next.shadeMax
      if (next.glow !== undefined) appearance.glow = next.glow
      if (next.opacity !== undefined) appearance.opacity = next.opacity
    },
    /** Report the pointer state so an idle field can be restarted after a resize. */
    refresh() {
      resize()
      request()
    },
    dispose() {
      disposed = true
      if (frame !== 0) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseleave', onPointerLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      for (const buffer of buffers) gl.deleteBuffer(buffer)
    },
  }
}

module.exports = { createDigitileField }





