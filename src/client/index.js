/**
 * 豆包主题（Doubao theme）— browser half.
 *
 * Three slot occupants, all installed through declaration-aware `slots.inject()`
 * so the theme works whether it activates before or after the shells that
 * declare the slots:
 *
 *   sidebar.brand.mark              → the Doubao app mark
 *   sidebar.brand.name              → 豆包
 *   conversation.hero.brand.mark    → Doubao character + dot-matrix DeepSeek whale
 *
 * Nothing here reaches the model: the package only contributes browser
 * presentation.
 */
const React = require('react')
const { installStyles } = require('./styles.js')
const { DoubaoHeroMark } = require('./hero.js')
const { MARK } = require('./artwork.js')

installStyles()

/** Required service: the UI slot registry. */
const inject = ['slots']

/**
 * The Doubao app mark, at the square edge the sidebar asked for. The shell passes
 * `{ size }` to `sidebar.brand.mark` and also hands over its own mark class, which
 * is ignored: the theme owns this box.
 * @param props.size - requested square edge in pixels.
 * @returns the mark image.
 */
function DoubaoBrandMark(props) {
  const size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 24
  return React.createElement('img', {
    'data-doubao-mark': '',
    src: MARK,
    alt: '',
    'aria-hidden': 'true',
    draggable: false,
    style: { width: `${size}px`, height: `${size}px` },
  })
}

/** The Doubao name, inheriting the sidebar's own brand typography. */
function DoubaoBrandName() {
  return React.createElement('span', { 'data-doubao-name': '' }, '豆包')
}

/**
 * Fill the brand slots as one declaration-aware registration set, and hang the
 * hero scene off its own slot injection.
 *
 * Priority `-1` is deliberate: a single slot renders its lowest-priority entry,
 * and the shipped `dsh-client-ui-brand-official` already occupies both sidebar
 * brand slots at the default priority 0. Shadowing it is the documented way to
 * replace a brand occupant.
 * @param ctx - client root context.
 */
function apply(ctx) {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, DoubaoBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, DoubaoBrandName)
    }),
  )
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, DoubaoHeroMark)
  })
}

module.exports = { apply, inject }
