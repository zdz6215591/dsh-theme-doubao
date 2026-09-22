/**
 * The blank-session hero: Doubao character over the dot-matrix DeepSeek whale.
 *
 * The occupant of `conversation.hero.brand.mark` owns only a 34px inline slot in
 * the middle of the host's centred headline row, so the scene is built as a
 * zero-height overlay: everything below is absolutely positioned inside
 * `[data-doubao-hero]`, which means the composer keeps its own position and
 * cannot be covered. The host's headline text is hidden through DOM references
 * instead of class names, because those class names are content-hashed.
 */
const React = require('react')
const { createDigitileField } = require('./digitile.js')
const { CHARACTER, WHALE } = require('./artwork.js')

/** Intrinsic pixel size of `assets/doubao-character.png`. */
const CHARACTER_SOURCE = { width: 727, height: 623 }
/** Intrinsic aspect of the character artwork. */
const CHARACTER_ASPECT = CHARACTER_SOURCE.width / CHARACTER_SOURCE.height
/** Vertical world units the digitile camera shows, `2*tan(fov/2)*z` for fov 50 @ z 18. */
const FIELD_VIEW_HEIGHT = 2 * Math.tan(((50 * Math.PI) / 180) / 2) * 18
/** Whale footprint in world units: the 24x18 artwork sampled into a 60-cell grid. */
const WHALE_UNITS = { width: 60 * 0.18, height: 45 * 0.18 }

/** Tunables, all in CSS pixels unless noted. */
const CONFIG = {
  /** Gap kept below the character's flat lower edge, above the composer card. */
  cardGap: 2,
  /** Gap between the field's bounding box and the available band. */
  fieldGap: 14,
  /** Space kept between the band's ceiling and the top of the scene. */
  ceilingGap: 8,
  /** Character height as a fraction of the available band. */
  characterBandRatio: 0.46,
  /** Hard caps, reached on tall or very large windows. */
  characterMaxWidth: 400,
  characterMaxHeight: 340,
  /** Bottom fade length as a fraction of the rendered artwork height. */
  characterFadeRatio: 0.085,
  /** Whale width as a multiple of the character's width. */
  whaleWidthRatio: 1.7,
  /** Length of the field's bottom fade, measured up from the controls row. */
  fieldFade: 104,
  /** Bottom breathing room added to the composer stack while the hero is mounted. */
  composerBottomPad: 'clamp(16px, 9vh, 96px)',
}

/* ------------------------------------------------------------------ *
 * Host DOM bridging                                                  *
 * ------------------------------------------------------------------ */

/**
 * Collapse the host's headline row so its text disappears while the slot's own
 * box stays in the layout. Every edit is an inline style on an element reached
 * from the slot's own node, and `restore()` puts back exactly what was there.
 * @param host - the slot's root element.
 * @returns a restore function.
 */
function hideHeadline(host) {
  const chain = []
  let node = host
  let headline = null
  for (let depth = 0; depth < 8 && node.parentElement !== null; depth += 1) {
    const parent = node.parentElement
    if (parent.children.length > 1) {
      headline = parent
      break
    }
    chain.push(node)
    node = parent
  }
  const saved = []
  const set = (element, property, value) => {
    saved.push([element, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)])
    element.style.setProperty(property, value, 'important')
  }
  if (headline !== null) {
    set(headline, 'display', 'block')
    set(headline, 'height', '0px')
    set(headline, 'min-height', '0px')
    for (const child of Array.from(headline.children)) {
      if (child !== node) set(child, 'display', 'none')
    }
  }
  for (const element of [...chain, node]) {
    set(element, 'display', 'block')
    set(element, 'width', '100%')
    set(element, 'height', '0px')
    set(element, 'min-height', '0px')
  }
  return () => {
    for (const [element, property, value, priority] of saved.reverse()) {
      if (value === '') element.style.removeProperty(property)
      else element.style.setProperty(property, value, priority)
    }
  }
}

/**
 * Find the composer card and the hero controls row. The composer bar's slot
 * wrapper carries a stable `data-slot` marker, and the controls row is the last
 * sized sibling above it that is not the hero shell itself — so both are found by
 * structure rather than by hashed class name or a fixed ancestor depth.
 * @param host - the slot's root element.
 * @returns the composer bar wrapper and the row the character stands on.
 */
function findComposerParts(host) {
  const scroll = host.closest('[data-conversation-scroll]')
  const scope = scroll === null ? document : scroll
  const card = scope.querySelector('[data-slot="conversation.composer.bar"]')
  let standing = null
  const stack = card === null ? null : card.parentElement
  if (stack !== null) {
    let sibling = card.previousElementSibling
    while (sibling !== null) {
      if (!sibling.contains(host)) {
        const box = firstSizedBox(sibling)
        if (box !== null && box.height > 0 && box.width > 0) {
          standing = box
          break
        }
      }
      sibling = sibling.previousElementSibling
    }
  }
  return { card: firstSizedBox(card), standing }
}

/**
 * The slot wrapper of a slot can be a zero-size box whose first element child is
 * the visible chrome, so the top the scene needs is the first descendant box that
 * actually occupies space.
 * @param element - the slot wrapper, or `null`.
 * @returns that element's client rect.
 */
function firstSizedBox(element) {
  let node = element
  for (let depth = 0; node !== null && depth < 8; depth += 1) {
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
    node = node.firstElementChild
  }
  return element === null ? null : element.getBoundingClientRect()
}

/** Read the resolved surface luminance by probing an inherited theme token. */
function readSurfaceIsDark(probe) {
  if (probe === null || probe === undefined) return false
  const value = window.getComputedStyle(probe).backgroundColor
  const match = /^rgba?\(([^)]+)\)$/.exec(value)
  if (match === null) return false
  const parts = match[1]
    .split(/[,\s/]+/)
    .filter((part) => part !== '')
    .map(Number)
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return false
  const [r, g, b] = parts
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

/**
 * Appearance per surface, one flat colour for every particle.
 *
 * The upstream material multiplies a single light into the colour, adds a centre
 * bloom, and uses additive blending as a glow on black. On a white surface that
 * mixture reads as a blue-and-grey speckle, and used additively there it would be
 * invisible. So `shadeMin === shadeMax` flattens the per-particle shading and
 * `glow: 0` drops the centre tint, leaving one tone per surface: a light periwinkle
 * on light, white on dark. Restoring the upstream treatment is a one-line change —
 * give the two bounds the upstream 0.28 / 2.79 (dark) or 0.55 / 1.35 (light) and
 * `glow: 0.3`.
 * @param isDark - whether the resolved surface is dark.
 * @returns colour, blending, shading range and bloom weight for the field.
 */
function appearanceFor(isDark) {
  return isDark
    ? { additive: true, color: [0.78, 0.83, 0.92], shadeMin: 1, shadeMax: 1, glow: 0 }
    : { additive: false, color: [0.55, 0.64, 0.9], shadeMin: 1, shadeMax: 1, glow: 0 }
}

/* ------------------------------------------------------------------ *
 * Component                                                          *
 * ------------------------------------------------------------------ */

/**
 * Render the hero scene.
 * @returns the hero overlay element tree.
 */
function DoubaoHeroMark() {
  const hostRef = React.useRef(null)
  const stageRef = React.useRef(null)
  const fieldRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const imageRef = React.useRef(null)
  const probeRef = React.useRef(null)
  const handleRef = React.useRef(null)
  const darkRef = React.useRef(false)

  // Scene sizing: character and field are fitted to the band above the composer.
  React.useLayoutEffect(() => {
    const host = hostRef.current
    const stage = stageRef.current
    const field = fieldRef.current
    const canvas = canvasRef.current
    const image = imageRef.current
    if (host === null || stage === null || field === null || canvas === null || image === null) return undefined

    const restoreHeadline = hideHeadline(host)
    const scroll = host.closest('[data-conversation-scroll]')
    const savedScroll = []
    if (scroll !== null) {
      for (const [property, value] of [
        ['justify-content', 'flex-end'],
        ['padding-bottom', CONFIG.composerBottomPad],
      ]) {
        savedScroll.push([property, scroll.style.getPropertyValue(property), scroll.style.getPropertyPriority(property)])
        scroll.style.setProperty(property, value, 'important')
      }
    }

    let timer = 0
    let lastDpr = window.devicePixelRatio || 1
    const layout = () => {
      const scrollRect = scroll === null ? document.documentElement.getBoundingClientRect() : scroll.getBoundingClientRect()
      const hostRect = host.getBoundingClientRect()
      const { card: cardBox, standing } = findComposerParts(host)
      const bandTop = scrollRect.top + CONFIG.ceilingGap
      // The character stands on the hero controls row rather than on the composer
      // card: that row's chips paint on top of the scene, and a character running
      // through them would leave dark-on-dark labels behind.
      const cardTop =
        standing !== null && standing.top > bandTop
          ? standing.top
          : cardBox === null
            ? hostRect.bottom
            : cardBox.top
      const bandBottom = cardTop - CONFIG.cardGap
      const availH = Math.max(140, bandBottom - bandTop)
      const availW = Math.max(220, scrollRect.width - 16)

      // ── character ──────────────────────────────────────────────────
      // Crispness rule: never ask for more device pixels than the artwork has,
      // and render on whole CSS pixels so the browser can map the source texels
      // 1:1-ish at every window size and zoom level instead of resampling a
      // fractional box. The height is derived from the rounded width so the
      // artwork keeps its aspect.
      const dpr = window.devicePixelRatio || 1
      let width = Math.min(
        availH * CONFIG.characterBandRatio * CHARACTER_ASPECT,
        CONFIG.characterMaxWidth,
        CHARACTER_SOURCE.width / dpr,
        // The field is wider than the character, and the character's width drives
        // the field's width — so the field's fit constrains the character.
        (availW - CONFIG.fieldGap) / CONFIG.whaleWidthRatio,
      )
      width = Math.max(72, Math.floor(width))
      const height = Math.round(width / CHARACTER_ASPECT)
      image.style.width = `${width}px`
      image.style.height = `${height}px`
      image.style.setProperty('--doubao-character-fade', `${Math.round(height * CONFIG.characterFadeRatio)}px`)

      // ── dot-matrix field ───────────────────────────────────────────
      // Both are anchored to the controls row rather than to the middle of the
      // band, which is what keeps the head and the dots from drifting apart on a
      // tall window: the gap between them can only ever be the scene's own
      // geometry, never the leftover height.
      const unit = (width * CONFIG.whaleWidthRatio) / WHALE_UNITS.width
      const whaleHeight = WHALE_UNITS.height * unit
      const canvasHeight = FIELD_VIEW_HEIGHT * unit
      const canvasWidth = Math.round(canvasHeight)
      // The whale is centred inside its canvas, so putting the whale's bottom on
      // the controls row pushes the canvas' bottom below the clip box on purpose:
      // the fade in `styles.js` dissolves that overhang, and the clip box keeps it
      // from growing a scrollbar.
      const canvasBottom = -(canvasHeight - whaleHeight) / 2
      canvas.style.width = `${canvasWidth}px`
      canvas.style.height = `${Math.round(canvasHeight)}px`
      canvas.style.bottom = `${Math.round(canvasBottom)}px`
      // The clip box is exactly the band, so nothing the field draws can create
      // scrollable overflow, vertically or horizontally.
      field.style.top = `${Math.round(bandTop - hostRect.top)}px`
      field.style.height = `${Math.round(availH)}px`
      field.style.setProperty('--doubao-field-fade', `${Math.round(CONFIG.fieldFade)}px`)
      // The stage grows downwards from the (zero-height) hero row to the card top.
      stage.style.height = `${Math.round(Math.max(0, bandBottom - hostRect.top))}px`

      if (handleRef.current !== null) handleRef.current.refresh()
      const nextDark = readSurfaceIsDark(probeRef.current)
      if (nextDark !== darkRef.current) {
        darkRef.current = nextDark
        if (handleRef.current !== null) handleRef.current.setAppearance(appearanceFor(nextDark))
      }
    }

    layout()
    const observer = new ResizeObserver(layout)
    if (scroll !== null) observer.observe(scroll)
    observer.observe(document.documentElement)
    window.addEventListener('resize', layout)
    // Browser zoom and dragging the window to a screen with another scale factor
    // change `devicePixelRatio` without resizing anything the observer watches,
    // and the crispness rule above depends on it.
    const dprWatch = window.setInterval(() => {
      const dpr = window.devicePixelRatio || 1
      if (dpr === lastDpr) return
      lastDpr = dpr
      layout()
    }, 1200)

    return () => {
      window.clearInterval(timer)
      window.clearInterval(dprWatch)
      window.removeEventListener('resize', layout)
      observer.disconnect()
      if (handleRef.current !== null) {
        handleRef.current.dispose()
        handleRef.current = null
      }
      restoreHeadline()
      if (scroll !== null) {
        for (const [property, value, priority] of savedScroll) {
          if (value === '') scroll.style.removeProperty(property)
          else scroll.style.setProperty(property, value, priority)
        }
      }
    }
  }, [])

  // Field lifetime is its own effect so the WebGL context survives re-layouts.
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return undefined
    const isDark = readSurfaceIsDark(probeRef.current)
    darkRef.current = isDark
    handleRef.current = createDigitileField(canvas, {
      artwork: WHALE,
      ...appearanceFor(isDark),
    })
    const timer = window.setInterval(() => {
      const next = readSurfaceIsDark(probeRef.current)
      if (next === darkRef.current || handleRef.current === null) return
      darkRef.current = next
      handleRef.current.setAppearance(appearanceFor(next))
    }, 1500)
    return () => {
      window.clearInterval(timer)
      if (handleRef.current !== null) {
        handleRef.current.dispose()
        handleRef.current = null
      }
    }
  }, [])

  return React.createElement(
    'div',
    { 'data-doubao-hero': '', ref: hostRef },
    React.createElement(
      'div',
      { 'data-doubao-stage': '', ref: stageRef },
      React.createElement('div', {
        'data-doubao-probe': '',
        ref: probeRef,
        style: {
          position: 'absolute',
          width: 0,
          height: 0,
          visibility: 'hidden',
          background: 'var(--dsw-alias-bg-base)',
        },
      }),
      // Clip box: exactly the band, so the oversized canvas inside cannot create
      // scrollable overflow, and its bottom fade is measured in band units.
      React.createElement(
        'div',
        { 'data-doubao-field': '', ref: fieldRef },
        React.createElement('canvas', { 'data-doubao-canvas': '', ref: canvasRef }),
      ),
      React.createElement('img', {
        'data-doubao-character': '',
        ref: imageRef,
        src: CHARACTER,
        alt: '',
        'aria-hidden': 'true',
        draggable: false,
      }),
    ),
  )
}

module.exports = { DoubaoHeroMark, CONFIG, appearanceFor }


