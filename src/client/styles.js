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

/* Centring uses auto margins rather than translateX(-50%): a transform would park
   the artwork on half-pixel boundaries and soften every edge on 1x screens. */
[data-doubao-field] {
  position: absolute;
  left: 0;
  right: 0;
  margin-left: auto;
  margin-right: auto;
  display: block;
  pointer-events: none;
}

[data-doubao-character] {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  margin-left: auto;
  margin-right: auto;
  display: block;
  width: var(--doubao-character-w, 260px);
  height: auto;
  max-width: none;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  filter: drop-shadow(0 14px 28px rgba(11, 28, 58, 0.16));
  /* The artwork is a torso crop, so its last rows dissolve instead of showing a
     hard cut where the scene stops above the composer. */
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--doubao-character-fade, 20px)), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - var(--doubao-character-fade, 20px)), transparent 100%);
}

/* Dark surfaces need a shadow that reads as depth, not as dirt. */
@media (prefers-color-scheme: dark) {
  [data-doubao-character] {
    filter: drop-shadow(0 14px 32px rgba(0, 0, 0, 0.55));
  }
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

