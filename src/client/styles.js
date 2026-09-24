/**
 * Injected stylesheet for the 豆包 theme.
 *
 * Every selector keys off `data-doubao-*` attributes only: the host's CSS-module
 * class names are content-hashed per build, so the theme never targets them.
 * The two host elements it must restyle are therefore addressed in JS (see
 * `hero.js`), not from this sheet.
 */
const TAG_ID = 'dsh-theme-doubao/doubao.css'

const CSS = `
/* ── sidebar brand ───────────────────────────────────────────────────── */

[data-doubao-mark] {
  display: block;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  -webkit-user-drag: none;
  user-select: none;
}

[data-doubao-name] {
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── hero: character + dot-matrix field ──────────────────────────────── */

/* Zero-height overlay anchored at the hero slot: it never pushes the composer. */
[data-doubao-hero] {
  position: relative;
  display: block;
  width: 100%;
  height: 0;
  overflow: visible;
}

/* Grows downwards from the zero-height hero row, down to the composer card:
   its own bottom edge is the line the character's flat lower edge stands on. */
[data-doubao-stage] {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0;
  display: block;
  overflow: visible;
  pointer-events: none;
}

/* Clip box sized to exactly the band the scene may draw in. It paints nothing, so
   it is also the safest place for the field's bottom fade: the fade is measured in
   band units, and anything the oversized canvas puts past the box is dropped
   instead of growing a scrollbar. */
[data-doubao-field] {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0;
  display: block;
  overflow: hidden;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--doubao-field-fade, 104px)), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - var(--doubao-field-fade, 104px)), transparent 100%);
}

/* The canvas is wider than this box on purpose, and a box that overflows its
   container is NOT centred by auto margins (they resolve to 0 and it sits flush
   left — the field then drifts off-centre and gets clipped). So both layers are
   centred by a computed, whole-pixel negative margin-left set from the layout
   pass, which also keeps them off half-pixel boundaries. */
[data-doubao-canvas] {
  position: absolute;
  left: 50%;
  display: block;
  pointer-events: none;
}

[data-doubao-character] {
  position: absolute;
  left: 50%;
  bottom: 0;
  display: block;
  width: var(--doubao-character-w, 300px);
  height: auto;
  max-width: none;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  /* No drop-shadow. The artwork is keyed to a clean alpha edge, and a CSS shadow
     around a cut-out reads as a failed cut-out rather than as depth — the dot
     field behind it already supplies the depth. */
  filter: none;
  /* The artwork is a torso crop, so its last rows dissolve instead of showing a
     hard cut where the scene stops above the composer. */
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--doubao-character-fade, 20px)), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - var(--doubao-character-fade, 20px)), transparent 100%);
}

@media (prefers-reduced-motion: reduce) {
  [data-doubao-character],
  [data-doubao-field] {
    transition: none;
  }
}
`

/**
 * Install the theme stylesheet once per document, following the client-plugin
 * convention (`data-plugin` + `data-plugin-css`) so the HMR driver can retire it.
 * @returns the injected style element, or the existing one.
 */
function installStyles() {
  if (typeof document === 'undefined') return null
  const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG_ID) + ']')
  if (existing !== null) return existing
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-theme-doubao'
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return tag
}

module.exports = { installStyles, THEME_CSS: CSS, TAG_ID }

