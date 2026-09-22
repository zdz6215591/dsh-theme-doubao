/**
 * Artwork data URLs.
 *
 * The three literals below are placeholders: `tools/build-client.mjs` rewrites
 * them into real `data:` URLs (JSON-escaped, so no artwork byte can escape its
 * string literal). Keeping them out of the repository keeps review diffs small —
 * a 400 KiB PNG has no business being a source line.
 */
const MARK = '__DOUBAO_ARTWORK_MARK__'
const CHARACTER = '__DOUBAO_ARTWORK_CHARACTER__'
const WHALE = '__DOUBAO_ARTWORK_WHALE__'

module.exports = { MARK, CHARACTER, WHALE }
