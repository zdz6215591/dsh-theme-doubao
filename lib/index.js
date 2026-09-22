/**
 * 豆包主题（Doubao theme）— node half.
 *
 * This package contributes browser presentation only, so the host half is an
 * empty Loader seat: it gives the Cordis loader a row while `./client` ships
 * the browser bundle. The same shape is used by
 * `@deepseek-ai/dsh-client-ui-brand-official`.
 */

/** Host plugin body — the browser half owns every contribution. */
function apply() {}

export { apply }
